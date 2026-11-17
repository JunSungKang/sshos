import type { DecodedText } from "../shared/viewers/text";
import type { ImageHeader } from "../shared/viewers/image-header";
export type ViewerDecoded =
  | ({ type: "text" } & DecodedText)
  | { type: "image"; header: ImageHeader; bitmap: ImageBitmap };
export class ViewerDecoder {
  private readonly worker: Worker;
  private readonly waiting = new Map<
    number,
    {
      resolve(): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly result: Promise<ViewerDecoded>;
  private resolveResult!: (value: ViewerDecoded) => void;
  private rejectResult!: (error: Error) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private error: Error | null = null;
  private disposed = false;
  private finishing = false;
  constructor(
    private readonly jobId: string,
    kind: "text" | "image",
    size: number,
  ) {
    this.worker = new Worker(new URL("./viewer-worker.ts", import.meta.url), {
      type: "module",
    });
    this.result = new Promise((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    void this.result.catch(() => {});
    this.worker.onmessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== "object") {
        this.fail(new Error("INTERNAL_ERROR"));
        return;
      }
      const value = event.data as {
        type?: string;
        jobId?: string;
        sequence?: number;
        code?: string;
        bitmap?: ImageBitmap;
      } & Record<string, unknown>;
      if (
        this.disposed ||
        (value.jobId !== jobId &&
          !(value.type === "error" && value.jobId === null))
      ) {
        if (value.bitmap instanceof ImageBitmap) value.bitmap.close();
        return;
      }
      if (value.type === "consumed" && typeof value.sequence === "number") {
        const pending = this.waiting.get(value.sequence);
        if (pending) {
          clearTimeout(pending.timer);
          this.waiting.delete(value.sequence);
          pending.resolve();
        }
        return;
      }
      if (value.type === "error") {
        this.fail(
          new Error(
            typeof value.code === "string" && /^[A-Z_]{1,64}$/u.test(value.code)
              ? value.code
              : "VIEW_FORMAT_UNSUPPORTED",
          ),
        );
        return;
      }
      if (value.type === "text") {
        if (
          typeof value.text !== "string" ||
          value.text.length > 2 * 1024 * 1024 ||
          !(value.lineStarts instanceof Uint32Array) ||
          value.lineStarts.length > 2 * 1024 * 1024 + 1
        ) {
          this.fail(new Error("INTERNAL_ERROR"));
          return;
        }
        if (this.timer) clearTimeout(this.timer);
        this.resolveResult(value as unknown as ViewerDecoded);
        return;
      }
      if (value.type === "image") {
        const h = value.header as ImageHeader | undefined;
        if (
          !(value.bitmap instanceof ImageBitmap) ||
          !h ||
          !["png", "jpeg", "webp"].includes(h.format) ||
          !Number.isSafeInteger(h.width) ||
          !Number.isSafeInteger(h.height) ||
          h.width < 1 ||
          h.height < 1 ||
          h.width > 16384 ||
          h.height > 16384 ||
          h.width * h.height > 40000000 ||
          value.bitmap.width !== h.width ||
          value.bitmap.height !== h.height
        ) {
          if (value.bitmap instanceof ImageBitmap) value.bitmap.close();
          this.fail(new Error("INTERNAL_ERROR"));
          return;
        }
        if (this.timer) clearTimeout(this.timer);
        this.resolveResult(value as unknown as ViewerDecoded);
        return;
      }
      this.fail(new Error("INTERNAL_ERROR"));
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail(new Error("VIEW_FORMAT_UNSUPPORTED"));
    };
    this.worker.postMessage({ type: "init", jobId, kind, size });
  }
  consume(sequence: number, bytes: Uint8Array): Promise<void> {
    if (this.error || this.disposed)
      return Promise.reject(this.error ?? new Error("REQUEST_CANCELLED"));
    if (
      this.finishing ||
      this.waiting.has(sequence) ||
      !Number.isSafeInteger(sequence) ||
      sequence < 0 ||
      bytes.length < 1 ||
      bytes.length > 65536
    )
      return Promise.reject(new Error("INPUT_INVALID"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("IO_TIMEOUT")), 5000);
      this.waiting.set(sequence, { resolve, reject, timer });
      try {
        this.worker.postMessage(
          { type: "chunk", jobId: this.jobId, sequence, bytes },
          [bytes.buffer as ArrayBuffer],
        );
      } catch {
        this.fail(new Error("INTERNAL_ERROR"));
      }
    });
  }
  async finish(): Promise<ViewerDecoded> {
    if (this.error || this.disposed)
      throw this.error ?? new Error("REQUEST_CANCELLED");
    if (this.finishing) return this.result;
    if (this.waiting.size) throw new Error("REQUEST_BUSY");
    this.finishing = true;
    this.timer = setTimeout(() => this.fail(new Error("IO_TIMEOUT")), 5000);
    this.worker.postMessage({ type: "finish", jobId: this.jobId });
    return this.result;
  }
  private fail(error: Error): void {
    if (this.error) return;
    this.error = error;
    if (this.timer) clearTimeout(this.timer);
    for (const pending of this.waiting.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.waiting.clear();
    this.rejectResult(error);
    this.worker.terminate();
  }
  dispose(): void {
    this.disposed = true;
    this.fail(new Error("REQUEST_CANCELLED"));
    this.worker.terminate();
  }
}
