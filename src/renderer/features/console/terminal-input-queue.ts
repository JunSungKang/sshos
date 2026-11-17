import type { TerminalInputResult } from "../../../shared/terminal-ui";
type Item = { bytes: Uint8Array; offset: number };
export class TerminalInputQueue {
  private readonly queue: Item[] = [];
  private bytes = 0;
  private sequence = 1;
  private enabled = false;
  private running = false;
  private closed = false;
  private failed = false;
  private version = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(
    private readonly send: (
      sequence: number,
      bytes: Uint8Array,
    ) => Promise<TerminalInputResult>,
    private readonly state: (pending: number) => void,
    private readonly fault: (message: string) => void,
  ) {}
  synchronize(nextSequence: number): void {
    if (this.running || !Number.isSafeInteger(nextSequence) || nextSequence < 1)
      throw new Error("REQUEST_BUSY");
    this.sequence = nextSequence;
  }
  get pendingBytes(): number {
    return this.bytes;
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled && !this.failed) void this.drain();
  }
  enqueue(bytes: Uint8Array): boolean {
    if (this.closed || this.failed) return false;
    if (!bytes.length) return true;
    if (this.bytes + bytes.length > 65536) {
      this.fault(
        `입력 전송 대기 한도에 도달했습니다. 새 ${bytes.length}byte는 전송하지 않았습니다.`,
      );
      return false;
    }
    this.queue.push({ bytes: Uint8Array.from(bytes), offset: 0 });
    this.bytes += bytes.length;
    this.state(this.bytes);
    void this.drain();
    return true;
  }
  private notify(): void {
    if (!this.running && !this.queue.length)
      for (const waiter of this.waiters.splice(0)) waiter();
  }
  async settled(): Promise<void> {
    if (this.failed) throw new Error("INPUT_RESULT_UNKNOWN");
    if (!this.running && !this.queue.length) return;
    await new Promise<void>((done) => this.waiters.push(done));
    if (this.failed) throw new Error("INPUT_RESULT_UNKNOWN");
  }
  private async drain(): Promise<void> {
    if (this.running || this.closed || !this.enabled || this.failed) return;
    this.running = true;
    const version = this.version;
    try {
      while (
        this.queue.length &&
        !this.closed &&
        this.enabled &&
        !this.failed &&
        version === this.version
      ) {
        const item = this.queue[0]!,
          size = Math.min(4096, item.bytes.length - item.offset),
          chunk = item.bytes.slice(item.offset, item.offset + size);
        let result: TerminalInputResult;
        try {
          result = await this.send(this.sequence, chunk);
        } finally {
          chunk.fill(0);
        }
        if (this.closed || version !== this.version) return;
        if (!result.accepted) {
          await new Promise((done) => setTimeout(done, result.retryAfterMs));
          continue;
        }
        this.sequence = result.nextSequence;
        item.offset += size;
        this.bytes -= size;
        if (item.offset === item.bytes.length) {
          item.bytes.fill(0);
          this.queue.shift();
        }
        this.state(this.bytes);
        await new Promise((done) =>
          setTimeout(
            done,
            Math.max(10, Math.ceil((size * 1000) / (55 * 1024))),
          ),
        );
      }
    } catch {
      if (!this.closed && version === this.version) {
        this.failed = true;
        this.enabled = false;
        this.fault(
          "입력 전송 결과를 확인하지 못했습니다. 대기 입력을 자동 재전송하지 않습니다. 표시 복구 또는 세션 닫기를 선택하세요.",
        );
        for (const waiter of this.waiters.splice(0)) waiter();
      }
    } finally {
      this.running = false;
      this.notify();
      if (this.enabled && !this.failed && !this.closed && this.queue.length)
        void this.drain();
    }
  }
  reset(nextSequence: number): number {
    if (!Number.isSafeInteger(nextSequence) || nextSequence < 1)
      throw new Error("INPUT_INVALID");
    const discarded = this.bytes;
    this.version++;
    this.enabled = false;
    this.failed = false;
    for (const item of this.queue) item.bytes.fill(0);
    this.queue.length = 0;
    this.bytes = 0;
    this.sequence = nextSequence;
    this.state(0);
    for (const waiter of this.waiters.splice(0)) waiter();
    return discarded;
  }
  dispose(): void {
    this.closed = true;
    this.reset(this.sequence);
  }
}
