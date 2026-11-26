import {
  stagedTransferSchema,
  transferRuntimeSchema,
  type StagedTransfer,
  type TransferRuntime,
} from "../../shared/transfer-protocol";
import { receiptUnresolved } from "../../shared/receipts";
import { type TransferPhase } from "../../shared/transfers";
import type { SessionManager } from "../connections/session-manager";
import type { WorkerReceiptWriter } from "../receipt-writer";
import { PathLocks } from "../../shared/file-policies/path-locks";
import { transferClaims } from "../../shared/file-policies/transfer-claims";
import { TransferQueue } from "./queue";
import {
  TransferRunner,
  type TransferLive,
  type TransferHooks,
} from "./runner";
import { SFTPTransferPorts } from "./ports";
type Running = Pick<
  TransferRunner,
  "snapshot" | "cancel" | "interrupt" | "run"
>;
type Job = {
  spec: StagedTransfer;
  runner: Running | null;
  terminating: boolean;
  cleanupPending: boolean;
  slotOccupied: boolean;
  unexpected: boolean;
};
type Reservation = {
  serverId: string;
  generation: number;
  count: number;
  relayParentId?: string;
  rows: Map<number, StagedTransfer>;
};
type Factory = (spec: StagedTransfer, hooks: TransferHooks) => Running;

