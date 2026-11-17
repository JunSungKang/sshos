import {
  runCommand,
  successful,
  type CommandAccess,
} from "../remote-files/metadata/command-runner";
import {
  UbuntuMetadata,
  canonicalPath,
} from "../remote-files/metadata/ubuntu-metadata";
import {
  OS_COMMAND,
  START_COMMAND,
} from "../remote-files/metadata/ubuntu-commands";
import { resolveAccountHome } from "./home";
import { errorCodeOf } from "../../shared/errors";
import { Client, type SFTPWrapper } from "ssh2";
import { MetadataQueue } from "./metadata-queue";
import { createPrivateKey } from "node:crypto";
import {
  type ConnectInput,
  type ConnectOutcome,
  type SessionSnapshot,
} from "../../shared/session-contracts";
import { HostKeyVerifier } from "./host-verifier";
import { SingleKeyAgent } from "./single-key-agent";
import { oneShotAuthentication } from "./authentication";
import { algorithms } from "./algorithms";
import { PrivateKeyParser } from "./key-parser";
import { identifyOS } from "./os-release";
import type { ControlAccess } from "../remote-files/sftp-control";
import {
  AuxiliarySockets,
  type AuxiliaryRole,
  type AuxiliaryLease,
} from "./auxiliary-sockets";

