import { randomUUID } from "node:crypto";
import {
  probeResultSchema,
  type ProbeView,
  type ProbeResult,
  type ProbeIdentity,
} from "../../shared/probes";
import type { SessionView } from "../../shared/session-contracts";
import type { EngineGateway } from "../engine-gateway";
type Context = {
  key: string;
  serverId: string;
  generation: number;
  backendEpoch: string;
  probeEpoch: string;
};
export class ResponseProbe {
  private selected: string | null = null;
  private context: Context | null = null;
  private pending: string | null = null;
  private nextAt = 0;
  private receivedAt = 0;
  private requestAt = 0;
  private result: ProbeResult | null = null;
  private status: ProbeView["status"] = "idle";
  private readonly disabled = new Map<string, number>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(
    private readonly gateway: EngineGateway,
    private readonly sessions: () => SessionView[],
    private readonly foreground: () => boolean,
    private readonly transferring: (id: string) => boolean,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.timer = setInterval(() => this.refresh(), 1000);
    this.timer.unref();
  }
  select(id: string | null): void {
    if (id !== null && !this.sessions().some((row) => row.serverId === id))
      throw new Error("SESSION_UNAVAILABLE");
    if (this.selected === id) return;
    this.selected = id;
    this.invalidate();
  }
  invalidate(): void {
    const previous = this.context;
    if (previous && previous.backendEpoch === this.gateway.epoch)
      void this.gateway
        .request({
          action: "probe:invalidate",
          serverId: previous.serverId,
          generation: previous.generation,
          probeEpoch: previous.probeEpoch,
        })
        .catch(() => {});
    this.context = null;
    this.pending = null;
    this.result = null;
    this.nextAt = 0;
    this.refresh();
  }
  refresh(): void {
    const rows = this.sessions(),
      session = rows.find((row) => row.serverId === this.selected);
    for (const id of this.disabled.keys())
      if (!rows.some((row) => row.serverId === id)) this.disabled.delete(id);
    const connected = session?.status === "connected",
      foreground = this.foreground(),
      key = `${this.gateway.epoch}:${this.selected}:${session?.generation ?? 0}:${connected}:${foreground}`;
    if (this.context?.key !== key) {
      const previous = this.context;
      if (previous && previous.backendEpoch === this.gateway.epoch)
        void this.gateway
          .request({
            action: "probe:invalidate",
            serverId: previous.serverId,
            generation: previous.generation,
            probeEpoch: previous.probeEpoch,
          })
          .catch(() => {});
      this.pending = null;
      this.result = null;
      this.nextAt = 0;
      this.context =
        this.selected && session
          ? {
              key,
              serverId: this.selected,
              generation: session.generation,
              backendEpoch: this.gateway.epoch,
              probeEpoch: randomUUID(),
            }
          : null;
    }
    if (!this.selected || !session) {
      this.status = "idle";
      return;
    }
    if (!connected) {
      this.status = "disconnected";
      return;
    }
    if (!foreground) {
      this.status = "paused";
      return;
    }
    if (this.disabled.get(session.serverId) === session.generation) {
      this.status = "unavailable";
      return;
    }
    if (this.result && this.clock() - this.receivedAt >= 15000) {
      this.result = null;
      this.status = this.pending ? "measuring" : "waiting";
    }
    if (this.pending && this.clock() - this.requestAt >= 5000) {
      this.result = null;
      this.status = "delayed";
      return;
    }
    if (this.pending || this.clock() < this.nextAt) return;
    const context = this.context!;
    const probeId = randomUUID();
    this.pending = probeId;
    this.requestAt = this.clock();
    if (!this.result) this.status = "measuring";
    const identity: ProbeIdentity = {
      serverId: context.serverId,
      sessionGeneration: context.generation,
      backendEpoch: context.backendEpoch,
      probeEpoch: context.probeEpoch,
      probeId,
      transferActive: this.transferring(context.serverId),
    };
    void this.gateway
      .request({
        action: "probe:run",
        serverId: identity.serverId,
        generation: identity.sessionGeneration,
        probeEpoch: identity.probeEpoch,
        probeId,
        transferActive: identity.transferActive,
      })
      .then((raw) => {
        if (this.context !== context || this.pending !== probeId) return;
        const result = probeResultSchema.parse(raw);
        for (const key of [
          "serverId",
          "sessionGeneration",
          "backendEpoch",
          "probeEpoch",
          "probeId",
          "transferActive",
        ] as const)
          if (result[key] !== identity[key]) throw new Error("INPUT_INVALID");
        const late =
          result.status === "sample" && this.clock() - this.requestAt > 5000;
        this.result = result.status === "sample" && !late ? result : null;
        this.receivedAt = this.requestAt;
        this.status = late ? "delayed" : result.status;
        if (result.status === "unavailable")
          this.disabled.set(context.serverId, context.generation);
      })
      .catch((error) => {
        if (this.context !== context || this.pending !== probeId) return;
        this.result = null;
        this.status =
          error instanceof Error &&
          ["REQUEST_BUSY", "IO_TIMEOUT"].includes(error.message)
            ? "waiting"
            : "unavailable";
        if (this.status === "unavailable")
          this.disabled.set(context.serverId, context.generation);
      })
      .finally(() => {
        if (this.context === context && this.pending === probeId) {
          this.pending = null;
          this.nextAt = this.clock() + 5000;
        }
      });
  }
  view(): ProbeView {
    this.refresh();
    return {
      serverId: this.selected,
      generation: this.context?.generation ?? null,
      status: this.status,
      sample:
        this.status === "sample" && this.result
          ? structuredClone(this.result)
          : null,
    };
  }
  dispose(): void {
    clearInterval(this.timer);
    const previous = this.context;
    if (previous && previous.backendEpoch === this.gateway.epoch)
      void this.gateway
        .request({
          action: "probe:invalidate",
          serverId: previous.serverId,
          generation: previous.generation,
          probeEpoch: previous.probeEpoch,
        })
        .catch(() => {});
    this.context = null;
    this.pending = null;
    this.result = null;
  }
}
