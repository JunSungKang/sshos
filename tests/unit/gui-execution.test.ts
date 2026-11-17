import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import type { Client, ClientChannel } from "ssh2";
import {
  GUIExecutions,
  type ExecutionRuntime,
} from "../../src/worker/execution/gui";
import type { SessionManager } from "../../src/worker/connections/session-manager";
import type { AuxiliaryLease } from "../../src/worker/connections/auxiliary-sockets";
import type { FileReceipt } from "../../src/shared/receipts";
import { executionReceipt } from "../fixtures/executions";
afterEach(() => vi.useRealTimers());
const tick = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
function fixture(options: { storageFailure?: boolean; mode?: number } = {}) {
  const row = executionReceipt(),
    expected = {
      type: "file" as const,
      size: 10,
      mtime: 1,
      mode: options.mode ?? 0o100700,
    },
    spec = {
      path: row.source!,
      cwd: row.cwd!,
      mode: "direct" as const,
      argv: ["sensitive-argument"],
    };
  const saved: FileReceipt[] = [],
    commands: string[] = [],
    events: ExecutionRuntime[] = [];
  let callback!: (error: Error | undefined, channel: ClientChannel) => void,
    resolveClosed!: () => void;
  let closing = false;
  const client = Object.assign(new EventEmitter(), {
    exec: (command: string, done: typeof callback) => {
      commands.push(command);
      callback = done;
    },
  }) as unknown as Client;
  const lease: AuxiliaryLease = {
    ready: Promise.resolve(client),
    closed: new Promise((done) => {
      resolveClosed = done;
    }),
    get closing() {
      return closing;
    },
    close: () => {
      closing = true;
      queueMicrotask(resolveClosed);
    },
  };
  const access = {
    check: () => {},
    quarantine: () => {
      throw new Error("Unexpected quarantine");
    },
    sftp: {
      lstat: (path: string, done: (error: undefined, stat: unknown) => void) =>
        queueMicrotask(() =>
          done(undefined, {
            size: 10,
            mtime: 1,
            mode: expected.mode,
            isDirectory: () => path === "/home",
            isFile: () => path === "/home/program.sh",
            isSymbolicLink: () => false,
          }),
        ),
      realpath: (
        path: string,
        done: (error: undefined, path: string) => void,
      ) => queueMicrotask(() => done(undefined, path)),
    },
  };
  const sessions = {
    control: () => access,
    auxiliary: () => lease,
    withMetadata: async (
      _server: string,
      _generation: number,
      action: () => Promise<unknown>,
    ) => action(),
  } as unknown as Pick<
    SessionManager,
    "control" | "auxiliary" | "withMetadata"
  >;
  const writer = {
    faulted: false,
    persist: async (receipt: FileReceipt) => {
      if (options.storageFailure) throw new Error("STORAGE_FAILED");
      saved.push(structuredClone(receipt));
    },
  };
  const executions = new GUIExecutions(
    row.backendEpoch,
    sessions,
    writer,
    (value) => events.push(value),
  );
  const channel = new PassThrough() as unknown as ClientChannel;
  channel.stderr = new PassThrough();
  channel.signal = vi.fn();
  channel.close = vi.fn(() => channel);
  const end = vi.spyOn(channel, "end");
  return {
    row,
    expected,
    spec,
    executions,
    saved,
    commands,
    events,
    channel,
    end,
    writer,
    sessions,
    socketClosed: () => {
      client.emit("close");
      resolveClosed();
    },
    accept: () => callback(undefined, channel),
    reject: () =>
      callback(new Error("denied"), undefined as unknown as ClientChannel),
  };
}
describe("GUI exec lifecycle and bounded output owner", () => {
  it("rejects reused or already-dispatched receipts, wrong epochs and storage fault before any channel reservation", async () => {
    const f = fixture();
    for (const row of [
      { ...f.row, phase: "dispatching" as const },
      { ...f.row, backendEpoch: crypto.randomUUID() },
      { ...f.row, source: "/home/other" },
      { ...f.row, channelAccepted: true },
    ])
      expect(() => f.executions.start(row, f.spec, f.expected)).toThrow(
        "INPUT_INVALID",
      );
    f.writer.faulted = true;
    expect(() => f.executions.start(f.row, f.spec, f.expected)).toThrow(
      "STORAGE_FAILED",
    );
    expect(f.commands).toEqual([]);
    f.writer.faulted = false;
    f.executions.start(f.row, f.spec, f.expected);
    expect(() => f.executions.start(f.row, f.spec, f.expected)).toThrow(
      "INPUT_INVALID",
    );
    await tick();
    f.reject();
    await f.executions.settled();
  });
  it("abandons changed source metadata before dispatch and exposes only the original generation snapshot", async () => {
    const f = fixture();
    f.executions.start(f.row, f.spec, { ...f.expected, mtime: 0 });
    await tick();
    expect(f.commands).toEqual([]);
    expect(f.executions.snapshot(f.row.serverId, 1)[0]).toMatchObject({
      receipt: { phase: "cancelled_not_sent", errorCode: "SOURCE_CHANGED" },
      active: false,
    });
    expect(f.executions.snapshot(f.row.serverId, 2)).toEqual([]);
    expect(f.executions.page(f.row.serverId, 1, 0)).toMatchObject({
      rows: [{ receipt: { taskId: f.row.taskId } }],
      nextOffset: null,
    });
    await f.executions.forget(f.row.serverId, 1, f.row.taskId);
    expect(f.executions.hasActive).toBe(false);
  });
  it("closes before dispatch without requesting exec and refuses forget while a task is active", async () => {
    const f = fixture();
    f.executions.start(f.row, f.spec, f.expected);
    await expect(
      f.executions.forget(f.row.serverId, 1, f.row.taskId),
    ).rejects.toThrow("REQUEST_BUSY");
    f.executions.closeChannel(f.row.serverId, 1, f.row.taskId);
    await tick();
    expect(f.commands).toEqual([]);
    expect(f.executions.snapshot(f.row.serverId, 1)[0]).toMatchObject({
      active: false,
      receipt: { phase: "cancelled_not_sent" },
    });
    f.executions.closeChannel(f.row.serverId, 1, f.row.taskId);
    await f.executions.forget(f.row.serverId, 1, f.row.taskId);
  });
  it("rejects unknown task scopes and stop before channel acceptance", async () => {
    const f = fixture();
    expect(() => f.executions.stop(f.row.serverId, 1, f.row.taskId)).toThrow(
      "TOKEN_EXPIRED",
    );
    f.executions.start(f.row, f.spec, f.expected);
    expect(() => f.executions.stop(f.row.serverId, 1, f.row.taskId)).toThrow(
      "TOKEN_EXPIRED",
    );
    expect(() =>
      f.executions.closeChannel(f.row.serverId, 2, f.row.taskId),
    ).toThrow("TOKEN_EXPIRED");
    await tick();
    f.reject();
    await tick();
  });
  it("ignores invalid exit metadata, accepts a bounded signal and keeps channel errors unknown", async () => {
    const f = fixture();
    f.executions.start(f.row, f.spec, f.expected);
    await tick();
    f.accept();
    await tick();
    for (const value of [NaN, -1, 0x100000000])
      f.channel.emit("exit", value, "invalid signal");
    expect(
      f.executions.snapshot(f.row.serverId, 1)[0]?.receipt.exitObserved,
    ).toBe(false);
    f.channel.emit("exit", null, "TERM");
    f.channel.emit("error", new Error("untrusted channel error"));
    f.channel.emit("close");
    await tick();
    expect(f.executions.snapshot(f.row.serverId, 1)[0]?.receipt).toMatchObject({
      phase: "result_unknown",
      exitSignal: "TERM",
      exitCode: null,
    });
    await expect(
      f.executions.forget(f.row.serverId, 2, f.row.taskId),
    ).rejects.toThrow("TOKEN_EXPIRED");
  });
  it("marks a synchronous TERM failure unconfirmed and preserves a later actual exit", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.executions.start(f.row, f.spec, f.expected);
    await vi.runAllTicks();
    await tick();
    f.accept();
    await tick();
    vi.mocked(f.channel.signal).mockImplementation(() => {
      throw new Error("signal unavailable");
    });
    f.executions.stop(f.row.serverId, 1, f.row.taskId);
    await tick();
    expect(f.executions.snapshot(f.row.serverId, 1)[0]?.receipt.phase).toBe(
      "stop_unconfirmed",
    );
    f.channel.emit("exit", 143);
    f.channel.emit("close");
    await tick();
    expect(f.executions.snapshot(f.row.serverId, 1)[0]?.receipt).toMatchObject({
      phase: "exited",
      exitCode: 143,
    });
  });
  it("paces large output, clears timers on actual close and ignores unrelated session changes", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.executions.start(f.row, f.spec, f.expected);
    await vi.runAllTicks();
    await tick();
    f.accept();
    await tick();
    const pause = vi.spyOn(f.channel, "pause"),
      resume = vi.spyOn(f.channel, "resume");
    f.channel.emit("data", Buffer.alloc(65536, 65));
    f.channel.stderr.emit("data", Buffer.alloc(65536, 66));
    expect(pause).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(130);
    expect(resume).toHaveBeenCalled();
    f.executions.sessionChanged(crypto.randomUUID(), 1, false);
    f.executions.sessionChanged(f.row.serverId, 1, true);
    expect(
      f.executions.read(f.row.serverId, 1, f.row.taskId, 0).frames.length,
    ).toBeGreaterThan(0);
    f.channel.emit("exit", 0);
    f.channel.emit("close");
    await tick();
    expect(f.executions.hasActive).toBe(false);
    await f.executions.forget(f.row.serverId, 1, f.row.taskId);
    f.channel.emit("data", Buffer.from("late"));
  });
  it("durably gates dispatch, keeps stdin open and distinguishes observed exit from channel termination", async () => {
    const f = fixture();
    f.executions.start(f.row, f.spec, f.expected);
    await tick();
    expect(f.saved[0]).toMatchObject({
      phase: "dispatching",
      channelAccepted: false,
    });
    expect(f.commands).toHaveLength(1);
    expect(JSON.stringify(f.saved)).not.toContain("sensitive-argument");
    f.accept();
    await tick();
    f.channel.emit("data", Buffer.from("plain \x1b[31m <script>"));
    f.channel.stderr.emit("data", Buffer.from("stderr"));
    f.channel.emit("exit", 0);
    await tick();
    expect(f.executions.snapshot(f.row.serverId, 1)[0]?.receipt).toMatchObject({
      phase: "running",
      exitObserved: true,
      exitCode: 0,
      channelClosed: false,
    });
    expect(f.end).not.toHaveBeenCalled();
    f.channel.emit("close");
    await tick();
    expect(f.executions.snapshot(f.row.serverId, 1)[0]).toMatchObject({
      receipt: { phase: "exited", channelClosed: true, exitCode: 0 },
      active: false,
      recordPending: false,
    });
    expect(
      f.executions
        .read(f.row.serverId, 1, f.row.taskId, 0)
        .frames.map((frame) => frame.stream),
    ).toEqual(["stdout", "stderr"]);
  });
  it("does not time out a silent running program and sends only one TERM with an unconfirmed stop after5s", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.executions.start(f.row, f.spec, f.expected);
    await vi.runAllTicks();
    await tick();
    f.accept();
    await tick();
    await vi.advanceTimersByTimeAsync(120000);
    expect(f.executions.snapshot(f.row.serverId, 1)[0]?.receipt.phase).toBe(
      "running",
    );
    f.executions.stop(f.row.serverId, 1, f.row.taskId);
    f.executions.stop(f.row.serverId, 1, f.row.taskId);
    expect(f.channel.signal).toHaveBeenCalledExactlyOnceWith("TERM");
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.executions.snapshot(f.row.serverId, 1)[0]?.receipt.phase).toBe(
      "stop_unconfirmed",
    );
    expect(f.channel.close).not.toHaveBeenCalled();
    f.channel.emit("close");
    await tick();
    expect(f.executions.snapshot(f.row.serverId, 1)[0]?.receipt.phase).toBe(
      "result_unknown",
    );
  });
  it("sends no exec after intent-storage failure or missing executable bits", async () => {
    const f = fixture({ storageFailure: true });
    f.executions.start(f.row, f.spec, f.expected);
    await tick();
    expect(f.commands).toEqual([]);
    expect(f.executions.snapshot(f.row.serverId, 1)[0]).toMatchObject({
      receipt: { phase: "cancelled_not_sent" },
      recordError: true,
      active: false,
    });
    const g = fixture({ mode: 0o100600 });
    g.executions.start(g.row, g.spec, g.expected);
    await tick();
    expect(g.commands).toEqual([]);
    expect(g.executions.snapshot(g.row.serverId, 1)[0]?.receipt.errorCode).toBe(
      "EXEC_PERMISSION",
    );
  });
  it("keeps explicit request rejection distinct from unknown channel closure and clears session output without replay", async () => {
    const f = fixture();
    f.executions.start(f.row, f.spec, f.expected);
    await tick();
    f.reject();
    await tick();
    expect(f.executions.snapshot(f.row.serverId, 1)[0]?.receipt.phase).toBe(
      "rejected",
    );
    const g = fixture();
    g.executions.start(g.row, g.spec, g.expected);
    await tick();
    g.accept();
    g.channel.emit("data", Buffer.from("cached"));
    g.executions.closeChannel(g.row.serverId, 1, g.row.taskId);
    expect(g.channel.close).toHaveBeenCalledOnce();
    g.channel.emit("exit", 0);
    g.channel.emit("close");
    await tick();
    expect(g.executions.snapshot(g.row.serverId, 1)[0]?.receipt).toMatchObject({
      phase: "result_unknown",
      exitCode: 0,
    });
    g.executions.sessionChanged(g.row.serverId, 1, false);
    g.channel.emit("data", Buffer.from("late discarded"));
    expect(g.executions.read(g.row.serverId, 1, g.row.taskId, 0)).toMatchObject(
      { frames: [], omitted: true },
    );
    await g.executions.forget(g.row.serverId, 1, g.row.taskId);
    expect(() => g.executions.read(g.row.serverId, 1, g.row.taskId, 0)).toThrow(
      "TOKEN_EXPIRED",
    );
  });
});

