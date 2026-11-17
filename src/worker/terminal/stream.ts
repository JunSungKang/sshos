import type { OutputBatch } from "../execution/output-ring";
import { ExecutionOutputRing } from "../execution/output-ring";
type Frozen = { token: string; start: number; end: number; omitted: boolean };
/** Ring history and live backpressure are distinct from the renderer's replay barrier. */
export class PTYStream {
  private frozen: Frozen | null = null;
  private uiReady = false;
  private ackOffset = 0;
  private expected = 0;
  private end = 0;
  private last: { cursor: number; batch: OutputBatch } | null = null;
  constructor(
    private readonly id: string,
    private readonly ring: ExecutionOutputRing,
    private readonly pause: () => void,
    private readonly resume: () => void,
  ) {
    ring.register(id);
  }
  get ready(): boolean {
    return this.uiReady;
  }
  private setPaused(value: boolean): void {
    if (value) this.pause();
    else this.resume();
  }
  append(bytes: Uint8Array): void {
    this.ring.append(this.id, "stdout", bytes);
    this.end += bytes.length;
    if (!this.uiReady || this.frozen || this.end - this.ackOffset >= 256 * 1024)
      this.setPaused(true);
  }
  interrupt(): void {
    this.uiReady = false;
    this.frozen = null;
    this.last = null;
    this.setPaused(true);
  }
  freeze(token: string): {
    restoreToken: string;
    startOffset: number;
    endOffset: number;
    omitted: boolean;
  } {
    this.interrupt();
    const first = this.ring.read(this.id, 0, 1),
      start = first.frames[0]?.offset ?? first.nextOffset;
    this.frozen = { token, start, end: this.end, omitted: first.omitted };
    this.expected = start;
    return {
      restoreToken: token,
      startOffset: start,
      endOffset: this.end,
      omitted: first.omitted,
    };
  }
  read(cursor: number): OutputBatch {
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new Error("INPUT_INVALID");
    if (!this.uiReady && !this.frozen) throw new Error("RESTORE_REQUIRED");
    if (this.last?.cursor === cursor) return structuredClone(this.last.batch);
    if (cursor !== this.expected) throw new Error("INPUT_INVALID");
    if (this.last) {
      this.ackOffset = cursor;
      this.last = null;
      if (
        !this.frozen &&
        this.uiReady &&
        this.end - this.ackOffset < 256 * 1024
      )
        this.setPaused(false);
    }
    const limit = this.frozen?.end ?? this.end;
    if (cursor > limit) throw new Error("INPUT_INVALID");
    const batch =
      cursor === limit
        ? {
            frames: [],
            nextOffset: cursor,
            endOffset: limit,
            omitted: this.frozen?.omitted ?? false,
            gap: false,
          }
        : this.ring.read(this.id, cursor, Math.min(32768, limit - cursor));
    batch.endOffset = limit;
    this.expected = batch.nextOffset;
    if (batch.nextOffset > cursor)
      this.last = { cursor, batch: structuredClone(batch) };
    return batch;
  }
  acknowledgeRestore(token: string, offset: number): void {
    const frozen = this.frozen;
    if (
      !frozen ||
      frozen.token !== token ||
      offset !== frozen.end ||
      this.expected !== frozen.end
    )
      throw new Error("TOKEN_EXPIRED");
    this.frozen = null;
    this.last = null;
    this.ackOffset = offset;
    this.expected = offset;
    this.uiReady = true;
    this.setPaused(false);
  }
  clearDisplayHistory(): void {
    this.interrupt();
    this.ring.clear(this.id);
    this.ackOffset = this.end;
    this.expected = this.end;
  }
  close(): void {
    this.ring.terminal(this.id);
    this.setPaused(!this.uiReady || this.frozen !== null);
  }
  forget(): void {
    this.interrupt();
    this.ring.forget(this.id);
  }
}
