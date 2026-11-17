export class NativeDialogGate {
  private readonly active = new Set<number>();
  async run<T>(frame: number, action: () => Promise<T>): Promise<T> {
    if (!Number.isSafeInteger(frame) || frame < 1)
      throw new Error("IPC_DENIED");
    if (this.active.has(frame)) throw new Error("REQUEST_BUSY");
    this.active.add(frame);
    try {
      return await action();
    } finally {
      this.active.delete(frame);
    }
  }
}
