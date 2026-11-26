import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  TransferRunner,
  TransferIOFailure,
  type TransferPorts,
  type TransferSource,
} from "../../src/worker/transfers/runner";
import type { TransferReceipt } from "../../src/shared/transfers";
import { transferReceipt } from "../fixtures/transfers";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture(
  options: {
    direction?: "upload" | "download";
    data?: Buffer;
    corrupt?: boolean;
    truncated?: boolean;
    changed?: boolean;
    changedAtDispatch?: boolean;
    relayParentId?: string;
    expectedSha256?: string;
    beforeRead?: (row: TransferReceipt) => Promise<void>;
    confirmFailure?: Error;
    createFailure?: TransferIOFailure;
    linkFailure?: TransferIOFailure;
    cleanupFailure?: TransferIOFailure;
    failSave?: string;
    saveGate?: { stage: string; promise: Promise<void> };
    prepareGate?: Promise<void>;
    shutdownFailure?: boolean;
  } = {},
) {
  const data = options.data ?? Buffer.from("abc");
  const initial = transferReceipt(options.direction ?? "upload", data.length);
  if (options.relayParentId) initial.relayParentId = options.relayParentId;
  const trace: string[] = [];
  const durable: TransferReceipt[] = [];
  const updates: ReturnType<TransferRunner["snapshot"]>[] = [];
  let sourceStats = 0,
    temp: Buffer | null = null,
    final: Buffer | null = null,
    writes = 0,
    aborted = false;
  let lateCallback: (
    stage: "temp_create_ack" | "final_link_ack" | "temp_remove_ack",
  ) => void = () => {};
  const read =
    (bytes: Buffer) =>
    async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      const count = Math.max(0, Math.min(length, bytes.length - position));
      if (count) bytes.copy(buffer, offset, position, position + count);
      return count;
    };
  const runner = new TransferRunner(
    initial,
    (_row, signal, onLate) => {
      lateCallback = onLate;
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          trace.push("socket_close_requested");
        },
        { once: true },
      );
      const source: TransferSource = {
        read: async (buffer, offset, length, position) => {
          trace.push("source_read");
          return read(data)(buffer, offset, length, position);
        },
        stat: async () => {
          sourceStats++;
          return {
            ...initial.sourceInitialStat,
            mtime: options.changedAtDispatch || (options.changed && sourceStats > 1) ? "2" : "1",
          };
        },
        close: async () => {
          trace.push("source_close");
        },
      };
      const ports: TransferPorts = {
        prepare: async () => {
          trace.push("prepare");
          if (options.prepareGate)
            await Promise.race([
              options.prepareGate,
              new Promise<void>((_resolve, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), {
                  once: true,
                }),
              ),
            ]);
          return source;
        },
        createTemp: async () => {
          trace.push("temp_wx");
          if (options.createFailure) throw options.createFailure;
          temp = Buffer.alloc(data.length);
          return {
            write: async (bytes, offset, length, position) => {
              writes++;
              bytes.copy(temp!, position, offset, offset + length);
              return length;
            },
          };
        },
        finishWrite: async () => {
          trace.push("sync_and_close");
        },
        tempStat: async () => ({
          size: temp!.length,
          mtime: "1",
          identity: "temp",
        }),
        openVerification: async () => {
          trace.push("read_back");
          const contents = options.truncated
            ? Buffer.from(temp!).subarray(0, temp!.length - 1)
            : Buffer.from(temp!);
          if (options.corrupt && contents.length) contents[0] ^= 255;
          return {
            read: read(contents),
            stat: async () => ({
              size: temp!.length,
              mtime: "1",
              identity: "temp",
            }),
            close: async () => {
              trace.push("verify_close");
            },
          };
        },
        linkDestination: async () => {
          trace.push("exclusive_link");
          if (options.linkFailure) throw options.linkFailure;
          final = Buffer.from(temp!);
        },
        confirmDestination: async () => {
          trace.push("destination_stat");
          if (options.confirmFailure) throw options.confirmFailure;
        },
        removeTemp: async () => {
          trace.push("temp_unlink");
          if (options.cleanupFailure) throw options.cleanupFailure;
          temp = null;
        },
        shutdown: async () => {
          trace.push("resources_closed");
          if (options.shutdownFailure) throw new Error("Fixture close failure");
        },
      };
      return ports;
    },
    {
      beforeRead: options.beforeRead,
      persist: async (row) => {
        trace.push("save:" + row.stage + ":" + row.phase);
        if (options.failSave === row.stage)
          throw new Error("Fixture storage failure");
        if (options.saveGate?.stage === row.stage)
          await options.saveGate.promise;
        durable.push(structuredClone(row));
      },
      update: (row) => updates.push(row),
    },
    options.expectedSha256,
  );
  return {
    runner,
    trace,
    durable,
    updates,
    get writes() {
      return writes;
    },
    get final() {
      return final;
    },
    get temp() {
      return temp;
    },
    get aborted() {
      return aborted;
    },
    late: (stage: "temp_create_ack" | "final_link_ack" | "temp_remove_ack") =>
      lateCallback(stage),
  };
}
afterEach(() => vi.useRealTimers());
describe("durable non-overwriting transfer orchestration", () => {
  it("checks A metadata and available disk space before any temporary file creation or payload read", async () => {
    const relayParentId = crypto.randomUUID();
    const beforeRead = vi.fn(async () => { throw new Error("LOCAL_DISK_FULL"); });
    const options = { direction: "download" as const, relayParentId, beforeRead };
    const changed = fixture({ ...options, changedAtDispatch: true });
    expect((await changed.runner.run()).snapshot.errorCode).toBe("SOURCE_CHANGED");
    expect(beforeRead).not.toHaveBeenCalled();
    const blocked = fixture(options);
    expect((await blocked.runner.run()).snapshot).toMatchObject({
      phase: "failed", errorCode: "LOCAL_DISK_FULL", relayParentId, tempCreated: false, transferredBytes: 0,
    });
    expect(beforeRead).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ relayParentId, totalBytes: 3 }));
    expect(blocked.trace).not.toContain("source_read");
    expect(blocked.trace).not.toContain("temp_wx");
    expect(blocked.durable.some(row => row.stage === "temp_create_intent")).toBe(false);
    expect(blocked.final).toBeNull();
  });
  it("honors cancellation while a queued relay's local-space check waits", async () => {
    const entered = deferred<void>(), release = deferred<void>();
    const f = fixture({ direction: "download", relayParentId: crypto.randomUUID(),
      beforeRead: async () => { entered.resolve(); await release.promise; },
    });
    const run = f.runner.run();
    await entered.promise;
    expect(f.trace).not.toContain("source_read");
    expect(f.runner.cancel()).toBe("cancel_requested");
    release.resolve();
    expect(await run).toMatchObject({ resourcesClosed: true, snapshot: {
      phase: "cancelled", transferredBytes: 0, tempCreated: false,
    }});
    expect(f.trace).not.toContain("temp_wx");
  });
  it.each([Buffer.alloc(0), Buffer.alloc(180000, 0xfd)])(
    "binds both relay legs to the verified private snapshot digest (case %#)",
    async (data) => {
      const relayParentId = crypto.randomUUID();
      const a = fixture({ data, direction: "download", relayParentId });
      const download = await a.runner.run();
      const expectedSha256 = createHash("sha256").update(data).digest("hex");
      expect(download).toMatchObject({ resourcesClosed: true, snapshot: {
        phase: "completed", localTempIdentity: "temp", streamSha256: expectedSha256,
      }});
      expect(a.durable.find(row => row.stage === "temp_created")).toMatchObject({
        localTempIdentity: "temp", transferredBytes: 0,
      });
      const b = fixture({ data: a.final!, relayParentId, expectedSha256 });
      expect((await b.runner.run()).snapshot).toMatchObject({
        phase: "completed", verifiedBytes: data.length, streamSha256: expectedSha256,
      });
      expect(b.final).toEqual(data);
      expect(b.durable.some(row => row.localTempIdentity !== undefined)).toBe(false);
    },
  );
  it("refuses to publish a same-size replacement stage or altered B read-back", async () => {
    const original = Buffer.from([0, 1, 2]), expectedSha256 = createHash("sha256").update(original).digest("hex");
    for (const options of [{ data: Buffer.from([0, 9, 2]) }, { data: original, corrupt: true }]) {
      const f = fixture({ ...options, relayParentId: crypto.randomUUID(), expectedSha256 });
      expect((await f.runner.run()).snapshot).toMatchObject({
        phase: "failed", errorCode: "VERIFY_MISMATCH", destinationCreated: false, cleanupState: "needed",
      });
      expect(f.final).toBeNull();
      expect(f.trace).not.toContain("exclusive_link");
      expect(f.durable.some(row => row.dispatchAllowed)).toBe(false);
    }
  });
  it("keeps B publication unknown when observing the linked destination fails and never rolls it back", async () => {
    const data = Buffer.from("fixture"), expectedSha256 = createHash("sha256").update(data).digest("hex");
    const f = fixture({ data, relayParentId: crypto.randomUUID(), expectedSha256,
      confirmFailure: new Error("VERIFY_MISMATCH"),
    });
    expect((await f.runner.run()).snapshot).toMatchObject({
      phase: "result_unknown", errorCode: "VERIFY_MISMATCH", lastConfirmedPhase: "content_verified",
    });
    expect(f.final).toEqual(data);
    expect(f.trace.filter(event => event === "exclusive_link")).toHaveLength(1);
    expect(f.trace).not.toContain("temp_unlink");
    await expect(f.runner.run()).rejects.toThrow("INPUT_INVALID");
  });
  it.each(["upload", "download"] as const)(
    "orders intent, create, hash, exclusive link and completion for %s",
    async (direction) => {
      const f = fixture({ direction });
      const result = await f.runner.run();
      expect(result.snapshot).toMatchObject({
        phase: "completed",
        transferredBytes: 3,
        verifiedBytes: 3,
        destinationCreated: true,
        cleanupState: "confirmed",
        recordError: false,
        bytesPerSecond: null,
      });
      expect(f.final).toEqual(Buffer.from("abc"));
      expect(f.temp).toBeNull();
      expect(result.resourcesClosed).toBe(true);
      const at = (text: string) => f.trace.indexOf(text);
      expect(at("save:temp_create_intent:preparing")).toBeLessThan(
        at("temp_wx"),
      );
      expect(at("save:temp_created:preparing")).toBeLessThan(
        at("save:transferring:transferring"),
      );
      expect(at("sync_and_close")).toBeLessThan(at("read_back"));
      expect(at("verify_close")).toBeLessThan(
        at("save:final_link_intent:finalizing"),
      );
      expect(at("save:final_link_intent:finalizing")).toBeLessThan(
        at("exclusive_link"),
      );
      expect(at("save:destination_confirmed:finalizing")).toBeLessThan(
        at("temp_unlink"),
      );
      expect(at("save:completed:completed")).toBeLessThan(
        at("resources_closed"),
      );
      expect(
        f.durable.some((row) => row.phase === "finalize_intent_pending"),
      ).toBe(false);
    },
  );
  it("keeps zero-byte hash and close/read-back validation in both directions", async () => {
    for (const direction of ["upload", "download"] as const) {
      const f = fixture({ direction, data: Buffer.alloc(0) });
      const result = await f.runner.run();
      expect(result.snapshot.phase).toBe("completed");
      expect(result.snapshot.streamSha256).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      expect(f.writes).toBe(0);
      expect(f.trace).toContain("read_back");
    }
  });
  it("sends no temp creation or bytes when either prerequisite receipt fails", async () => {
    const before = fixture({ failSave: "temp_create_intent" });
    expect((await before.runner.run()).snapshot).toMatchObject({
      phase: "failed",
      recordError: true,
      errorCode: "STORAGE_FAILED",
    });
    expect(before.trace).not.toContain("temp_wx");
    const created = fixture({ failSave: "temp_created" });
    expect((await created.runner.run()).snapshot).toMatchObject({
      phase: "failed",
      tempCreated: true,
      cleanupState: "needed",
      recordError: true,
    });
    expect(created.writes).toBe(0);
    expect(created.trace).not.toContain("exclusive_link");
  });
  it("preserves existing temp/destination and refuses source change or hash mismatch", async () => {
    const collision = fixture({
      createFailure: new TransferIOFailure("NAME_CONFLICT"),
    });
    expect((await collision.runner.run()).snapshot.phase).toBe("failed");
    expect(collision.trace).not.toContain("temp_unlink");
    const destination = fixture({
      linkFailure: new TransferIOFailure("NAME_CONFLICT"),
    });
    expect((await destination.runner.run()).snapshot).toMatchObject({
      phase: "failed",
      cleanupState: "needed",
    });
    expect(destination.trace).not.toContain("temp_unlink");
    expect(destination.final).toBeNull();
    for (const options of [
      { changed: true },
      { corrupt: true },
      { truncated: true },
    ]) {
      const f = fixture(options);
      expect((await f.runner.run()).snapshot.errorCode).toBe(
        options.changed ? "SOURCE_CHANGED" : "VERIFY_MISMATCH",
      );
      expect(f.trace).not.toContain("exclusive_link");
    }
  });
  it("makes finalization win before its intent storage ACK and rejects cancellation while waiting", async () => {
    const gate = deferred<void>();
    const f = fixture({
      saveGate: { stage: "final_link_intent", promise: gate.promise },
    });
    const run = f.runner.run();
    for (
      let i = 0;
      i < 200 && f.runner.snapshot().phase !== "finalize_intent_pending";
      i++
    )
      await Promise.resolve();
    expect(f.runner.snapshot().phase).toBe("finalize_intent_pending");
    expect(() => f.runner.cancel()).toThrow("CANCEL_TOO_LATE");
    expect(f.trace).not.toContain("exclusive_link");
    gate.resolve();
    expect((await run).snapshot.phase).toBe("completed");
    const failure = fixture({ failSave: "final_link_intent" });
    expect((await failure.runner.run()).snapshot.errorCode).toBe(
      "STORAGE_FAILED",
    );
    expect(failure.trace).not.toContain("exclusive_link");
  });
  it("accepts cancellation first without linking and stops the task connection immediately", async () => {
    const gate = deferred<void>();
    const f = fixture({
      saveGate: { stage: "verifying", promise: gate.promise },
    });
    const run = f.runner.run();
    for (
      let i = 0;
      i < 200 && !f.trace.includes("save:verifying:verifying");
      i++
    )
      await Promise.resolve();
    expect(f.runner.cancel()).toBe("cancel_requested");
    expect(f.aborted).toBe(true);
    gate.resolve();
    expect((await run).snapshot).toMatchObject({
      phase: "cancelled",
      cleanupState: "needed",
    });
    expect(f.trace).not.toContain("exclusive_link");
    const queued = fixture();
    queued.runner.cancel();
    expect((await queued.runner.run()).snapshot.phase).toBe("cancelled");
    expect(queued.trace).not.toContain("prepare");
  });
  it("keeps lost mutation ACK unknown and appends late ACK as observation without promotion", async () => {
    for (const stage of ["temp", "link"] as const) {
      const f = fixture(
        stage === "temp"
          ? { createFailure: new TransferIOFailure("CONNECTION_LOST", true) }
          : { linkFailure: new TransferIOFailure("CONNECTION_LOST", true) },
      );
      const result = await f.runner.run();
      expect(result.snapshot.phase).toBe("result_unknown");
      f.late(stage === "temp" ? "temp_create_ack" : "final_link_ack");
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(f.runner.snapshot().phase).toBe("result_unknown");
      expect(f.runner.snapshot().lateObservations).toHaveLength(1);
      expect(f.durable.at(-1)?.phase).toBe("result_unknown");
    }
  });
  it("separates destination success from temp cleanup failure and lost ACK", async () => {
    for (const uncertain of [false, true]) {
      const f = fixture({
        cleanupFailure: new TransferIOFailure("PERMISSION_DENIED", uncertain),
      });
      expect((await f.runner.run()).snapshot).toMatchObject({
        phase: "completed",
        destinationCreated: true,
        cleanupState: uncertain ? "unknown" : "needed",
      });
      expect(f.final).toEqual(Buffer.from("abc"));
    }
    const failed = fixture({ failSave: "completed" });
    expect((await failed.runner.run()).snapshot).toMatchObject({
      phase: "result_unknown",
      destinationCreated: true,
      cleanupState: "confirmed",
      recordError: true,
      errorCode: "STORAGE_FAILED",
    });
    expect(failed.durable.at(-1)?.phase).toBe("finalizing");
    expect(failed.final).toEqual(Buffer.from("abc"));
  });
  it("applies30s no-progress and limits nonterminal progress events to4Hz", async () => {
    vi.useFakeTimers();
    const gate = deferred<void>();
    const f = fixture({ prepareGate: gate.promise });
    const run = f.runner.run();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30001);
    const result = await run;
    expect(f.aborted).toBe(true);
    expect(result.snapshot).toMatchObject({
      phase: "interrupted",
      errorCode: "IO_TIMEOUT",
    });
    expect(f.trace).not.toContain("temp_wx");
    const fast = fixture({ data: Buffer.alloc(2 * 1024 * 1024, 65) });
    expect((await fast.runner.run()).snapshot.phase).toBe("completed");
    expect(
      fast.updates.filter(
        (row) =>
          ![
            "completed",
            "failed",
            "interrupted",
            "cancelled",
            "result_unknown",
          ].includes(row.phase),
      ),
    ).toHaveLength(1);
  });
});
