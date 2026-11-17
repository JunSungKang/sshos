/** A whole metadata operation owns control SFTP until all its callbacks settle. */
export class MetadataQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  constructor(
    private readonly check: () => void,
    private readonly limit = 32,
  ) {}
  get busy(): boolean {
    return this.pending > 0;
  }
  run<T>(action: () => Promise<T>): Promise<T> {
    this.check();
    if (this.pending >= this.limit)
      return Promise.reject(new Error("REQUEST_BUSY"));
    this.pending++;
    const operation = this.tail.then(async () => {
      this.check();
      return action();
    });
    this.tail = operation
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        this.pending--;
      });
    return operation;
  }
}
