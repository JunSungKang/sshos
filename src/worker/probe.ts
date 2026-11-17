import { closeDiscardedChannel } from "./connections/channel-close";
import type { Client, ClientChannel } from "ssh2";
import type { ProbeIdentity, ProbeResult } from "../shared/probes";
type Access = { client: Client; check(): void; metadataBusy: boolean };
type Job = {
  identity: ProbeIdentity;
  valid: boolean;
  delivered: boolean;
  status: ProbeResult["status"] | null;
  channel: ClientChannel | null;
  cancel(): void;
};
type State = {
  client: Client;
  disabled: boolean;
  nextAt: number;
  job: Job | null;
};
/** One pending probe per control generation, including late opening/closing. */
export class SSHProbe {
  private readonly states = new Map<string, State>();
  constructor(
    private readonly epoch: string,
    private readonly access: (serverId: string, generation: number) => Access,
    private readonly clock: () => number = () => performance.now(),
  ) {}
  private result(
    identity: ProbeIdentity,
    status: ProbeResult["status"],
    elapsedMs: number | null = null,
  ): ProbeResult {
    return {
      ...identity,
      status,
      elapsedMs,
      measuredAt: status === "sample" ? new Date().toISOString() : null,
    };
  }
  invalidate(serverId: string, generation: number, probeEpoch?: string): void {
    const state = this.states.get(`${serverId}:${generation}`);
    if (
      state?.job &&
      (!probeEpoch || state.job.identity.probeEpoch === probeEpoch)
    )
      state.job.cancel();
  }
  sessionChanged(
    serverId: string,
    generation: number,
    connected: boolean,
  ): void {
    for (const [key, state] of this.states) {
      if (!key.startsWith(`${serverId}:`)) continue;
      if (!connected || key !== `${serverId}:${generation}`) {
        if (state.job) state.job.cancel();
        else this.states.delete(key);
      }
    }
  }
  run(identity: ProbeIdentity): Promise<ProbeResult> {
    if (identity.backendEpoch !== this.epoch)
      return Promise.reject(new Error("TOKEN_EXPIRED"));
    const access = this.access(identity.serverId, identity.sessionGeneration);
    access.check();
    const key = `${identity.serverId}:${identity.sessionGeneration}`;
    let state = this.states.get(key);
    if (!state) {
      state = { client: access.client, disabled: false, nextAt: 0, job: null };
      this.states.set(key, state);
      const captured = state;
      access.client.once("close", () => {
        captured.job?.cancel();
        if (this.states.get(key) === captured) this.states.delete(key);
      });
    }
    if (state.client !== access.client)
      return Promise.reject(new Error("TOKEN_EXPIRED"));
    if (state.disabled)
      return Promise.resolve(this.result(identity, "unavailable"));
    if (state.job)
      return Promise.resolve(
        this.result(
          identity,
          state.job.status === "delayed" ? "delayed" : "waiting",
        ),
      );
    if (access.metadataBusy || this.clock() < state.nextAt)
      return Promise.resolve(this.result(identity, "waiting"));
    const owner = state;
    return new Promise<ProbeResult>((resolve) => {
      let started = 0,
        bytes = 0,
        exitZero = false,
        exitObserved = false,
        errorSeen = false,
        requested = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (
        status: ProbeResult["status"],
        elapsed: number | null = null,
      ) => {
        if (job.delivered) return;
        job.delivered = true;
        job.status = status;
        clearTimeout(timer);
        if (status !== "sample") job.valid = false;
        if (status === "unavailable") owner.disabled = true;
        resolve(this.result(identity, status, elapsed));
      };
      const close = () => {
        if (job.channel) closeDiscardedChannel(job.channel);
      };
      const release = () => {
        if (owner.job === job) {
          owner.job = null;
          owner.nextAt = this.clock() + 5000;
        }
      };
      const job: Job = {
        identity,
        valid: true,
        delivered: false,
        status: null,
        channel: null,
        cancel: () => {
          job.valid = false;
          finish("paused");
          close();
        },
      };
      owner.job = job;
      timer = setTimeout(() => {
        job.valid = false;
        finish("delayed");
        close();
      }, 5000);
      try {
        access.check();
        started = this.clock();
        requested = true;
        access.client.exec("/bin/true", (error, channel) => {
          if (error) {
            if (job.valid) finish("unavailable");
            release();
            return;
          }
          job.channel = channel;
          channel.once("close", () => {
            const elapsed = this.clock() - started;
            if (!job.delivered) {
              if (!job.valid) finish("paused");
              else if (elapsed > 5000) finish("delayed");
              else if (exitObserved && exitZero && !errorSeen && bytes <= 4096)
                finish("sample", Math.max(0, elapsed));
              else finish("unavailable");
            }
            job.valid = false;
            release();
          });
          channel.on("exit", (code: number | null, signal?: string) => {
            exitObserved = true;
            exitZero = code === 0 && !signal;
          });
          channel.on("error", () => {
            errorSeen = true;
            finish("unavailable");
            close();
          });
          if (!job.valid || this.clock() - started > 5000) {
            if (job.valid) {
              job.valid = false;
              finish("delayed");
            }
            close();
            return;
          }
          const discard = (value: Buffer) => {
            if (!job.valid) return;
            bytes += value.length;
            if (bytes > 4096) {
              finish("unavailable");
              close();
            }
          };
          channel.on("data", discard);
          channel.stderr.on("data", discard);
          if (!job.valid || this.clock() - started > 5000) {
            if (job.valid) {
              job.valid = false;
              finish("delayed");
            }
            close();
          }
        });
      } catch {
        finish(requested ? "unavailable" : "paused");
        release();
      }
    });
  }
}
