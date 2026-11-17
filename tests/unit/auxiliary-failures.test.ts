import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ConnectInput } from "../../src/shared/session-contracts";
import type { SingleKeyAgent } from "../../src/worker/connections/single-key-agent";
import { AuxiliarySockets } from "../../src/worker/connections/auxiliary-sockets";
const state = vi.hoisted(() => ({ clients: [] as any[], throwConnect: false }));
vi.mock("ssh2", () => ({
  Client: class extends EventEmitter {
    options: any;
    constructor() {
      super();
      state.clients.push(this);
    }
    connect(options: any) {
      this.options = options;
      if (state.throwConnect) throw new Error("private library detail");
      return this;
    }
    destroy() {
      this.emit("close");
      return this;
    }
  },
}));
afterEach(() => {
  vi.useRealTimers();
  state.clients = [];
  state.throwConnect = false;
});
const input: ConnectInput = {
  host: "fixture.invalid",
  port: 22,
  username: "fixture",
  authentication: "password",
  password: "test-only",
  trustedHostKey: Buffer.from("test-only-key").toString("base64"),
};
describe("auxiliary socket deadline and credential boundaries", () => {
  it("requires trusted host key and the selected method secret before constructing a socket", () => {
    for (const [value, code] of [
      [{ ...input, trustedHostKey: null }, "HOST_TRUST_REQUIRED"],
      [{ ...input, password: undefined }, "SECRET_UNAVAILABLE"],
      [{ ...input, authentication: "key" }, "KEY_UNAVAILABLE"],
    ] as const) {
      const sockets = new AuxiliarySockets(() => ({
        input: value as ConnectInput,
        agent: null,
        check: () => {},
      }));
      expect(() => sockets.open("execution")).toThrow(code);
    }
    expect(state.clients).toHaveLength(0);
  });
  it("selects the in-process key agent and resolves once only after live control validation", async () => {
    const agent = {} as SingleKeyAgent,
      sockets = new AuxiliarySockets(() => ({
        input: { ...input, authentication: "key" },
        agent,
        check: () => {},
      })),
      lease = sockets.open("execution");
    state.clients[0].emit("ready");
    expect(await lease.ready).toBe(state.clients[0]);
    const methods = state.clients[0].options.authHandler;
    expect(typeof methods).toBe("function");
    lease.close();
    lease.close();
    await sockets.settled();
    expect(lease.closing).toBe(true);
  });
  it("closes a ready socket if its control generation became stale before readiness", async () => {
    let active = true;
    const sockets = new AuxiliarySockets(() => ({
        input,
        agent: null,
        check: () => {
          if (!active) throw new Error("CONNECTION_LOST");
        },
      })),
      lease = sockets.open("transfer");
    active = false;
    state.clients[0].emit("ready");
    await expect(lease.ready).rejects.toThrow("CONNECTION_LOST");
    await lease.closed;
  });
  it.each([
    ["client-authentication", "AUTH_FAILED"],
    ["client-timeout", "CONNECT_TIMEOUT"],
    ["protocol", "CONNECTION_LOST"],
  ])("maps %s without forwarding error text", async (level, code) => {
    const sockets = new AuxiliarySockets(() => ({
        input,
        agent: null,
        check: () => {},
      })),
      lease = sockets.open("transfer");
    state.clients[0].emit(
      "error",
      Object.assign(new Error("SENTINEL_REMOTE_TEXT"), { level }),
    );
    await expect(lease.ready).rejects.toThrow(code);
    await lease.closed;
  });
  it("enforces the opening deadline even when no library callback arrives", async () => {
    vi.useFakeTimers();
    const sockets = new AuxiliarySockets(() => ({
        input,
        agent: null,
        check: () => {},
      })),
      lease = sockets.open("transfer"),
      rejected = expect(lease.ready).rejects.toThrow("CONNECT_TIMEOUT");
    await vi.advanceTimersByTimeAsync(20000);
    await rejected;
    await lease.closed;
    expect(lease.closing).toBe(true);
  });
  it("handles synchronous connect exceptions and transport close before ready", async () => {
    state.throwConnect = true;
    const sockets = new AuxiliarySockets(() => ({
        input,
        agent: null,
        check: () => {},
      })),
      first = sockets.open("transfer");
    await expect(first.ready).rejects.toThrow("INPUT_INVALID");
    await first.closed;
    state.throwConnect = false;
    const second = sockets.open("transfer");
    state.clients[1].emit("close");
    await expect(second.ready).rejects.toThrow("CONNECTION_LOST");
    await second.closed;
  });
});