it("reconciles only failed execution records without replay and preserves backup uncertainty after a late channel acceptance/exit", async () => {
  const options = { storageFailure: false },
    f = fixture(options);
  f.executions.start(f.row, f.spec, f.expected);
  await tick();
  f.accept();
  await tick();
  options.storageFailure = true;
  f.channel.emit("exit", 7);
  await tick();
  expect(f.executions.snapshot(f.row.serverId, 1)[0]?.recordError).toBe(true);
  options.storageFailure = false;
  await f.executions.reconcileStorage([]);
  expect(f.executions.snapshot(f.row.serverId, 1)[0]).toMatchObject({
    receipt: { phase: "running", exitCode: 7 },
    recordError: false,
    active: true,
  });
  expect(f.commands).toHaveLength(1);
  f.channel.emit("close");
  await tick();
  expect(f.executions.snapshot(f.row.serverId, 1)[0]?.receipt.phase).toBe(
    "exited",
  );
  const g = fixture();
  g.executions.start(g.row, g.spec, g.expected);
  await tick();
  await g.executions.reconcileStorage([
    { taskId: g.row.taskId, fromPhase: "dispatching" },
  ]);
  g.accept();
  await tick();
  g.channel.emit("exit", 0);
  g.channel.emit("close");
  await tick();
  expect(g.executions.snapshot(g.row.serverId, 1)[0]?.receipt).toMatchObject({
    phase: "result_unknown",
    recoveryUncertain: true,
    recoveredFromPhase: "dispatching",
    exitCode: 0,
    channelClosed: true,
  });
  expect(g.commands).toHaveLength(1);
});

it("preserves observed exit information but never confirms channel close or exited after socket loss", async () => {
  const f = fixture();
  f.executions.start(f.row, f.spec, f.expected);
  await tick();
  f.accept();
  await tick();
  f.channel.emit("exit", 0);
  f.socketClosed();
  f.channel.emit("close");
  await tick();
  expect(f.executions.snapshot(f.row.serverId, 1)[0]).toMatchObject({
    receipt: {
      phase: "result_unknown",
      exitObserved: true,
      exitCode: 0,
      channelClosed: false,
    },
    active: false,
  });
});
