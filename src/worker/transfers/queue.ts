import {
  PathLocks,
  type PathClaim,
} from "../../shared/file-policies/path-locks";
export type QueuedTransfer = {
  taskId: string;
  serverId: string;
  generation: number;
  remoteClaims: PathClaim[];
  localClaims: PathClaim[];
};
type Row = QueuedTransfer & { sequence: number };
/** Single-event-loop scheduler; persistence and socket closure precede commit/release. */
export class TransferQueue {
  private readonly waiting: Row[] = [];
  private readonly active = new Map<string, Row>();
  private readonly restricted = new Map<string, Row>();
  private readonly reservations = new Map<string, number>();
  private sequence = 0;
  private readonly localLocks = new PathLocks();
  constructor(private readonly remoteLocks: PathLocks) {}
  get queuedCount(): number {
    return this.waiting.length;
  }
  get activeCount(): number {
    return this.active.size;
  }
  reserve(token: string, count: number): void {
    if (
      this.reservations.has(token) ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 100
    )
      throw new Error("INPUT_INVALID");
    const reserved = [...this.reservations.values()].reduce((a, b) => a + b, 0);
    if (this.waiting.length + reserved + count > 100)
      throw new Error("TASK_LIMIT");
    this.reservations.set(token, count);
  }
  releaseReservation(token: string): void {
    this.reservations.delete(token);
  }
  commit(token: string, rows: QueuedTransfer[]): void {
    const count = this.reservations.get(token);
    if (
      count !== rows.length ||
      rows.length === 0 ||
      new Set(rows.map((row) => row.taskId)).size !== rows.length ||
      rows.some(
        (row) =>
          this.active.has(row.taskId) ||
          this.restricted.has(row.taskId) ||
          this.waiting.some((old) => old.taskId === row.taskId),
      ) ||
      !Number.isSafeInteger(this.sequence + rows.length)
    )
      throw new Error("INPUT_INVALID");
    this.reservations.delete(token);
    for (const row of rows)
      this.waiting.push({ ...structuredClone(row), sequence: ++this.sequence });
  }
  take(): QueuedTransfer | null {
    if (this.active.size >= 2) return null;
    for (let index = 0; index < this.waiting.length; index++) {
      const row = this.waiting[index]!;
      if (
        [...this.active.values()].some(
          (active) => active.serverId === row.serverId,
        )
      )
        continue;
      if (!this.remoteLocks.acquire(row.taskId, row.serverId, row.remoteClaims))
        continue;
      if (!this.localLocks.acquire(row.taskId, "local", row.localClaims)) {
        this.remoteLocks.release(row.taskId);
        continue;
      }
      this.waiting.splice(index, 1);
      this.active.set(row.taskId, row);
      return structuredClone(row);
    }
    return null;
  }
  cancelQueued(taskId: string): QueuedTransfer | null {
    const index = this.waiting.findIndex((row) => row.taskId === taskId);
    if (index < 0) return null;
    return this.waiting.splice(index, 1)[0]!;
  }
  finish(taskId: string, keepRestriction: boolean): void {
    const row = this.active.get(taskId);
    if (!row) throw new Error("INPUT_INVALID");
    this.active.delete(taskId);
    if (keepRestriction) this.restricted.set(taskId, row);
    else {
      this.remoteLocks.release(taskId);
      this.localLocks.release(taskId);
    }
  }
  acknowledge(taskId: string): void {
    if (!this.restricted.delete(taskId)) return;
    this.remoteLocks.release(taskId);
    this.localLocks.release(taskId);
  }
  queuedFor(serverId: string, generation: number): QueuedTransfer[] {
    return this.waiting
      .filter(
        (row) => row.serverId === serverId && row.generation === generation,
      )
      .map((row) => structuredClone(row));
  }
}
