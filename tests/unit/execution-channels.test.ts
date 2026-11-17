import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Client, ClientChannel } from "ssh2";
import type { SessionManager } from "../../src/worker/connections/session-manager";
import type { AuxiliaryLease } from "../../src/worker/connections/auxiliary-sockets";
import { ExecutionChannels } from "../../src/worker/execution/channels";
afterEach(() => {
  vi.useRealTimers();
});
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function fixture() {
  const callbacks: ((
      error: Error | undefined,
      channel: ClientChannel,
    ) => void)[] = [],
    requests: unknown[] = [];
  let resolveAuth!: (client: Client) => void,
    resolveClosed!: () => void,
    closing = false;
  const client = {
    exec: (
      command: string,
      callback: (error: Error | undefined, channel: ClientChannel) => void,
    ) => {
      requests.push(command);
      callbacks.push(callback);
    },
    shell: (
      window: unknown,
      callback: (error: Error | undefined, channel: ClientChannel) => void,
    ) => {
      requests.push(window);
      callbacks.push(callback);
    },
  } as unknown as Client;
  const lease: AuxiliaryLease = {
    ready: new Promise((done) => {
      resolveAuth = done;
    }),
    closed: new Promise((done) => {
      resolveClosed = done;
    }),
    get closing() {
      return closing;
    },
    close: () => {
      closing = true;
    },
  };
  const sessions = {
    auxiliary: () => {
      if (closing) throw new Error("SESSION_BUSY");
      return lease;
    },
  } as unknown as Pick<SessionManager, "auxiliary">;
  const pool = new ExecutionChannels(sessions);
  const channel = () => {
    const value = new EventEmitter() as ClientChannel;
    value.close = vi.fn(() => value);
    return value;
  };
  return {
    pool,
    sessions,
    client,
    callbacks,
    requests,
    channel,
    auth: () => resolveAuth(client),
    socketClosed: () => resolveClosed(),
    isClosing: () => closing,
  };
}
describe("execution socket channel reservations", () => {
  it("releases slots if auxiliary acquisition fails and if a user cancels while intent persistence waits", async () => {
    const f = fixture(),
      request = vi.spyOn(f.sessions, "auxiliary").mockImplementation(() => {
        throw new Error("CONNECTION_LOST");
      });
    expect(() =>
      f.pool.open("one", "a", 1, { kind: "pty" }, async () => {}),
    ).toThrow("CONNECTION_LOST");
    expect(f.pool.count()).toBe(0);
    request.mockRestore();
    let resume!: () => void;
    const ticket = f.pool.open(
      "two",
      "a",
      1,
      { kind: "pty" },
      () =>
        new Promise((done) => {
          resume = done;
        }),
    );
    f.auth();
    await tick();
    ticket.close();
    resume();
    await expect(ticket.ready).rejects.toThrow("EXEC_CANCELLED_NOT_SENT");
    await ticket.closed;
    expect(f.requests).toEqual([]);
  });
  it("closes channels whose consumer setup fails and ignores repeated close requests", async () => {
    const f = fixture(),
      ticket = f.pool.open(
        "one",
        "a",
        1,
        { kind: "gui_exec", command: "fixture" },
        async () => {},
        () => {
          throw new Error("consumer failure");
        },
      );
    f.auth();
    await tick();
    const channel = f.channel();
    f.callbacks[0]!(undefined, channel);
    await expect(ticket.ready).rejects.toThrow("INTERNAL_ERROR");
    expect(channel.close).toHaveBeenCalledOnce();
    ticket.close();
    channel.emit("close");
    await ticket.closed;
    ticket.close();
    expect(ticket.channelCloseObserved).toBe(true);
    expect(ticket.transportLost).toBe(false);
    expect(f.pool.count()).toBe(0);
  });
  it("retains sent reservations on synchronous protocol failure until socket closure", async () => {
    const f = fixture();
    f.client.exec = () => {
      throw new Error("protocol fault");
    };
    const ticket = f.pool.open(
      "one",
      "a",
      1,
      { kind: "gui_exec", command: "fixture" },
      async () => {},
    );
    f.auth();
    await expect(ticket.ready).rejects.toThrow("EXEC_RESULT_UNKNOWN");
    expect(ticket.requestSent).toBe(true);
    expect(ticket.cleanupPending).toBe(true);
    expect(f.pool.count()).toBe(1);
    ticket.close();
    f.socketClosed();
    await ticket.closed;
    expect(ticket.transportLost).toBe(true);
    expect(ticket.channelCloseObserved).toBe(false);
    expect(f.pool.count()).toBe(0);
  });
  it("rejects an exec channel refusal with the fixed code and observes actual socket closure", async () => {
    const f = fixture(),
      ticket = f.pool.open(
        "one",
        "a",
        1,
        { kind: "gui_exec", command: "fixture" },
        async () => {},
      );
    f.auth();
    await tick();
    f.callbacks[0]!(
      new Error("remote refusal"),
      undefined as unknown as ClientChannel,
    );
    await expect(ticket.ready).rejects.toThrow("EXEC_REJECTED");
    expect(f.isClosing()).toBe(true);
    f.socketClosed();
    await ticket.closed;
  });
  it("shares authentication and includes opening requests in4/server and6/global limits", async () => {
    const f = fixture();
    const tickets = [];
    for (let i = 0; i < 4; i++)
      tickets.push(
        f.pool.open(
          "a" + i,
          "a",
          1,
          { kind: "gui_exec", command: "fixture" },
          async () => {},
        ),
      );
    expect(() =>
      f.pool.open("extra", "a", 1, { kind: "pty" }, async () => {}),
    ).toThrow("SESSION_LIMIT");
    tickets.push(f.pool.open("b", "b", 1, { kind: "pty" }, async () => {}));
    tickets.push(f.pool.open("c", "c", 1, { kind: "pty" }, async () => {}));
    expect(() =>
      f.pool.open("d", "d", 1, { kind: "pty" }, async () => {}),
    ).toThrow("SESSION_LIMIT");
    expect(f.requests).toEqual([]);
    f.auth();
    await tick();
    expect(f.requests[4]).toEqual({
      term: "xterm-256color",
      cols: 80,
      rows: 24,
      width: 0,
      height: 0,
    });
    f.socketClosed();
    await Promise.all(tickets.map((ticket) => ticket.closed));
    expect(f.pool.count()).toBe(0);
  });
  it("holds a timed-out request until its late channel closes and preserves another running channel", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const first = f.pool.open(
        "first",
        "a",
        1,
        { kind: "gui_exec", command: "one" },
        async () => {},
      ),
      late = f.pool.open(
        "late",
        "a",
        1,
        { kind: "gui_exec", command: "two" },
        async () => {},
      );
    f.auth();
    await tick();
    const live = f.channel();
    f.callbacks[0]!(undefined, live);
    await first.ready;
    const failure = expect(late.ready).rejects.toThrow("EXEC_RESULT_UNKNOWN");
    await vi.advanceTimersByTimeAsync(10000);
    await failure;
    expect(f.pool.count()).toBe(2);
    expect(late.cleanupPending).toBe(true);
    expect(f.isClosing()).toBe(false);
    const returned = f.channel();
    f.callbacks[1]!(undefined, returned);
    expect(returned.close).toHaveBeenCalledOnce();
    expect(f.pool.count()).toBe(2);
    returned.emit("close");
    await late.closed;
    expect(f.pool.count()).toBe(1);
    first.close();
    expect(f.pool.count()).toBe(1);
    live.emit("close");
    await first.closed;
    expect(f.pool.count()).toBe(0);
    expect(f.isClosing()).toBe(true);
  });
  it("sends no channel request if intent storage fails or cancellation wins before dispatch", async () => {
    const f = fixture(),
      ticket = f.pool.open(
        "one",
        "a",
        1,
        { kind: "gui_exec", command: "never" },
        async () => {
          throw new Error("STORAGE_FAILED");
        },
      );
    f.auth();
    await expect(ticket.ready).rejects.toThrow("STORAGE_FAILED");
    await ticket.closed;
    expect(f.requests).toEqual([]);
    const g = fixture(),
      cancelled = g.pool.open("two", "a", 1, { kind: "pty" }, async () => {});
    cancelled.close();
    g.auth();
    await expect(cancelled.ready).rejects.toThrow("EXEC_CANCELLED_NOT_SENT");
    await cancelled.closed;
    expect(g.requests).toEqual([]);
  });
  it("does not terminate another channel after an explicit request rejection and releases only after socket end", async () => {
    const f = fixture(),
      one = f.pool.open("one", "a", 1, { kind: "pty" }, async () => {}),
      two = f.pool.open("two", "a", 1, { kind: "pty" }, async () => {});
    f.auth();
    await tick();
    const live = f.channel();
    f.callbacks[0]!(undefined, live);
    await one.ready;
    f.callbacks[1]!(new Error("denied"), undefined as unknown as ClientChannel);
    await expect(two.ready).rejects.toThrow("PTY_UNAVAILABLE");
    expect(f.pool.count()).toBe(2);
    expect(f.isClosing()).toBe(false);
    live.emit("close");
    expect(f.isClosing()).toBe(true);
    expect(f.pool.count()).toBe(1);
    f.socketClosed();
    await two.closed;
    expect(f.pool.count()).toBe(0);
  });
});
