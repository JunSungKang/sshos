import { afterEach, describe, it, expect, vi } from "vitest";
import {
  runShutdown,
  shutdownSummary,
  inShutdownScope,
  relayQuitInventory,
  discardQuitStages,
} from "../../src/main/lifecycle/shutdown";
import type { RelayReceipt } from "../../src/shared/relay";
import { executionReceipt } from "../fixtures/executions";
import { transferReceipt } from "../fixtures/transfers";
afterEach(() => vi.useRealTimers());
function stagedRelay(size = 32) {
  const child = transferReceipt("download", size),
    taskId = crypto.randomUUID();
  const endpoint = {
    ...child.endpointSnapshot,
    generation: 1,
    hostKeyFingerprint: child.hostKeyFingerprint,
  };
  const stageStat = { size, identity: "disk:file", mtime: "1" };
  const area = {
    jobId: taskId,
    root: { path: "/stage", identity: "disk:root" },
    directory: { path: "/stage/job", identity: "disk:dir" },
    volumeId: "disk",
    filePath: "/stage/job/payload",
  };
  const row: RelayReceipt = {
    kind: "server_relay",
    taskId,
    serverId: child.serverId,
    generation: 1,
    endpointSnapshot: child.endpointSnapshot,
    backendEpoch: child.backendEpoch,
    hostKeyFingerprint: child.hostKeyFingerprint,
    source: "/a",
    destination: "/b",
    size,
    sourceStat: child.sourceInitialStat,
    origin: { ...endpoint, serverId: child.serverId, path: "/a" },
    target: { ...endpoint, serverId: crypto.randomUUID(), path: "/b" },
    legIds: [child.taskId],
    downloadId: child.taskId,
    uploadId: null,
    stageArea: area,
    stageStat,
    digest: "a".repeat(64),
    phase: "failed",
    lastConfirmedPhase: "verified",
    publication: "none",
    localCleanup: "needed",
    remoteCleanup: "none",
    errorCode: null,
    recoveryUncertain: false,
    recoveredFromPhase: null,
    acknowledgedAt: null,
    createdAt: child.createdAt,
    updatedAt: child.updatedAt,
  };
  return {
    row,
    child: {
      ...child,
      relayParentId: taskId,
      localTempIdentity: stageStat.identity,
    },
  };
}