export class TransferCoordinator {
  private readonly queue: TransferQueue;
  private readonly reservations = new Map<string, Reservation>();
  private readonly jobs = new Map<string, Job>();
  private readonly errors = new Map<string, TransferRuntime>();
  private readonly restrictions = new Map<
    string,
    { serverId: string; generation: number }
  >();
  private queuedWrites: Promise<void> = Promise.resolve();
  private faultHandled = false;
  private readonly factory: Factory;
  constructor(
    private readonly epoch: string,
    private readonly sessions: Pick<SessionManager, "control" | "auxiliary">,
    locks: PathLocks,
    private readonly writer: Pick<WorkerReceiptWriter, "persist" | "faulted"> &
      Partial<Pick<WorkerReceiptWriter, "checkRelay">>,
    private readonly emit: (row: TransferRuntime) => void,
    factory?: Factory,
  ) {
    this.queue = new TransferQueue(locks);
    this.factory =
      factory ??
      ((spec, hooks) =>
        new TransferRunner(
          spec.row,
          (row, signal, late) =>
            new SFTPTransferPorts(
              row,
              spec.localDirectory,
              sessions,
              signal,
              late,
            ),
          hooks,
          spec.relay?.expectedSha256,
        ));
  }
  private healthy(): void {
    if (this.writer.faulted) {
      this.storageFault();
      throw new Error("STORAGE_FAILED");
    }
    this.faultHandled = false;
  }
  private permission(serverId: string, generation: number): void {
    this.sessions.control(serverId, generation, true).check();
  }
  holdRelay(serverId: string, generation: number, parentId: string): void {
    this.healthy();
    this.permission(serverId, generation);
    this.queue.holdRelay(parentId);
  }
  releaseRelay(parentId: string): void {
    this.queue.releaseRelay(parentId);
  }
  reserve(
    serverId: string,
    generation: number,
    token: string,
    count: number,
    relayParentId?: string,
  ): void {
    this.healthy();
    this.permission(serverId, generation);
    this.queue.reserve(token, count, relayParentId);
    this.reservations.set(token, {
      serverId,
      generation,
      count,
      ...(relayParentId ? { relayParentId } : {}),
      rows: new Map(),
    });
  }
  private reservation(
    serverId: string,
    generation: number,
    token: string,
  ): Reservation {
    const row = this.reservations.get(token);
    if (!row || row.serverId !== serverId || row.generation !== generation)
      throw new Error("TOKEN_EXPIRED");
    return row;
  }
  stage(
    serverId: string,
    generation: number,
    token: string,
    index: number,
    input: StagedTransfer,
  ): void {
    this.healthy();
    this.permission(serverId, generation);
    const reservation = this.reservation(serverId, generation, token);
    const spec = stagedTransferSchema.parse(input),
      row = spec.row;
    if (
      Buffer.byteLength(JSON.stringify(spec)) > 64000 ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= reservation.count ||
      row.serverId !== serverId ||
      row.generation !== generation ||
      spec.relay?.parentId !== reservation.relayParentId ||
      row.relayParentId !== reservation.relayParentId ||
      (spec.relay !== undefined &&
        (row.direction === "upload") !== Boolean(spec.relay.expectedSha256)) ||
      row.backendEpoch !== this.epoch ||
      row.phase !== "queued" ||
      row.transferredBytes !== 0 ||
      row.verifiedBytes !== 0 ||
      row.tempCreated ||
      row.destinationCreated ||
      row.dispatchAllowed ||
      row.streamSha256 !== null ||
      row.cleanupState !== "none" ||
      row.acknowledgedAt !== null ||
      row.recoveryUncertain ||
      row.recoveredFromPhase !== null ||
      row.lateObservations.length ||
      row.localParent !== spec.localDirectory.path ||
      this.jobs.has(row.taskId) ||
      this.errors.has(row.taskId) ||
      this.restrictions.has(row.taskId)
    )
      throw new Error("INPUT_INVALID");
    const previous = reservation.rows.get(index);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(spec))
        throw new Error("INPUT_INVALID");
      return;
    }
    if (
      [...this.reservations.values()].some((group) =>
        [...group.rows.values()].some(
          (value) => value.row.taskId === row.taskId,
        ),
      )
    )
      throw new Error("INPUT_INVALID");
    reservation.rows.set(index, structuredClone(spec));
  }
  release(serverId: string, generation: number, token: string): void {
    this.reservation(serverId, generation, token);
    this.reservations.delete(token);
    this.queue.releaseReservation(token);
  }
  commit(serverId: string, generation: number, token: string): string[] {
    this.healthy();
    this.permission(serverId, generation);
    const reservation = this.reservation(serverId, generation, token);
    if (reservation.rows.size !== reservation.count)
      throw new Error("INPUT_INVALID");
    const specs = [...reservation.rows]
      .sort((a, b) => a[0] - b[0])
      .map(([, spec]) => spec);
    this.queue.commit(
      token,
      specs.map((spec) => {
        const claims = transferClaims(spec.row);
        return {
          taskId: spec.row.taskId,
          serverId,
          generation,
          ...(spec.relay ? { relayParentId: spec.relay.parentId } : {}),
          remoteClaims: claims.remote,
          localClaims: claims.local,
        };
      }),
    );
    this.reservations.delete(token);
    for (const spec of specs) {
      this.jobs.set(spec.row.taskId, {
        spec,
        runner: null,
        terminating: false,
        cleanupPending: false,
        slotOccupied: false,
        unexpected: false,
      });
      this.publish(spec.row.taskId);
    }
    this.drain();
    return specs.map((spec) => spec.row.taskId);
  }
  private live(job: Job): TransferLive {
    return (
      job.runner?.snapshot() ?? {
        ...job.spec.row,
        recordError: false,
        bytesPerSecond: null,
      }
    );
  }
  private runtime(job: Job, live = this.live(job)): TransferRuntime {
    return transferRuntimeSchema.parse({
      taskId: live.taskId,
      serverId: live.serverId,
      generation: live.generation,
      phase: job.unexpected ? "result_unknown" : live.phase,
      totalBytes: live.totalBytes,
      transferredBytes: live.transferredBytes,
      verifiedBytes: live.verifiedBytes,
      bytesPerSecond: live.bytesPerSecond,
      cleanupState: live.cleanupState,
      tempCreated: live.tempCreated,
      destinationCreated: live.destinationCreated,
      lastConfirmedPhase: live.lastConfirmedPhase,
      errorCode: job.unexpected ? "INTERNAL_ERROR" : live.errorCode,
      updatedAt: live.updatedAt,
      recordError: job.unexpected || live.recordError,
      active: job.slotOccupied || job.terminating,
      slotOccupied: job.slotOccupied,
      cleanupPending: job.cleanupPending,
    });
  }
  private notify(row: TransferRuntime): void {
    try {
      this.emit(row);
    } catch {
      /* Observation loss cannot change I/O ownership. */
    }
  }
  private publish(id: string, live?: TransferLive): void {
    if (this.writer.faulted) this.storageFault();
    const job = this.jobs.get(id);
    if (job) this.notify(this.runtime(job, live));
  }
  private drain(): void {
    if (this.writer.faulted) {
      this.storageFault();
      return;
    }
    for (let entry = this.queue.take(); entry; entry = this.queue.take()) {
      const job = this.jobs.get(entry.taskId);
      if (!job) throw new Error("INTERNAL_ERROR");
      const entryId = entry.taskId;
      job.slotOccupied = true;
      try {
        job.runner = this.factory(job.spec, {
          persist: (row) => this.writer.persist(row),
          ...(job.spec.relay && job.spec.row.direction === "download"
            ? {
                beforeRead: async (row: typeof job.spec.row) => {
                  if (!this.writer.checkRelay)
                    throw new Error("STORAGE_FAILED");
                  await this.writer.checkRelay(row);
                },
              }
            : {}),
          update: (row) => this.publish(entryId, row),
        });
        void job.runner
          .run()
          .then((result) => {
            if (!result.resourcesClosed) {
              job.cleanupPending = true;
              this.publish(entryId);
              return;
            }
            const restricted = receiptUnresolved(result.snapshot);
            this.queue.finish(entryId, restricted);
            if (restricted)
              this.restrictions.set(entryId, {
                serverId: result.snapshot.serverId,
                generation: result.snapshot.generation,
              });
            const summary = {
              ...this.runtime(job, result.snapshot),
              active: false,
              slotOccupied: false,
            };
            if (summary.recordError || job.spec.relay)
              this.errors.set(entryId, summary);
            this.notify(summary);
            this.jobs.delete(entryId);
            this.drain();
          })
          .catch(() => {
            job.cleanupPending = true;
            job.unexpected = true;
            this.publish(entryId);
          });
      } catch {
        job.cleanupPending = true;
        job.unexpected = true;
        this.publish(entryId);
      }
    }
  }
  private finishQueued(
    job: Job,
    phase: "cancelled" | "interrupted",
  ): Promise<void> {
    job.terminating = true;
    job.spec.row = {
      ...job.spec.row,
      phase,
      stage: phase,
      errorCode: phase === "interrupted" ? "CONNECTION_LOST" : null,
      updatedAt: new Date().toISOString(),
    };
    this.publish(job.spec.row.taskId);
    const operation = this.queuedWrites.then(async () => {
      let recordError = false;
      try {
        await this.writer.persist(job.spec.row);
      } catch {
        recordError = true;
      }
      const summary = { ...this.runtime(job), active: false, recordError };
      if (recordError || job.spec.relay)
        this.errors.set(summary.taskId, summary);
      this.notify(summary);
      this.jobs.delete(summary.taskId);
      this.drain();
    });
    this.queuedWrites = operation.catch(() => {});
    return operation;
  }
  async cancel(
    serverId: string,
    generation: number,
    id: string,
  ): Promise<TransferPhase> {
    const job = this.jobs.get(id);
    if (
      !job ||
      job.spec.row.serverId !== serverId ||
      job.spec.row.generation !== generation
    )
      throw new Error("TOKEN_EXPIRED");
    if (job.runner) return job.runner.cancel();
    if (job.terminating) return job.spec.row.phase;
    if (job.slotOccupied) throw new Error("REQUEST_BUSY");
    if (!this.queue.cancelQueued(id)) throw new Error("INPUT_INVALID");
    await this.finishQueued(job, "cancelled");
    return "cancelled";
  }
  sessionChanged(
    serverId: string,
    generation: number,
    connected: boolean,
  ): void {
    for (const [token, reservation] of this.reservations)
      if (
        reservation.serverId === serverId &&
        (reservation.generation !== generation || !connected)
      ) {
        this.reservations.delete(token);
        this.queue.releaseReservation(token);
      }
    for (const [id, job] of this.jobs)
      if (
        job.spec.row.serverId === serverId &&
        (job.spec.row.generation !== generation || !connected)
      ) {
        if (job.runner) job.runner.interrupt();
        else if (!job.terminating && this.queue.cancelQueued(id))
          void this.finishQueued(job, "interrupted");
      }
  }
  storageFault(): void {
    if (this.faultHandled) return;
    this.faultHandled = true;
    for (const [id, job] of this.jobs) {
      if (job.runner) job.runner.interrupt("STORAGE_FAILED");
      else if (
        !job.terminating &&
        !job.slotOccupied &&
        this.queue.cancelQueued(id)
      )
        void this.finishQueued(job, "interrupted");
    }
    for (const [token] of this.reservations) {
      this.queue.releaseReservation(token);
      this.reservations.delete(token);
    }
  }
  acknowledge(serverId: string, generation: number, id: string): void {
    if (this.jobs.has(id)) throw new Error("REQUEST_BUSY");
    const identity = this.restrictions.get(id) ?? this.errors.get(id);
    if (
      identity &&
      (identity.serverId !== serverId || identity.generation !== generation)
    )
      throw new Error("TOKEN_EXPIRED");
    this.restrictions.delete(id);
    this.queue.acknowledge(id);
    this.errors.delete(id);
    this.drain();
  }
  snapshot(
    serverId: string,
    generation: number,
    offset = 0,
  ): { rows: TransferRuntime[]; nextOffset: number | null } {
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new Error("INPUT_INVALID");
    const values = [
      ...[...this.jobs.values()].map((job) => this.runtime(job)),
      ...this.errors.values(),
    ].filter(
      (row) => row.serverId === serverId && row.generation === generation,
    );
    const rows = values.slice(offset, offset + 100);
    return {
      rows,
      nextOffset:
        offset + rows.length < values.length ? offset + rows.length : null,
    };
  }
  quiescent(): boolean {
    return this.jobs.size === 0 && this.reservations.size === 0;
  }
  async settled(): Promise<void> {
    await this.queuedWrites;
  }
}
