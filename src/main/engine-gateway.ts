import { z } from "zod";
import { engineRequestCapacity } from "../shared/engine-priority";
import { randomUUID } from "node:crypto";
import type { UtilityProcess } from "electron";
import {
  engineEventSchema,
  engineRequestSchema,
  type EngineCommand,
} from "../shared/engine-protocol";
import {
  sessionSnapshotSchema,
  type SessionSnapshot,
} from "../shared/session-contracts";
import type { TerminalRuntime } from "../shared/terminals";
import type { ExecutionRuntime } from "../shared/execution-ui";
import type { TransferRuntime } from "../shared/transfer-protocol";
import type { MutationObservation } from "../shared/mutations";

export class EngineGateway {
  private readonly pending = new Map<
    string,
    {
      serverId: string;
      generation: number;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private stopped = false;
  private lastSequence = 0;
  private readonly sessionSequences = new Map<string, number>();
  private lastTransferSequence = 0;
  private lastExecutionSequence = 0;
  private lastTerminalSequence = 0;
  constructor(
    private worker: UtilityProcess,
    private currentEpoch: string,
    private readonly sessionChanged: (snapshot: SessionSnapshot) => void,
    private receiptChannel?: { accept(raw: unknown): boolean },
    private readonly transferChanged?: (
      snapshot: TransferRuntime,
      gap: boolean,
      sequence: number,
    ) => void,
    private readonly executionChanged?: (
      snapshot: ExecutionRuntime,
      gap: boolean,
      sequence: number,
    ) => void,
    private readonly terminalChanged?: (
      snapshot: TerminalRuntime,
      gap: boolean,
      sequence: number,
    ) => void,
    private readonly mutationObserved?: (value: MutationObservation) => void,
  ) {
    this.bind(worker, currentEpoch);
  }
  get epoch(): string {
    return this.currentEpoch;
  }
  get running(): boolean {
    return !this.stopped;
  }
  restart(
    worker: UtilityProcess,
    epoch: string,
    receiptChannel?: { accept(raw: unknown): boolean },
  ): void {
    if (!this.stopped || epoch === this.currentEpoch)
      throw new Error("REQUEST_BUSY");
    this.worker = worker;
    this.currentEpoch = epoch;
    this.receiptChannel = receiptChannel;
    this.stopped = false;
    this.lastSequence = 0;
    this.sessionSequences.clear();
    this.lastTransferSequence = 0;
    this.lastExecutionSequence = 0;
    this.lastTerminalSequence = 0;
    this.bind(worker, epoch);
  }
  private bind(worker: UtilityProcess, epoch: string): void {
    worker.on("message", (raw: unknown) => {
      if (this.worker !== worker || this.currentEpoch !== epoch || this.stopped)
        return;
      if (this.receiptChannel?.accept(raw)) return;
      const event = engineEventSchema.safeParse(raw);
      if (!event.success || event.data.backendEpoch !== epoch) return;
      const data = event.data;
      if (data.type === "mutation_observation") {
        const { type: _type, ...value } = data;
        this.mutationObserved?.(value);
        return;
      }
      if (data.type === "pty") {
        if (data.sequence <= this.lastTerminalSequence) return;
        const gap = data.sequence !== this.lastTerminalSequence + 1;
        this.lastTerminalSequence = data.sequence;
        this.terminalChanged?.(data.snapshot, gap, data.sequence);
        return;
      }
      if (data.type === "execution") {
        if (data.sequence <= this.lastExecutionSequence) return;
        const gap = data.sequence !== this.lastExecutionSequence + 1;
        this.lastExecutionSequence = data.sequence;
        this.executionChanged?.(data.snapshot, gap, data.sequence);
        return;
      }
      if (data.type === "transfer") {
        if (data.sequence <= this.lastTransferSequence) return;
        const gap = data.sequence !== this.lastTransferSequence + 1;
        this.lastTransferSequence = data.sequence;
        this.transferChanged?.(data.snapshot, gap, data.sequence);
        return;
      }
      if (data.type === "session") {
        if (data.sequence <= this.lastSequence) return;
        const gap = data.sequence !== this.lastSequence + 1;
        this.lastSequence = data.sequence;
        this.sessionSequences.set(data.snapshot.serverId, data.sequence);
        this.sessionChanged(data.snapshot);
        if (gap)
          void this.request({
            action: "session:snapshot",
            serverId: data.snapshot.serverId,
            generation: data.snapshot.generation,
          })
            .then((result) => {
              if (
                this.worker !== worker ||
                this.currentEpoch !== epoch ||
                this.stopped
              )
                return;
              const page = z
                .object({
                  sequence: z.int().nonnegative(),
                  rows: sessionSnapshotSchema.array().max(10),
                })
                .strict()
                .parse(result);
              for (const snapshot of page.rows) {
                if (
                  (this.sessionSequences.get(snapshot.serverId) ?? 0) >
                  page.sequence
                )
                  continue;
                this.sessionSequences.set(snapshot.serverId, page.sequence);
                this.sessionChanged(snapshot);
              }
              this.lastSequence = Math.max(this.lastSequence, page.sequence);
            })
            .catch(() => {});
        return;
      }
      const pending = this.pending.get(data.requestId);
      if (
        !pending ||
        pending.serverId !== data.serverId ||
        pending.generation !== data.generation
      )
        return;
      this.pending.delete(data.requestId);
      clearTimeout(pending.timer);
      if (data.ok) pending.resolve(data.result);
      else pending.reject(new Error(data.errorCode ?? "INTERNAL_ERROR"));
    });
    worker.on("exit", () => {
      if (this.worker !== worker || this.currentEpoch !== epoch) return;
      this.stopped = true;
      for (const value of this.pending.values()) {
        clearTimeout(value.timer);
        value.reject(new Error("ENGINE_STOPPED"));
      }
      this.pending.clear();
    });
  }
  request(request: EngineCommand): Promise<unknown> {
    if (this.stopped) return Promise.reject(new Error("ENGINE_STOPPED"));
    if (this.pending.size >= engineRequestCapacity(request.action))
      return Promise.reject(new Error("REQUEST_BUSY"));
    const message = engineRequestSchema.parse({
      ...request,
      requestId: randomUUID(),
      backendEpoch: this.epoch,
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.requestId);
        reject(new Error("IO_TIMEOUT"));
      }, 90000);
      this.pending.set(message.requestId, {
        serverId: message.serverId,
        generation: message.generation,
        timer,
        resolve,
        reject,
      });
      try {
        this.worker.postMessage(message);
      } catch {
        this.pending.delete(message.requestId);
        clearTimeout(timer);
        reject(new Error("ENGINE_STOPPED"));
      }
    });
  }
}