describe("local relay stages at exit", () => {
  it("counts linked verified bytes once, distinguishes partial observations and freezes only confirmed safe targets", () => {
    const full = stagedRelay(),
      partial = stagedRelay(),
      unknown = stagedRelay(),
      busy = stagedRelay(),
      unowned = stagedRelay();
    const rows = [
      full.row,
      full.child,
      { ...partial.row, stageStat: null, digest: null },
      { ...partial.child, transferredBytes: 7 },
      {
        ...unknown.row,
        publication: "unknown" as const,
        recoveryUncertain: true,
      },
      busy.row,
      { ...unowned.row, stageStat: null, digest: null },
    ];
    const inventory = relayQuitInventory(rows, (id) => id !== busy.row.taskId);
    expect([...inventory.candidates.keys()]).toEqual([
      full.row.taskId,
      partial.row.taskId,
    ]);
    expect(inventory.count).toBe(5);
    expect(inventory.detail).toContain("검증 사본 2개 · 파일 크기 합계 64 B");
    expect(inventory.detail).toContain("부분 파일 또는 상태 미확인 3건");
    expect(inventory.detail).toContain("1건의 전송 기록 7 B");
    expect(
      shutdownSummary(rows, () => false, null, inventory.detail),
    ).toContain(inventory.detail);
    expect(
      shutdownSummary(rows, () => false, {
        serverId: full.row.target.serverId,
        generation: 1,
      }),
    ).toContain("검증 사본 1개");
    expect(
      relayQuitInventory([{ ...full.row, stageArea: null }], () => true).count,
    ).toBe(0);
  });
  it("discards only the original identities, stops on a superseded attempt and leaves newly eligible files alone", async () => {
    const a = stagedRelay(),
      b = stagedRelay(),
      c = stagedRelay();
    const shown = relayQuitInventory([a.row, b.row], () => true).candidates;
    const latest = () =>
      relayQuitInventory(
        [a.row, { ...b.row, uploadId: crypto.randomUUID() }, c.row],
        () => true,
      ).candidates;
    const removed: string[] = [];
    const result = await discardQuitStages(
      shown,
      latest,
      async (id, authorized) => {
        if (!authorized()) throw Error("TOKEN_EXPIRED");
        removed.push(id);
      },
      1000,
    );
    expect(result).toEqual({ completed: 1, error: "TOKEN_EXPIRED" });
    expect(removed).toEqual([a.row.taskId]);
    expect(
      await discardQuitStages(
        shown,
        () => shown,
        async (_id, authorized) => {
          expect(authorized()).toBe(true);
        },
        1000,
      ),
    ).toEqual({ completed: 2, error: null });
  });
  it("invalidates queued removal after the shared timeout and does not report in-flight deletes as confirmed", async () => {
    vi.useFakeTimers();
    const shown = new Map([
      ["1", "first"],
      ["2", "second"],
    ]);
    let unblock!: () => void;
    const wait = new Promise<void>((done) => {
      unblock = done;
    });
    const actuallyRemoved: string[] = [];
    const operation = discardQuitStages(
      shown,
      () => shown,
      async (id, authorized) => {
        await wait;
        if (!authorized()) throw Error("TOKEN_EXPIRED");
        actuallyRemoved.push(id);
      },
      20,
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(await operation).toEqual({ completed: 0, error: "IO_TIMEOUT" });
    unblock();
    await vi.advanceTimersByTimeAsync(1);
    expect(actuallyRemoved).toEqual([]);
    expect(
      await discardQuitStages(
        shown,
        () => shown,
        async () => {},
        0,
      ),
    ).toEqual({ completed: 0, error: "IO_TIMEOUT" });
  });
});
describe("bounded aggregate shutdown", () => {
  it("waits for an in-flight finalization, then disconnects and settles without a second budget", async () => {
    vi.useFakeTimers();
    const trace: string[] = [];
    let finalizing = true,
      active = true;
    const operation = runShutdown({
      interrupt: async () => {
        trace.push("cancel-and-close");
      },
      finalizing: () => finalizing,
      disconnect: async () => {
        trace.push("disconnect");
        active = false;
      },
      active: () => active,
      settled: async () => {
        trace.push("settled");
      },
    });
    await vi.advanceTimersByTimeAsync(9000);
    expect(trace).toEqual(["cancel-and-close"]);
    finalizing = false;
    await vi.advanceTimersByTimeAsync(20);
    expect(await operation).toEqual({ timedOut: false });
    expect(trace).toEqual(["cancel-and-close", "disconnect", "settled"]);
  });
  it("dispatches socket closure exactly once by10s even when cancellation never answers and never resumes late work", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const held = new Promise<void>((done) => {
        release = done;
      }),
      disconnect = vi.fn(async () => {}),
      settled = vi.fn(async () => {});
    const operation = runShutdown({
      interrupt: () => held,
      finalizing: () => true,
      disconnect,
      active: () => true,
      settled,
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await operation).toEqual({ timedOut: true });
    expect(disconnect).toHaveBeenCalledOnce();
    release();
    await vi.advanceTimersByTimeAsync(20000);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(settled).not.toHaveBeenCalled();
  });
  it("counts active kinds and local uncertainty while escaping filenames in the native confirmation summary", () => {
    const gui = {
        ...executionReceipt(),
        phase: "running" as const,
        channelAccepted: true,
      },
      ptyId = crypto.randomUUID(),
      pty = {
        ...executionReceipt(),
        kind: "pty" as const,
        taskId: ptyId,
        executionId: null,
        terminalId: ptyId,
        source: null,
        cwd: null,
      },
      queued = transferReceipt(),
      unknown = {
        ...executionReceipt(),
        phase: "result_unknown" as const,
        source: "/home/name\nforged",
      };
    const summary = shutdownSummary(
      [gui, pty, queued, unknown],
      (id) => id !== unknown.taskId,
      null,
    );
    expect(summary).toContain("대기 1");
    expect(summary).toContain("GUI 실행 1 · PTY 1 · 미확인 1");
    expect(summary).not.toContain("name\nforged");
  });
});

it("scopes native counts to the exact generation, includes mutations/active transfers and bounds long untrusted labels", () => {
  const transfer = { ...transferReceipt(), phase: "transferring" as const },
    other = { ...transferReceipt(), generation: 2 },
    base = executionReceipt(),
    mutation = {
      ...base,
      kind: "file_mutation" as const,
      operation: "mkdir" as const,
      parent: "/home",
      source: null,
      destination: "/home/new",
      sourceInitialStat: null,
      phase: "prepared" as const,
      stage: "prepared",
      destinationCreated: false,
      sourceRemovalConfirmed: false,
    };
  const scope = {
    serverId: transfer.serverId,
    generation: transfer.generation,
  };
  expect(inShutdownScope(other, scope)).toBe(false);
  expect(
    inShutdownScope(base, {
      serverId: crypto.randomUUID(),
      generation: base.generation,
    }),
  ).toBe(false);
  const selected = {
    ...mutation,
    serverId: transfer.serverId,
    generation: transfer.generation,
  };
  const summary = shutdownSummary(
    [transfer, other, selected] as never,
    () => true,
    scope,
  );
  expect(summary).toContain("전송 1 · 대기 0 · 파일 변경 1");
  const rows = Array.from({ length: 111 }, () => ({
    ...base,
    taskId: crypto.randomUUID(),
    source: null,
    endpointSnapshot: {
      ...base.endpointSnapshot,
      name: "x".repeat(1000) + "\nforged",
    },
  }));
  const bounded = shutdownSummary(rows, () => true, null);
  expect(bounded).toContain("나머지 1개");
  expect(bounded.split("\n").length).toBeLessThanOrEqual(113);
  expect(bounded).not.toContain("forged");
});

it("continues disconnect after an interrupt rejection and retains one overall timeout while active work never settles", async () => {
  vi.useFakeTimers();
  const disconnect = vi.fn(async () => {}),
    settled = vi.fn(async () => {}),
    work = runShutdown({
      interrupt: async () => {
        throw new Error("already closed");
      },
      finalizing: () => false,
      disconnect,
      active: () => true,
      settled,
    });
  await vi.advanceTimersByTimeAsync(10000);
  expect(await work).toEqual({ timedOut: true });
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(settled).not.toHaveBeenCalled();
});
