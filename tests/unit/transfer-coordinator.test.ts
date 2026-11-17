import { describe, expect, it, vi } from "vitest";
import { TransferCoordinator } from "../../src/worker/transfers/coordinator";
import { PathLocks } from "../../src/shared/file-policies/path-locks";
import type { SessionManager } from "../../src/worker/connections/session-manager";
import type { WorkerReceiptWriter } from "../../src/worker/receipt-writer";
import type { TransferLive } from "../../src/worker/transfers/runner";
import type {
  StagedTransfer,
  TransferRuntime,
} from "../../src/shared/transfer-protocol";
import type { FileReceipt } from "../../src/shared/receipts";
import type { TransferPhase } from "../../src/shared/transfers";
import { transferReceipt } from "../fixtures/transfers";
const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function fixture() {
  const epoch = crypto.randomUUID();
  let fault = false;
  const emitted: TransferRuntime[] = [],
    saved: FileReceipt[] = [],
    started: string[] = [];
  const runners = new Map<
    string,
    { finish(phase?: TransferPhase, closed?: boolean): void }
  >();
  const writer = {
    get faulted() {
      return fault;
    },
    persist: async (row: FileReceipt) => {
      if (fault) throw new Error("STORAGE_FAILED");
      saved.push(structuredClone(row));
    },
  } as Pick<WorkerReceiptWriter, "faulted" | "persist">;
  const sessions = { control: () => ({ check: () => {} }) } as unknown as Pick<
    SessionManager,
    "control" | "auxiliary"
  >;
  const coordinator = new TransferCoordinator(
    epoch,
    sessions,
    new PathLocks(),
    writer,
    (row) => emitted.push(row),
    (spec, hooks) => {
      let live: TransferLive = {
        ...spec.row,
        recordError: false,
        bytesPerSecond: null,
      };
      let finish!: (value: {
        snapshot: TransferLive;
        resourcesClosed: boolean;
      }) => void;
      const gate = new Promise<{
        snapshot: TransferLive;
        resourcesClosed: boolean;
      }>((resolve) => {
        finish = resolve;
      });
      const done = (phase: TransferPhase = "completed", closed = true) => {
        live = {
          ...live,
          phase,
          recordError: fault,
          cleanupState: phase === "result_unknown" ? "unknown" : "confirmed",
          ...(phase === "completed"
            ? {
                destinationCreated: true,
                transferredBytes: live.totalBytes,
                verifiedBytes: live.totalBytes,
              }
            : {}),
        };
        finish({ snapshot: live, resourcesClosed: closed });
      };
      runners.set(spec.row.taskId, { finish: done });
      return {
        snapshot: () => live,
        cancel: () => {
          live = { ...live, phase: "cancel_requested" };
          return live.phase;
        },
        interrupt: () => done("interrupted"),
        run: async () => {
          started.push(spec.row.taskId);
          live = { ...live, phase: "preparing" };
          hooks.update(live);
          const {
            recordError: _error,
            bytesPerSecond: _speed,
            ...receipt
          } = live;
          await hooks.persist(receipt);
          return gate;
        },
      };
    },
  );
  const spec = (serverId: string): StagedTransfer => {
    const row = transferReceipt();
    row.serverId = serverId;
    row.backendEpoch = epoch;
    row.source += "-" + row.taskId;
    row.destination += "-" + row.taskId;
    return { row, localDirectory: { path: row.localParent, identity: "1:2" } };
  };
  const enqueue = (serverId: string, rows: StagedTransfer[]) => {
    const token = crypto.randomUUID();
    coordinator.reserve(serverId, 1, token, rows.length);
    rows.forEach((row, index) =>
      coordinator.stage(serverId, 1, token, index, row),
    );
    coordinator.commit(serverId, 1, token);
    return token;
  };
  return {
    coordinator,
    emitted,
    saved,
    started,
    runners,
    spec,
    enqueue,
    writer,
    sessions,
    epoch,
    setFault: () => {
      fault = true;
      coordinator.storageFault();
    },
  };
}
describe("transfer coordinator queue and resource ownership", () => {
  it("rejects invalid staged identities/indices, accepts exact stage replay and prevents duplicate cross-reservation tasks", () => {
    const f = fixture(),
      server = crypto.randomUUID(),
      spec = f.spec(server),
      token = crypto.randomUUID();
    f.coordinator.reserve(server, 1, token, 2);
    for (const index of [-1, 2, 0.5])
      expect(() => f.coordinator.stage(server, 1, token, index, spec)).toThrow(
        "INPUT_INVALID",
      );
    for (const row of [
      { ...spec.row, backendEpoch: crypto.randomUUID() },
      { ...spec.row, phase: "transferring" as const },
      { ...spec.row, tempCreated: true },
    ])
      expect(() =>
        f.coordinator.stage(server, 1, token, 0, { ...spec, row }),
      ).toThrow("INPUT_INVALID");
    f.coordinator.stage(server, 1, token, 0, spec);
    f.coordinator.stage(server, 1, token, 0, spec);
    expect(() =>
      f.coordinator.stage(server, 1, token, 0, {
        ...spec,
        row: { ...spec.row, source: "/other" },
      }),
    ).toThrow("INPUT_INVALID");
    const second = crypto.randomUUID();
    f.coordinator.reserve(server, 1, second, 1);
    expect(() => f.coordinator.stage(server, 1, second, 0, spec)).toThrow(
      "INPUT_INVALID",
    );
    f.coordinator.release(server, 1, token);
    f.coordinator.release(server, 1, second);
    expect(f.coordinator.quiescent()).toBe(true);
  });
  it("retains unclosed resources when runner construction or its promise fails unexpectedly", async () => {
    for (const asyncFailure of [false, true]) {
      const f = fixture(),
        emitted: TransferRuntime[] = [],
        coordinator = new TransferCoordinator(
          f.epoch,
          f.sessions,
          new PathLocks(),
          f.writer,
          (row) => emitted.push(row),
          (spec) => {
            if (!asyncFailure) throw new Error("construction failure");
            return {
              snapshot: () => ({
                ...spec.row,
                recordError: false,
                bytesPerSecond: null,
              }),
              cancel: () => "cancel_requested",
              interrupt: () => {},
              run: async () => {
                throw new Error("unexpected runner failure");
              },
            };
          },
        ),
        server = crypto.randomUUID(),
        spec = f.spec(server),
        token = crypto.randomUUID();
      coordinator.reserve(server, 1, token, 1);
      coordinator.stage(server, 1, token, 0, spec);
      coordinator.commit(server, 1, token);
      await tick();
      expect(coordinator.snapshot(server, 1).rows[0]).toMatchObject({
        phase: "result_unknown",
        recordError: true,
        slotOccupied: true,
        cleanupPending: true,
        errorCode: "INTERNAL_ERROR",
      });
      expect(() => coordinator.acknowledge(server, 1, spec.row.taskId)).toThrow(
        "REQUEST_BUSY",
      );
    }
  });
  it("releases obsolete reservations on disconnect and refuses new work after storage fault", async () => {
    const f = fixture(),
      server = crypto.randomUUID(),
      token = crypto.randomUUID();
    f.coordinator.reserve(server, 1, token, 1);
    f.coordinator.sessionChanged(server, 1, true);
    expect(f.coordinator.quiescent()).toBe(false);
    f.coordinator.sessionChanged(server, 2, true);
    expect(f.coordinator.quiescent()).toBe(true);
    await expect(
      f.coordinator.cancel(server, 1, crypto.randomUUID()),
    ).rejects.toThrow("TOKEN_EXPIRED");
    f.setFault();
    f.coordinator.storageFault();
    expect(() =>
      f.coordinator.reserve(server, 2, crypto.randomUUID(), 1),
    ).toThrow("STORAGE_FAILED");
    expect(() => f.coordinator.snapshot(server, 1, -1)).toThrow(
      "INPUT_INVALID",
    );
  });
  it("preserves failed terminal persistence and acknowledges only its original server generation", async () => {
    const f = fixture(),
      server = crypto.randomUUID(),
      spec = f.spec(server);
    f.enqueue(server, [spec]);
    await tick();
    f.setFault();
    await tick();
    await f.coordinator.settled();
    const rows = f.coordinator.snapshot(server, 1).rows;
    expect(rows[0]).toMatchObject({ recordError: true, active: false });
    expect(() =>
      f.coordinator.acknowledge(crypto.randomUUID(), 1, spec.row.taskId),
    ).toThrow("TOKEN_EXPIRED");
    f.coordinator.acknowledge(server, 1, spec.row.taskId);
    expect(f.coordinator.snapshot(server, 1).rows).toEqual([]);
    expect(f.coordinator.quiescent()).toBe(true);
  });
  it("runs at most2 tasks with1 per-server and starts the oldest eligible queued task", async () => {
    const f = fixture(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      c = crypto.randomUUID();
    const a1 = f.spec(a),
      a2 = f.spec(a),
      b1 = f.spec(b),
      c1 = f.spec(c);
    f.enqueue(a, [a1, a2]);
    f.enqueue(b, [b1]);
    f.enqueue(c, [c1]);
    await tick();
    expect(f.started).toEqual([a1.row.taskId, b1.row.taskId]);
    f.runners.get(a1.row.taskId)!.finish();
    await tick();
    expect(f.started).toEqual([a1.row.taskId, b1.row.taskId, a2.row.taskId]);
    f.runners.get(b1.row.taskId)!.finish();
    await tick();
    expect(f.started.at(-1)).toBe(c1.row.taskId);
  });
  it("does not launch a partially staged batch and binds reservation/server/generation/path authority", () => {
    const f = fixture(),
      serverId = crypto.randomUUID(),
      token = crypto.randomUUID(),
      row = f.spec(serverId);
    f.coordinator.reserve(serverId, 1, token, 2);
    f.coordinator.stage(serverId, 1, token, 0, row);
    expect(() => f.coordinator.commit(serverId, 1, token)).toThrow(
      "INPUT_INVALID",
    );
    expect(f.started).toEqual([]);
    expect(() => f.coordinator.stage(serverId, 2, token, 1, row)).toThrow(
      "TOKEN_EXPIRED",
    );
    const second = f.spec(serverId);
    expect(() =>
      f.coordinator.stage(serverId, 1, token, 1, {
        ...second,
        localDirectory: { ...second.localDirectory, path: "/unapproved" },
      }),
    ).toThrow("INPUT_INVALID");
    f.coordinator.release(serverId, 1, token);
    expect(() => f.coordinator.commit(serverId, 1, token)).toThrow(
      "TOKEN_EXPIRED",
    );
  });
  it("cancels queued tasks without creating a runner and delegates active cancellation", async () => {
    const f = fixture(),
      server = crypto.randomUUID(),
      first = f.spec(server),
      queued = f.spec(server);
    f.enqueue(server, [first, queued]);
    await tick();
    expect(await f.coordinator.cancel(server, 1, queued.row.taskId)).toBe(
      "cancelled",
    );
    expect(f.started).toEqual([first.row.taskId]);
    expect(f.saved.find((row) => row.taskId === queued.row.taskId)?.phase).toBe(
      "cancelled",
    );
    expect(await f.coordinator.cancel(server, 1, first.row.taskId)).toBe(
      "cancel_requested",
    );
  });
  it("retains a slot when closure is unconfirmed and retains unknown paths until acknowledged", async () => {
    const f = fixture(),
      server = crypto.randomUUID(),
      first = f.spec(server),
      queued = f.spec(server);
    f.enqueue(server, [first, queued]);
    await tick();
    f.runners.get(first.row.taskId)!.finish("completed", false);
    await tick();
    expect(f.started).toHaveLength(1);
    expect(
      f.coordinator
        .snapshot(server, 1)
        .rows.find((row) => row.taskId === first.row.taskId),
    ).toMatchObject({ active: true, slotOccupied: true, cleanupPending: true });
    const g = fixture(),
      id = crypto.randomUUID(),
      unknown = g.spec(id),
      next = g.spec(id);
    next.row.source = unknown.row.source;
    next.row.destination = unknown.row.destination;
    g.enqueue(id, [unknown, next]);
    await tick();
    g.runners.get(unknown.row.taskId)!.finish("result_unknown");
    await tick();
    expect(g.started).toHaveLength(1);
    expect(() => g.coordinator.acknowledge(id, 2, unknown.row.taskId)).toThrow(
      "TOKEN_EXPIRED",
    );
    g.coordinator.acknowledge(id, 1, unknown.row.taskId);
    await tick();
    expect(g.started).toHaveLength(2);
  });
  it("interrupts only the disconnected generation and prevents queued replay after a storage fault", async () => {
    const f = fixture(),
      a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      a1 = f.spec(a),
      a2 = f.spec(a),
      b1 = f.spec(b);
    f.enqueue(a, [a1, a2]);
    f.enqueue(b, [b1]);
    await tick();
    f.coordinator.sessionChanged(a, 1, false);
    await tick();
    await f.coordinator.settled();
    expect(f.started).not.toContain(a2.row.taskId);
    expect(f.coordinator.snapshot(b, 1).rows[0]?.active).toBe(true);
    expect(f.saved.find((row) => row.taskId === a2.row.taskId)?.phase).toBe(
      "interrupted",
    );
    const g = fixture(),
      server = crypto.randomUUID(),
      first = g.spec(server),
      queued = g.spec(server);
    g.enqueue(server, [first, queued]);
    await tick();
    g.setFault();
    await tick();
    await g.coordinator.settled();
    expect(g.started).toEqual([first.row.taskId]);
    expect(
      g.coordinator
        .snapshot(server, 1)
        .rows.find((row) => row.taskId === queued.row.taskId),
    ).toMatchObject({ phase: "interrupted", recordError: true, active: false });
  });
});
