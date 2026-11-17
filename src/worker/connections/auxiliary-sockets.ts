import { Client, type AgentAuthMethod, type PasswordAuthMethod } from "ssh2";
import type { ConnectInput } from "../../shared/session-contracts";
import type { SingleKeyAgent } from "./single-key-agent";
import { HostKeyVerifier } from "./host-verifier";
import { oneShotAuthentication } from "./authentication";
import { algorithms } from "./algorithms";

export type AuxiliaryRole = "transfer" | "execution";
export interface AuxiliaryLease {
  ready: Promise<Client>;
  closed: Promise<void>;
  readonly closing: boolean;
  close(): void;
}
type Context = {
  input: ConnectInput;
  agent: SingleKeyAgent | null;
  check(): void;
};

/** Exactly one socket per role in one control generation, including opening/closing. */
export class AuxiliarySockets {
  private readonly sockets = new Map<AuxiliaryRole, AuxiliaryLease>();
  constructor(private readonly context: () => Context) {}
  open(role: AuxiliaryRole): AuxiliaryLease {
    const context = this.context();
    context.check();
    const previous = this.sockets.get(role);
    if (previous) {
      if (previous.closing) throw new Error("SESSION_BUSY");
      return previous;
    }
    const { input, agent } = context;
    if (!input.trustedHostKey) throw new Error("HOST_TRUST_REQUIRED");
    let method: PasswordAuthMethod | AgentAuthMethod;
    if (input.authentication === "key") {
      if (!agent) throw new Error("KEY_UNAVAILABLE");
      method = { type: "agent", username: input.username, agent };
    } else {
      if (input.password === undefined) throw new Error("SECRET_UNAVAILABLE");
      method = {
        type: "password",
        username: input.username,
        password: input.password,
      };
    }
    const verifier = new HostKeyVerifier(
      Buffer.from(input.trustedHostKey, "base64"),
    );
    const client = new Client();
    let closing = false,
      settled = false;
    let resolveReady!: (client: Client) => void,
      rejectReady!: (error: Error) => void,
      resolveClosed!: () => void;
    const ready = new Promise<Client>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const finish = (code: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (code) rejectReady(new Error(code));
      else resolveReady(client);
    };
    const lease: AuxiliaryLease = {
      ready,
      closed,
      get closing() {
        return closing;
      },
      close: () => {
        if (closing) return;
        closing = true;
        finish("CONNECTION_LOST");
        client.destroy();
      },
    };
    const deadline = setTimeout(() => {
      finish("CONNECT_TIMEOUT");
      lease.close();
    }, 20000);
    // Consumers can cancel an opening lease before awaiting ready.
    void ready.catch(() => {});
    this.sockets.set(role, lease);
    client.on("ready", () => {
      try {
        context.check();
        finish(null);
      } catch {
        lease.close();
      }
    });
    client.on("error", (error: Error & { level?: string }) => {
      const observed = verifier.observation();
      const changed =
        observed &&
        observed.publicKey.toString("base64") !== input.trustedHostKey;
      finish(
        changed
          ? "HOST_KEY_CHANGED"
          : error.level === "client-authentication"
            ? "AUTH_FAILED"
            : error.level === "client-timeout"
              ? "CONNECT_TIMEOUT"
              : "CONNECTION_LOST",
      );
      lease.close();
    });
    client.on("close", () => {
      closing = true;
      finish("CONNECTION_LOST");
      if (this.sockets.get(role) === lease) this.sockets.delete(role);
      resolveClosed();
    });
    try {
      client.connect({
        host: input.host,
        port: input.port,
        username: input.username,
        hostVerifier: verifier.verify,
        authHandler: oneShotAuthentication(method),
        algorithms,
        readyTimeout: 20000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
      });
    } catch {
      finish("INPUT_INVALID");
      lease.close();
    }
    return lease;
  }
  settled(): Promise<void> {
    return Promise.all(
      [...this.sockets.values()].map((lease) => lease.closed),
    ).then(() => {});
  }
  closeAll(): void {
    for (const lease of this.sockets.values()) lease.close();
  }
}
