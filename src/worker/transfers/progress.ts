/** Millisecond monotonic samples: at most3000 buckets in the recent3s. */
export class TransferRate {
  private readonly buckets: { at: number; bytes: number }[] = [];
  private started: number;
  private last: number | null = null;
  constructor(now: number) {
    if (!Number.isFinite(now)) throw new Error("INPUT_INVALID");
    this.started = Math.floor(now);
  }
  add(bytes: number, now: number): void {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      !Number.isFinite(now) ||
      now < this.started ||
      (this.last !== null && now < this.last)
    )
      throw new Error("INPUT_INVALID");
    now = Math.floor(now);
    this.last = now;
    const bucket = now;
    const last = this.buckets.at(-1);
    if (last?.at === bucket) last.bytes += bytes;
    else this.buckets.push({ at: bucket, bytes });
    this.prune(now);
  }
  private prune(now: number): void {
    while (this.buckets.length && this.buckets[0]!.at <= now - 3000)
      this.buckets.shift();
  }
  value(now: number): number | null {
    if (
      !Number.isFinite(now) ||
      now < this.started ||
      this.last === null ||
      now < this.last
    )
      return null;
    now = Math.floor(now);
    this.prune(now);
    if (now - this.last >= 3000) return null;
    const elapsed = Math.min(3000, now - this.started);
    return elapsed > 0
      ? (this.buckets.reduce((sum, row) => sum + row.bytes, 0) * 1000) / elapsed
      : null;
  }
  reset(now: number): void {
    if (!Number.isFinite(now)) throw new Error("INPUT_INVALID");
    this.started = Math.floor(now);
    this.last = null;
    this.buckets.length = 0;
  }
}
