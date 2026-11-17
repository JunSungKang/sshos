/** Per explicit preview revision. Failed/abandoned reservations stay charged. */
export class WebReadBudget {
  constructor(private remaining = 64 * 1024 * 1024) {}
  assertAvailable(): void {
    if (this.remaining <= 0) throw new Error("FILE_LIMIT");
  }
  reserve(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.remaining)
      throw new Error("FILE_LIMIT");
    this.remaining -= bytes;
  }
}
