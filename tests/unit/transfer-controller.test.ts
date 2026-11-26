import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { relayReceiptSchema } from "../../src/shared/relay";
import { RelayDiskLedger } from "../../src/platform/local-files/relay-disk";
import { TransferController } from "../../src/main/transfers/transfers";
import { ReceiptRepository } from "../../src/main/persistence/receipts";
import type {
  TransferPreviews,
  ConfirmedTransfer,
} from "../../src/main/transfers/transfer-previews";
import type { TransferSelections } from "../../src/main/transfers/transfer-selections";
import type { ConnectionController } from "../../src/main/connections/connections";
import type { EngineGateway } from "../../src/main/engine-gateway";
import type {
  TransferRuntime,
  StagedTransfer,
} from "../../src/shared/transfer-protocol";
import { transferReceipt } from "../fixtures/transfers";
const owned: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of owned.splice(0)) await rm(root, { recursive: true });
});
async function fixture(
  count = 2,
  direction: "upload" | "download" = "upload",
  disk?: RelayDiskLedger,
) {
  await mkdir(resolve(".local/tmp"), { recursive: true });
  const root = await mkdtemp(resolve(".local/tmp/main-transfers-"));
  owned.push(root);
  const repo = await ReceiptRepository.open(root),
    epoch = crypto.randomUUID(),
    serverId = crypto.randomUUID(),
    sessionToken = crypto.randomUUID();
  const specs: StagedTransfer[] = Array.from({ length: count }, () => {
    const row = transferReceipt(direction);
    row.serverId = serverId;
    row.backendEpoch = epoch;
    row.destination += "-" + row.taskId;
    return { row, localDirectory: { path: row.localParent, identity: "1:2" } };
  });
  const batch: ConfirmedTransfer = {
    serverId,
    generation: 1,
    sessionToken,
    epoch,
    specs,
    selectionTokens: [crypto.randomUUID()],
  };
  let valid = true,
    stageFailure = false,
    gate: Promise<void> | null = null;
  let tokenUsed = false;
  const previews = {
    consume: () => {
      if (tokenUsed) throw new Error("TOKEN_EXPIRED");
      tokenUsed = true;
      return structuredClone(batch);
    },
    invalidate: vi.fn(),
  } as unknown as TransferPreviews;
  const selections = {
    release: vi.fn(),
    invalidate: vi.fn(),
  } as unknown as TransferSelections;
  const connections = {
    sessionCapability: () => {
      if (!valid) throw new Error("TOKEN_EXPIRED");
      return { serverId, generation: 1 };
    },
  } as unknown as ConnectionController;
  const requests: { action: string }[] = [];
  let snapshot: TransferRuntime[] = [];
  let sequence = 10;
  const gateway = {
    epoch,
    request: vi.fn(async (request: { action: string; index?: number }) => {
      requests.push(request);
      if (
        request.action === "transfer:stage" &&
        request.index === 1 &&
        stageFailure
      )
        throw new Error("CONNECTION_LOST");
      if (request.action === "transfer:commit") {
        expect(
          specs.every((spec) => repo.get(spec.row.taskId)?.phase === "queued"),
        ).toBe(true);
        if (gate) await gate;
        return specs.map((spec) => spec.row.taskId);
      }
      if (request.action === "transfer:snapshot")
        return { rows: snapshot, sequence, nextOffset: null };
      return undefined;
    }),
  } as unknown as EngineGateway;
  const controller = new TransferController(
    previews,
    selections,
    connections,
    gateway,
    () => repo,
    () => true,
    async () => {},
    disk,
  );
  const runtime = (
    index: number,
    phase: TransferRuntime["phase"] = "transferring",
  ): TransferRuntime => {
    const row = specs[index]!.row;
    return {
      taskId: row.taskId,
      serverId,
      generation: 1,
      phase,
      totalBytes: row.totalBytes,
      transferredBytes: 1,
      verifiedBytes: 0,
      bytesPerSecond: 12,
      cleanupState: "needed",
      tempCreated: true,
      destinationCreated: false,
      lastConfirmedPhase: "temp_created",
      errorCode: null,
      updatedAt: new Date().toISOString(),
      recordError: false,
      active: true,
      slotOccupied: true,
      cleanupPending: false,
    };
  };
  return {
    controller,
    repo,
    specs,
    batch,
    requests,
    runtime,
    selections,
    gateway,
    connections,
    rotateEngine: () => {
      (gateway as unknown as { epoch: string }).epoch = crypto.randomUUID();
    },
    start: () => controller.handle("transfer:start", crypto.randomUUID()),
    failStage: () => {
      stageFailure = true;
    },
    invalidate: () => {
      valid = false;
    },
    setGate: (value: Promise<void>) => {
      gate = value;
    },
    setSnapshot: (rows: TransferRuntime[], seq: number) => {
      snapshot = rows;
      sequence = seq;
    },
  };
}
describe("main-owned transfer acceptance", () => {
  it("binds relay dispatch and closure to the parent's durable child ID", async () => {
    const f = await fixture(1, "download");
    const spec = f.specs[0]!;
    await expect(
      f.controller.registerRelay(spec, f.batch.sessionToken),
    ).rejects.toThrow("INPUT_INVALID");
    const row = spec.row;
    const origin = {
      ...row.endpointSnapshot,
      hostKeyFingerprint: row.hostKeyFingerprint,
      serverId: row.serverId,
      generation: row.generation,
      path: row.source,
    };
    const target = {
      ...origin,
      serverId: crypto.randomUUID(),
      host: "b.invalid",
      endpoint: "b.invalid:22",
      path: "/home/copied",
    };
    const parentId = crypto.randomUUID();
    row.relayParentId = parentId;
    spec.relay = { parentId };
    await f.repo.save(
      relayReceiptSchema.parse({
        kind: "server_relay",
        taskId: parentId,
        serverId: row.serverId,
        generation: row.generation,
        backendEpoch: row.backendEpoch,
        endpointSnapshot: row.endpointSnapshot,
        hostKeyFingerprint: row.hostKeyFingerprint,
        origin,
        target,
        source: row.source,
        destination: target.path,
        size: row.totalBytes,
        sourceStat: row.sourceInitialStat,
        legIds: [row.taskId],
        downloadId: row.taskId,
        uploadId: null,
        stageArea: {
          jobId: parentId,
          root: spec.localDirectory,
          directory: spec.localDirectory,
          volumeId: "1",
          filePath: row.destination,
        },
        stageStat: null,
        digest: null,
        phase: "queued",
        lastConfirmedPhase: "accepted",
        publication: "none",
        localCleanup: "needed",
        remoteCleanup: "none",
        errorCode: null,
        acknowledgedAt: null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
    );
    const observed = vi.fn();
    f.controller.onRelaySettled(observed);
    await f.controller.registerRelay(spec, f.batch.sessionToken);
    expect(f.requests[0]).toMatchObject({
      action: "transfer:reserve",
      relayParentId: parentId,
      count: 1,
    });
    await f.controller.cancelForShutdown();
    expect(f.requests.some((q) => q.action === "transfer:cancel")).toBe(false);
    const terminal = {
      ...f.runtime(0),
      phase: "interrupted" as const,
      active: false,
      cleanupPending: false,
    };
    f.controller.observe(terminal, false, 20);
    expect(f.controller.isActive(row.taskId)).toBe(true);
    expect(observed).not.toHaveBeenCalled();
    f.controller.observe({ ...terminal, slotOccupied: false }, false, 21);
    expect(observed).toHaveBeenCalledOnce();
    expect(f.controller.isActive(row.taskId)).toBe(false);

    // An ordinary shelf must omit the retained parent and every failed owned attempt.
    await f.repo.save({
      ...row,
      phase: "failed",
      stage: "failed",
      tempCreated: true,
      cleanupState: "needed",
    });
    expect(f.controller.shelf()).toMatchObject({ failed: 0, unresolved: 0 });
    const ordinary = transferReceipt();
    await f.repo.save({
      ...ordinary,
      phase: "failed",
      stage: "failed",
      tempCreated: true,
      cleanupState: "needed",
    });
    expect(f.controller.shelf()).toMatchObject({ failed: 1, unresolved: 1 });
  });
  it("rolls back a partially admitted download batch before dispatch", async () => {
    const disk = new RelayDiskLedger();
    const reserve = vi
      .spyOn(disk, "reserveOrdinary")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Error("LOCAL_DISK_FULL"));
    const release = vi.spyOn(disk, "release");
    const f = await fixture(2, "download", disk);
    await expect(f.start()).rejects.toThrow("LOCAL_DISK_FULL");
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(release.mock.calls).toEqual([[f.specs[0]!.row.taskId]]);
    expect(f.requests).toEqual([]);
    expect(f.repo.snapshots()).toEqual([]);
  });
  it("retains an ordinary download reservation until the transfer slot has closed", async () => {
    const disk = new RelayDiskLedger();
    vi.spyOn(disk, "reserveOrdinary").mockResolvedValue();
    const release = vi.spyOn(disk, "release");
    const f = await fixture(1, "download", disk);
    await f.start();
    const runtime = {
      ...f.runtime(0),
      phase: "interrupted" as const,
      active: false,
    };
    f.controller.observe(runtime, false, 20);
    expect(release).not.toHaveBeenCalled();
    f.controller.observe({ ...runtime, slotOccupied: false }, false, 21);
    expect(release.mock.calls).toEqual([[runtime.taskId]]);
  });
  it("rejects an old engine, mismatched session owner or faulted repository before reserving any batch", async () => {
    const f = await fixture(1);
    f.rotateEngine();
    await expect(f.start()).rejects.toThrow("ENGINE_STOPPED");
    expect(f.requests).toEqual([]);
    const g = await fixture(1);
    vi.spyOn(g.connections, "sessionCapability").mockReturnValue({
      serverId: crypto.randomUUID(),
      generation: 1,
    });
    await expect(g.start()).rejects.toThrow("TOKEN_EXPIRED");
    expect(g.requests).toEqual([]);
    const h = await fixture(1);
    h.repo.markFault();
    await expect(h.start()).rejects.toThrow("STORAGE_FAILED");
    expect(h.requests).toEqual([]);
  });
  it("retains a terminal event received while commit is pending and retires it only after exact commit response", async () => {
    const f = await fixture(1);
    let release!: () => void;
    f.setGate(
      new Promise((done) => {
        release = done;
      }),
    );
    const pending = f.start();
    await vi.waitFor(() =>
      expect(f.requests.at(-1)?.action).toBe("transfer:commit"),
    );
    expect(f.controller.isRegistering).toBe(true);
    const done = {
      ...f.runtime(0),
      phase: "completed" as const,
      active: false,
      slotOccupied: false,
      cleanupPending: false,
      destinationCreated: true,
      cleanupState: "confirmed" as const,
    };
    f.controller.observe({ ...done, generation: 2 }, false, 99);
    expect(f.controller.overlays()[0]?.phase).toBe("queued");
    f.controller.observe(done, false, 100);
    expect(f.controller.overlays()).toHaveLength(1);
    release();
    await pending;
    expect(f.controller.isRegistering).toBe(false);
    expect(f.controller.overlays()).toEqual([]);
    expect(f.controller.taskState(done.taskId)).toMatchObject({
      active: false,
      cancelable: false,
      registering: false,
      bytesPerSecond: null,
    });
  });
  it("releases an uncommitted reservation when authority changes during registration and never stages it", async () => {
    const f = await fixture(1),
      original = vi.mocked(f.gateway.request).getMockImplementation()!;
    vi.mocked(f.gateway.request).mockImplementation(async (request) => {
      const response = await original(request);
      if (request.action === "transfer:reserve") f.invalidate();
      return response;
    });
    await expect(f.start()).rejects.toThrow("TOKEN_EXPIRED");
    expect(f.requests.map((request) => request.action)).toEqual([
      "transfer:reserve",
      "transfer:release",
    ]);
    expect(f.repo.snapshots()).toEqual([]);
    expect(f.selections.release).toHaveBeenCalledWith(f.batch.selectionTokens);
  });
  it("does not replay a commit with an unknown response and accepts only exact ordered task IDs", async () => {
    const f = await fixture(1),
      original = vi.mocked(f.gateway.request).getMockImplementation()!;
    vi.mocked(f.gateway.request).mockImplementation(async (request) => {
      if (request.action === "transfer:commit") {
        f.requests.push(request);
        throw new Error("CONNECTION_LOST");
      }
      return original(request);
    });
    await expect(f.start()).rejects.toThrow("CONNECTION_LOST");
    expect(
      f.requests.filter((request) => request.action === "transfer:commit"),
    ).toHaveLength(1);
    expect(
      f.requests.some((request) => request.action === "transfer:release"),
    ).toBe(false);
    expect(f.controller.taskState(f.specs[0]!.row.taskId)).toMatchObject({
      active: true,
      registering: false,
      cancelable: true,
    });
    const g = await fixture(1),
      other = vi.mocked(g.gateway.request).getMockImplementation()!;
    vi.mocked(g.gateway.request).mockImplementation(async (request) =>
      request.action === "transfer:commit"
        ? [crypto.randomUUID()]
        : other(request),
    );
    await expect(g.start()).rejects.toThrow("INTERNAL_ERROR");
    expect(g.controller.overlays()).toHaveLength(1);
  });
  it("reports finalizing/cleanup ownership, rejects active acknowledgement and removes only settled jobs", async () => {
    const f = await fixture(1);
    await f.start();
    const id = f.specs[0]!.row.taskId;
    expect(f.controller.hasFinalizing()).toBe(false);
    const final = { ...f.runtime(0), phase: "finalizing" as const };
    f.controller.observe(final, false, 1);
    expect(f.controller.hasFinalizing()).toBe(true);
    expect(f.controller.hasFinalizing(final.serverId, 1)).toBe(true);
    expect(f.controller.hasFinalizing(final.serverId, 2)).toBe(false);
    expect(f.controller.taskState(id)).toMatchObject({
      active: true,
      cancelable: false,
    });
    await expect(f.controller.acknowledge(f.specs[0]!.row)).rejects.toThrow(
      "REQUEST_BUSY",
    );
    f.controller.observe(
      {
        ...final,
        phase: "failed",
        active: false,
        slotOccupied: false,
        cleanupPending: true,
      },
      false,
      2,
    );
    expect(f.controller.isActive(id)).toBe(true);
    f.controller.observe(
      {
        ...final,
        phase: "failed",
        active: false,
        slotOccupied: false,
        cleanupPending: false,
        recordError: true,
      },
      false,
      3,
    );
    expect(f.controller.isActive(id)).toBe(false);
    vi.mocked(f.gateway.request).mockRejectedValueOnce(
      new Error("CONNECTION_LOST"),
    );
    await expect(f.controller.acknowledge(f.specs[0]!.row)).rejects.toThrow(
      "CONNECTION_LOST",
    );
    vi.mocked(f.gateway.request).mockRejectedValueOnce(
      new Error("ENGINE_STOPPED"),
    );
    await f.controller.acknowledge(f.specs[0]!.row);
    expect(f.controller.overlays()).toEqual([]);
    await expect(f.controller.handle("transfer:cancel", id)).rejects.toThrow(
      "TOKEN_EXPIRED",
    );
  });
  it("retries busy shutdown cancellation within its bounded ownership and stops when the engine changes", async () => {
    const f = await fixture(1);
    await f.start();
    const original = vi.mocked(f.gateway.request).getMockImplementation()!;
    let calls = 0;
    vi.mocked(f.gateway.request).mockImplementation(async (request) => {
      if (request.action === "transfer:cancel") {
        calls++;
        if (calls === 1) throw new Error("REQUEST_BUSY");
      }
      return original(request);
    });
    await f.controller.cancelForShutdown(crypto.randomUUID(), 1);
    expect(calls).toBe(0);
    await f.controller.cancelForShutdown(f.batch.serverId, 1);
    expect(calls).toBe(2);
    vi.mocked(f.gateway.request).mockImplementation(async (request) => {
      if (request.action === "transfer:cancel") {
        calls++;
        f.rotateEngine();
        throw new Error("REQUEST_BUSY");
      }
      return original(request);
    });
    await f.controller.cancelForShutdown();
    expect(calls).toBe(3);
  });
  it("retains visible recovery failure when durable storage remains unavailable and rejects malformed control payloads", async () => {
    const f = await fixture(1);
    await f.start();
    vi.spyOn(f.repo, "save").mockRejectedValue(new Error("STORAGE_FAILED"));
    await f.controller.engineStopped();
    expect(f.controller.overlays()[0]).toMatchObject({
      recordError: true,
      phase: "interrupted",
    });
    for (const action of [
      "transfer:pickUploadFiles",
      "transfer:pickDownloadDirectory",
      "transfer:shelf",
    ])
      await expect(f.controller.handle(action, {})).rejects.toThrow(
        "INPUT_INVALID",
      );
    await expect(
      f.controller.handle("transfer:invalid", undefined),
    ).rejects.toThrow("INPUT_INVALID");
    expect(
      await f.controller.handle("transfer:shelf", undefined),
    ).toMatchObject({ active: [], registering: 0 });
  });
  it("reserves the whole batch, durably saves every row and stages all rows before one commit", async () => {
    const f = await fixture();
    expect(await f.start()).toEqual(f.specs.map((spec) => spec.row.taskId));
    expect(f.requests.map((row) => row.action)).toEqual([
      "transfer:reserve",
      "transfer:stage",
      "transfer:stage",
      "transfer:commit",
    ]);
    expect(f.controller.shelf()).toMatchObject({ queued: 2, registering: 0 });
    expect(f.selections.release).toHaveBeenCalledWith(f.batch.selectionTokens);
    await expect(f.start()).rejects.toThrow("TOKEN_EXPIRED");
  });
  it("never commits a partially staged batch and interrupts already saved intents", async () => {
    const f = await fixture();
    f.failStage();
    await expect(f.start()).rejects.toThrow("CONNECTION_LOST");
    expect(f.requests.map((row) => row.action)).not.toContain(
      "transfer:commit",
    );
    expect(f.requests.at(-1)?.action).toBe("transfer:release");
    expect(f.repo.snapshots().every((row) => row.phase === "interrupted")).toBe(
      true,
    );
    expect(f.controller.overlays()).toEqual([]);
  });
  it("refuses dispatch after durable storage failure and marks visible registration failure", async () => {
    const f = await fixture();
    const save = f.repo.save.bind(f.repo);
    let writes = 0;
    vi.spyOn(f.repo, "save").mockImplementation(async (row) => {
      if (++writes >= 2) {
        f.repo.markFault();
        throw new Error("STORAGE_FAILED");
      }
      await save(row);
    });
    await expect(f.start()).rejects.toThrow("STORAGE_FAILED");
    expect(f.requests.map((row) => row.action)).not.toContain(
      "transfer:commit",
    );
    expect(f.controller.overlays()[0]).toMatchObject({
      phase: "interrupted",
      recordError: true,
    });
  });
  it("keeps accepted jobs across renderer invalidation and prevents cancellation during registration", async () => {
    const f = await fixture(1);
    let release!: () => void;
    f.setGate(
      new Promise<void>((done) => {
        release = done;
      }),
    );
    const starting = f.start();
    await vi.waitFor(() =>
      expect(f.requests.at(-1)?.action).toBe("transfer:commit"),
    );
    const id = f.specs[0]!.row.taskId;
    await expect(f.controller.handle("transfer:cancel", id)).rejects.toThrow(
      "REQUEST_BUSY",
    );
    f.controller.invalidateRenderer();
    release();
    await starting;
    await f.controller.handle("transfer:cancel", id);
    expect(f.requests.at(-1)?.action).toBe("transfer:cancel");
  });
  it("ignores unregistered/stale events and refuses an old resync snapshot to rewind newer progress", async () => {
    const f = await fixture(1);
    await f.start();
    const old = f.runtime(0),
      newer = { ...old, transferredBytes: 2 };
    f.setSnapshot([old], 10);
    f.controller.observe(old, true, 9);
    f.controller.observe(newer, false, 11);
    await vi.waitFor(() =>
      expect(f.requests.at(-1)?.action).toBe("transfer:snapshot"),
    );
    await Promise.resolve();
    expect(f.controller.overlays()[0]?.transferredBytes).toBe(2);
    f.controller.observe({ ...newer, taskId: crypto.randomUUID() }, false, 12);
    expect(f.controller.shelf().active).toHaveLength(1);
  });
  it("uses a consistent worker snapshot and durable terminal receipt when a completion event was lost", async () => {
    const f = await fixture(1);
    await f.start();
    const row = f.specs[0]!.row;
    f.controller.observe(f.runtime(0), false, 1);
    await f.repo.save({
      ...row,
      phase: "completed",
      destinationCreated: true,
      transferredBytes: 3,
      verifiedBytes: 3,
      streamSha256: "a".repeat(64),
      cleanupState: "confirmed",
    });
    f.setSnapshot([], 10);
    f.controller.observe(
      { ...f.runtime(0), taskId: crypto.randomUUID() },
      true,
      9,
    );
    await vi.waitFor(() => expect(f.controller.overlays()).toEqual([]));
    expect(f.controller.shelf().active).toEqual([]);
  });
  it("recovers an engine loss from the durable finalizing intent without inventing success", async () => {
    const f = await fixture(1);
    await f.start();
    const spec = f.specs[0]!,
      row = {
        ...spec.row,
        phase: "finalizing" as const,
        stage: "finalize_intent",
        dispatchAllowed: true,
        tempCreated: true,
        cleanupState: "needed" as const,
      };
    await f.repo.save(row);
    f.controller.observe({ ...f.runtime(0), phase: "finalizing" }, false, 1);
    await f.controller.engineStopped();
    expect(f.repo.get(row.taskId)).toMatchObject({
      phase: "result_unknown",
      recoveredFromPhase: "finalizing",
      destinationCreated: false,
    });
    expect(f.controller.shelf()).toMatchObject({ active: [], unresolved: 1 });
  });
});

it("releases historical transfer records after engine replacement without sending them to the new worker", async () => {
  const f = await fixture(1);
  await f.start();
  await f.controller.engineStopped();
  const count = f.requests.length;
  f.rotateEngine();
  await f.controller.acknowledge(f.specs[0]!.row);
  expect(f.requests).toHaveLength(count);
});

it("cancels a full100-item queue using at most four concurrent cleanup RPCs", async () => {
  const f = await fixture(100);
  const stored = new Map<
    string,
    import("../../src/shared/receipts").OperationReceipt
  >();
  vi.spyOn(f.repo, "save").mockImplementation(async (row) => {
    stored.set(row.taskId, structuredClone(row));
  });
  vi.spyOn(f.repo, "get").mockImplementation((id) => stored.get(id));
  await f.start();
  const send = f.gateway.request.bind(f.gateway);
  let active = 0,
    peak = 0;
  const ids: string[] = [];
  vi.spyOn(f.gateway, "request").mockImplementation(async (request) => {
    if (request.action !== "transfer:cancel") return send(request);
    active++;
    peak = Math.max(peak, active);
    ids.push(request.taskId);
    await new Promise((done) => setTimeout(done, 1));
    active--;
    return undefined;
  });
  await f.controller.cancelForShutdown();
  expect(ids).toHaveLength(100);
  expect(new Set(ids).size).toBe(100);
  expect(peak).toBe(4);
});

it.each(["repeated", "page_limit", "changing_sequence", "old_epoch"] as const)(
  "bounds transfer snapshot repair and preserves ownership for %s",
  async (mode) => {
    const f = await fixture(1);
    await f.start();
    f.controller.observe(f.runtime(0), false, 1);
    if (mode === "page_limit") {
      const row = f.specs[0]!.row;
      await f.repo.save({
        ...row,
        phase: "completed",
        destinationCreated: true,
        transferredBytes: row.totalBytes,
        verifiedBytes: row.totalBytes,
        streamSha256: "a".repeat(64),
        cleanupState: "confirmed",
      });
    }
    let calls = 0;
    const original = f.gateway.request.bind(f.gateway);
    vi.mocked(f.gateway.request).mockImplementation(async (request) => {
      if (request.action !== "transfer:snapshot") return original(request);
      calls++;
      if (calls > 105) throw new Error("test safety bound");
      if (mode === "old_epoch") {
        f.rotateEngine();
        return {
          sequence: 10,
          rows: [{ ...f.runtime(0), transferredBytes: 2 }],
          nextOffset: null,
        };
      }
      if (mode === "repeated") return { sequence: 10, rows: [], nextOffset: 0 };
      if (mode === "page_limit")
        return { sequence: 10, rows: [], nextOffset: request.offset + 1 };
      return {
        sequence: calls,
        rows: [],
        nextOffset: request.offset === 0 ? 1 : null,
      };
    });
    f.controller.observe(
      { ...f.runtime(0), taskId: crypto.randomUUID() },
      true,
      2,
    );
    await vi.waitFor(() =>
      expect(calls).toBe(
        mode === "page_limit" ? 100 : mode === "changing_sequence" ? 6 : 1,
      ),
    );
    await new Promise((done) => setImmediate(done));
    expect(calls).toBe(
      mode === "page_limit" ? 100 : mode === "changing_sequence" ? 6 : 1,
    );
    expect(f.controller.overlays()).toHaveLength(1);
    expect(f.controller.overlays()[0]?.transferredBytes).toBe(1);
  },
);