type ConnectReservation = {
  generation: number;
  cancelled: boolean;
  cancelledPromise: Promise<void>;
  cancel(): void;
};
interface RecordEntry {
  socketStarted: boolean;
  slotReleased: boolean;
  controlClosed: Promise<void>;
  resolveControlClosed(): void;
  retirement: Promise<void> | null;
  snapshot: SessionSnapshot;
  client: Client;
  sftp: SFTPWrapper | null;
  input: ConnectInput;
  agent: SingleKeyAgent | null;
  auxiliary: AuxiliarySockets | null;
  metadata: MetadataQueue;
}
export class SessionManager {
  private readonly entries = new Map<string, RecordEntry>();
  private readonly parser = new PrivateKeyParser();
  private readonly connecting = new Map<string, ConnectReservation>();
  constructor(private readonly emit: (snapshot: SessionSnapshot) => void) {}
  snapshots(): SessionSnapshot[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.snapshot }));
  }
  auxiliary(
    serverId: string,
    generation: number,
    role: AuxiliaryRole,
  ): AuxiliaryLease {
    const entry = this.entries.get(serverId);
    const check = () => {
      if (
        !entry ||
        this.entries.get(serverId) !== entry ||
        entry.snapshot.generation !== generation ||
        entry.snapshot.status !== "connected"
      )
        throw new Error("CONNECTION_LOST");
      if (
        entry.snapshot.os !== "supported" &&
        !(entry.snapshot.os === "unknown" && entry.snapshot.osConfirmed)
      )
        throw new Error(
          entry.snapshot.os === "unknown" ? "OS_UNKNOWN" : "OS_UNSUPPORTED",
        );
    };
    check();
    if (!entry) throw new Error("CONNECTION_LOST");
    entry.auxiliary ??= new AuxiliarySockets(() => ({
      input: entry.input,
      agent: entry.agent,
      check,
    }));
    return entry.auxiliary.open(role);
  }
  withMetadata<T>(
    serverId: string,
    generation: number,
    action: () => Promise<T>,
  ): Promise<T> {
    this.commandAccess(serverId, generation).check();
    const entry = this.entries.get(serverId)!;
    return entry.metadata.run(action);
  }
  probeAccess(
    serverId: string,
    generation: number,
  ): { client: Client; metadataBusy: boolean; check(): void } {
    const entry = this.entries.get(serverId);
    const check = () => {
      if (
        !entry ||
        this.entries.get(serverId) !== entry ||
        entry.snapshot.generation !== generation ||
        entry.snapshot.status !== "connected"
      )
        throw new Error("CONNECTION_LOST");
    };
    check();
    return { client: entry!.client, metadataBusy: entry!.metadata.busy, check };
  }
  commandAccess(serverId: string, generation: number): CommandAccess {
    const entry = this.entries.get(serverId);
    const check = () => {
      if (
        !entry ||
        this.entries.get(serverId) !== entry ||
        entry.snapshot.generation !== generation ||
        entry.snapshot.status !== "connected"
      )
        throw new Error("CONNECTION_LOST");
    };
    check();
    return {
      client: entry!.client,
      check,
      quarantine: () => {
        entry!.client.destroy();
        this.changed(entry!, { status: "failed", errorCode: "IO_TIMEOUT" });
        this.release(entry!);
      },
    };
  }
  readClient(serverId: string, generation: number): Client {
    const entry = this.entries.get(serverId);
    if (
      !entry ||
      entry.snapshot.generation !== generation ||
      entry.snapshot.status !== "connected" ||
      entry.snapshot.sftp !== "available"
    )
      throw new Error("CONNECTION_LOST");
    return entry.client;
  }
  control(serverId: string, generation: number, write = false): ControlAccess {
    const entry = this.entries.get(serverId);
    if (
      !entry ||
      entry.snapshot.generation !== generation ||
      entry.snapshot.status !== "connected" ||
      !entry.sftp
    )
      throw new Error("SESSION_UNAVAILABLE");
    if (
      write &&
      entry.snapshot.os !== "supported" &&
      !entry.snapshot.osConfirmed
    )
      throw new Error(
        entry.snapshot.os === "unknown" ? "OS_UNKNOWN" : "OS_UNSUPPORTED",
      );
    return {
      sftp: entry.sftp,
      check: () => {
        if (
          this.entries.get(serverId) !== entry ||
          entry.snapshot.generation !== generation ||
          entry.snapshot.status !== "connected" ||
          !entry.sftp
        )
          throw new Error("CONNECTION_LOST");
      },
      quarantine: () => {
        this.changed(entry, { status: "failed", errorCode: "IO_TIMEOUT" });
        entry.client.destroy();
        this.release(entry);
      },
    };
  }
  private changed(entry: RecordEntry, values: Partial<SessionSnapshot>): void {
    if (this.entries.get(entry.snapshot.serverId) !== entry) return;
    Object.assign(entry.snapshot, values);
    this.emit({ ...entry.snapshot });
  }
  async connect(
    serverId: string,
    generation: number,
    raw: ConnectInput,
  ): Promise<ConnectOutcome> {
    if (this.connecting.has(serverId)) throw new Error("SESSION_BUSY");
    if ((this.entries.get(serverId)?.snapshot.generation ?? 0) >= generation)
      throw new Error("INPUT_INVALID");
    const occupied = new Set(
      [...this.entries.values()]
        .filter((entry) => !entry.slotReleased)
        .map((entry) => entry.snapshot.serverId),
    );
    for (const id of this.connecting.keys()) occupied.add(id);
    occupied.delete(serverId);
    if (occupied.size >= 3) throw new Error("SESSION_LIMIT");
    let cancel!: () => void;
    const cancelledPromise = new Promise<void>((done) => {
        cancel = done;
      }),
      reservation: ConnectReservation = {
        generation,
        cancelled: false,
        cancelledPromise,
        cancel: () => {
          reservation.cancelled = true;
          cancel();
        },
      },
      input: ConnectInput = {
        ...raw,
        ...(raw.keyBytes ? { keyBytes: Uint8Array.from(raw.keyBytes) } : {}),
      };
    this.connecting.set(serverId, reservation);
    let connected = false;
    try {
      const result = await this.connectOnce(
        serverId,
        generation,
        input,
        reservation,
      );
      connected = result.status === "connected";
      return result;
    } finally {
      if (this.connecting.get(serverId) === reservation)
        this.connecting.delete(serverId);
      if (!connected) {
        input.keyBytes?.fill(0);
        delete input.keyBytes;
        delete input.password;
        delete input.passphrase;
      }
    }
  }
  private async connectOnce(
    serverId: string,
    generation: number,
    input: ConnectInput,
    reservation: ConnectReservation,
  ): Promise<ConnectOutcome> {
    if (
      this.entries.has(serverId) &&
      !["failed", "disconnected", "awaiting_host_trust"].includes(
        this.entries.get(serverId)!.snapshot.status,
      )
    )
      throw new Error("SESSION_BUSY");
    const active = [...this.entries.values()].filter(
      (entry) =>
        entry.snapshot.serverId !== serverId &&
        !["disconnected", "failed"].includes(entry.snapshot.status),
    );
    if (active.length >= 3) throw new Error("SESSION_LIMIT");
    const retired = this.entries.get(serverId);
    if (retired) {
      this.disconnect(serverId, retired.snapshot.generation);
      await Promise.race([retired.retirement!, reservation.cancelledPromise]);
    }
    if (reservation.cancelled) throw new Error("CONNECTION_LOST");
    for (const [id, existing] of this.entries) {
      if (this.entries.size < 10) break;
      if (
        id !== serverId &&
        existing.slotReleased &&
        ["failed", "disconnected"].includes(existing.snapshot.status)
      )
        this.entries.delete(id);
    }
    const client = new Client();
    const verifier = new HostKeyVerifier(
      input.trustedHostKey === null
        ? null
        : Buffer.from(input.trustedHostKey, "base64"),
    );
    let resolveControlClosed!: () => void;
    const controlClosed = new Promise<void>((done) => {
      resolveControlClosed = done;
    });
    const entry: RecordEntry = {
      socketStarted: false,
      slotReleased: false,
      controlClosed,
      resolveControlClosed,
      retirement: null,
      snapshot: {
        serverId,
        generation,
        status: "connecting",
        os: "unknown",
        osConfirmed: false,
        sftp: "unknown",
        initialPath: null,
        errorCode: null,
      },
      client,
      sftp: null,
      input,
      agent: null,
      auxiliary: null,
      metadata: new MetadataQueue(() => {
        if (
          this.entries.get(serverId) !== entry ||
          entry.snapshot.status !== "connected"
        )
          throw new Error("CONNECTION_LOST");
      }),
    };
    this.entries.set(serverId, entry);
    this.changed(entry, {});
    let method: Parameters<typeof oneShotAuthentication>[0];
    try {
      if (input.authentication === "key") {
        if (!input.keyBytes) throw new Error("KEY_INVALID");
        const parsed = await this.parser.parse(
          Buffer.from(input.keyBytes),
          input.passphrase,
          () =>
            !reservation.cancelled &&
            this.entries.get(serverId) === entry &&
            entry.snapshot.status === "connecting",
        );
        if (
          this.entries.get(serverId) !== entry ||
          entry.snapshot.status !== "connecting"
        )
          throw new Error("CONNECTION_LOST");
        entry.agent = new SingleKeyAgent(
          createPrivateKey(parsed.privatePEM),
          parsed.publicSSH,
        );
        input.keyBytes?.fill(0);
        delete input.keyBytes;
        delete input.passphrase;
        method = {
          type: "agent",
          username: input.username,
          agent: entry.agent,
        };
      } else {
        if (input.password === undefined) throw new Error("INPUT_INVALID");
        method = {
          type: "password",
          username: input.username,
          password: input.password,
        };
      }
    } catch (error) {
      if (!["disconnecting", "disconnected"].includes(entry.snapshot.status))
        this.changed(entry, {
          status: "failed",
          errorCode: errorCodeOf(error),
        });
      this.release(entry);
      throw error;
    }
    return new Promise<ConnectOutcome>((resolve, reject) => {
      let settled = false;
      const finish = (error: string | null, value?: ConnectOutcome) => {
        if (settled) return;
        settled = true;
        if (error || !value) reject(new Error(error ?? "CONNECTION_LOST"));
        else resolve(value);
      };
      client.on("handshake", () => {
        if (entry.snapshot.status === "connecting")
          this.changed(entry, { status: "authenticating" });
      });
      client.on("ready", () => {
        this.changed(entry, { status: "connected", errorCode: null });
        void entry.metadata
          .run(() => this.inspect(entry))
          .then(() =>
            finish(null, {
              status: "connected",
              snapshot: { ...entry.snapshot },
            }),
          )
          .catch(() => {
            this.changed(entry, { status: "failed", errorCode: "IO_TIMEOUT" });
            client.destroy();
            finish("IO_TIMEOUT");
          });
      });
      client.on("error", (error: Error & { level?: string }) => {
        const observed = verifier.observation();
        if (observed && input.trustedHostKey === null) {
          this.changed(entry, {
            status: "awaiting_host_trust",
            errorCode: null,
          });
          this.release(entry);
          finish(null, {
            status: "awaiting_host_trust",
            publicKey: observed.publicKey.toString("base64"),
            fingerprint: observed.fingerprint,
          });
          return;
        }
        const changed =
          observed &&
          input.trustedHostKey !== null &&
          !observed.publicKey.equals(
            Buffer.from(input.trustedHostKey, "base64"),
          );
        const errorCode = changed
          ? "HOST_KEY_CHANGED"
          : error.level === "client-authentication"
            ? "AUTH_FAILED"
            : error.level === "client-timeout"
              ? "CONNECT_TIMEOUT"
              : "CONNECTION_LOST";
        this.changed(entry, { status: "failed", errorCode });
        this.release(entry);
        finish(errorCode);
      });
      client.on("close", () => {
        entry.resolveControlClosed();
        this.release(entry);
        if (
          !["failed", "disconnected", "awaiting_host_trust"].includes(
            entry.snapshot.status,
          )
        )
          this.changed(entry, {
            status: "disconnected",
            errorCode: "CONNECTION_LOST",
          });
        finish("CONNECTION_LOST");
      });
      try {
        entry.socketStarted = true;
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
        this.changed(entry, { status: "failed", errorCode: "INPUT_INVALID" });
        this.release(entry);
        finish("INPUT_INVALID");
      }
    });
  }
  private async timed<T>(
    action: (done: (error: Error | undefined | null, value: T) => void) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("IO_TIMEOUT")), 15000);
      try {
        action((error, value) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(value);
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }
  private async inspect(entry: RecordEntry): Promise<void> {
    const access = this.commandAccess(
      entry.snapshot.serverId,
      entry.snapshot.generation,
    );
    try {
      const os = successful(await runCommand(access, OS_COMMAND, 16385, 15000));
      this.changed(entry, { os: identifyOS(os) });
    } catch {
      this.changed(entry, { os: "unknown" });
    }
    try {
      const path = canonicalPath(
        successful(await runCommand(access, START_COMMAND, 8192, 15000)),
      );
      this.changed(entry, { initialPath: path, metadata: "available" });
    } catch {
      this.changed(entry, { initialPath: null, metadata: "unavailable" });
    }
    try {
      const home = await resolveAccountHome(entry.client);
      await new UbuntuMetadata(access).verifyDirectory(home);
      this.changed(entry, { homePath: home });
    } catch {
      this.changed(entry, { homePath: null });
    }
    try {
      const sftp = await this.timed<SFTPWrapper>((done) =>
        entry.client.sftp(done),
      );
      try {
        access.check();
      } catch (e) {
        sftp.end();
        throw e;
      }
      entry.sftp = sftp;
      this.changed(entry, { sftp: "available" });
    } catch (error) {
      access.check();
      if (error instanceof Error && error.message === "IO_TIMEOUT") throw error;
      this.changed(entry, { sftp: "unavailable" });
    }
  }
  confirmOS(serverId: string, generation: number): void {
    const entry = this.entries.get(serverId);
    if (
      !entry ||
      entry.snapshot.generation !== generation ||
      entry.snapshot.status !== "connected" ||
      entry.snapshot.os !== "unknown"
    )
      throw new Error("INPUT_INVALID");
    this.changed(entry, { osConfirmed: true });
  }
  disconnect(serverId: string, expectedGeneration?: number): void {
    const pending = this.connecting.get(serverId),
      cancelsPending = Boolean(
        pending &&
          (expectedGeneration === undefined ||
            pending.generation === expectedGeneration),
      );
    if (cancelsPending) pending!.cancel();
    const entry = this.entries.get(serverId);
    if (!entry) return;
    if (
      expectedGeneration !== undefined &&
      entry.snapshot.generation !== expectedGeneration
    ) {
      if (cancelsPending) return;
      throw new Error("INPUT_INVALID");
    }
    this.changed(entry, { status: "disconnecting" });
    entry.client.destroy();
    this.release(entry);
    this.changed(entry, { status: "disconnected", errorCode: null });
  }
  private release(entry: RecordEntry): void {
    entry.auxiliary?.closeAll();
    if (!entry.socketStarted) entry.resolveControlClosed();
    entry.retirement ??= Promise.all([
      entry.controlClosed,
      entry.auxiliary?.settled() ?? Promise.resolve(),
    ]).then(() => {
      entry.slotReleased = true;
    });
    entry.agent?.dispose();
    entry.agent = null;
    entry.sftp = null;
    if (entry.input.keyBytes) entry.input.keyBytes.fill(0);
    delete entry.input.password;
    delete entry.input.passphrase;
    delete entry.input.keyBytes;
  }
  closeAll(): void {
    for (const pending of this.connecting.values()) pending.cancel();
    for (const id of this.entries.keys()) this.disconnect(id);
  }
}
