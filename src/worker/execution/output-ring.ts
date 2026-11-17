export type OutputStream = "stdout" | "stderr";
type Node = {
  sequence: number;
  id: string;
  offset: number;
  stream: OutputStream;
  bytes: Uint8Array;
};
type Job = {
  nodes: Node[];
  bytes: number;
  end: number;
  omitted: boolean;
  terminal: boolean;
};
export type OutputFrame = {
  sequence: number;
  offset: number;
  stream: OutputStream;
  bytes: Uint8Array;
};
export type OutputBatch = {
  frames: OutputFrame[];
  nextOffset: number;
  endOffset: number;
  omitted: boolean;
  gap: boolean;
};
const CHUNK = 32768,
  OVERHEAD = 64;
/** Payload plus a fixed metadata charge bounds both bytes and tiny-chunk counts. */
export class ExecutionOutputRing {
  private readonly jobs = new Map<string, Job>();
  private readonly nodes = new Map<number, Node>();
  private sequence = 0;
  private bytes = 0;
  constructor(
    private readonly perJob = 4 * 1024 ** 2,
    private readonly global = 16 * 1024 ** 2,
  ) {
    if (perJob < CHUNK + OVERHEAD || global < perJob)
      throw new Error("INPUT_INVALID");
  }
  register(id: string): void {
    if (this.jobs.has(id)) throw new Error("INPUT_INVALID");
    this.jobs.set(id, {
      nodes: [],
      bytes: 0,
      end: 0,
      omitted: false,
      terminal: false,
    });
  }
  private job(id: string): Job {
    const value = this.jobs.get(id);
    if (!value) throw new Error("TOKEN_EXPIRED");
    return value;
  }
  append(id: string, stream: OutputStream, input: Uint8Array): void {
    const job = this.job(id);
    for (let offset = 0; offset < input.length; ) {
      const previous = job.nodes.at(-1),
        merge =
          previous &&
          previous.stream === stream &&
          previous.bytes.length < CHUNK;
      const size = Math.min(
        input.length - offset,
        merge ? CHUNK - previous.bytes.length : CHUNK,
      );
      const part = input.subarray(offset, offset + size);
      if (merge) {
        const bytes = new Uint8Array(previous.bytes.length + size);
        bytes.set(previous.bytes);
        bytes.set(part, previous.bytes.length);
        previous.bytes = bytes;
        job.bytes += size;
        this.bytes += size;
      } else {
        const node: Node = {
          sequence: ++this.sequence,
          id,
          offset: job.end,
          stream,
          bytes: Uint8Array.from(part),
        };
        job.nodes.push(node);
        this.nodes.set(node.sequence, node);
        job.bytes += size + OVERHEAD;
        this.bytes += size + OVERHEAD;
      }
      job.end += size;
      offset += size;
      while (job.bytes > this.perJob) this.evict(job.nodes[0]!);
      while (this.bytes > this.global) {
        const terminal = [...this.jobs].find(
          ([, row]) => row.terminal && row.nodes.length,
        );
        if (terminal) this.clear(terminal[0]);
        else this.evict(this.nodes.values().next().value!);
      }
    }
  }
  private evict(node: Node): void {
    const job = this.job(node.id);
    const index = job.nodes.indexOf(node);
    if (index < 0) throw new Error("INTERNAL_ERROR");
    job.nodes.splice(index, 1);
    const cost = node.bytes.length + OVERHEAD;
    job.bytes -= cost;
    this.bytes -= cost;
    job.omitted = true;
    this.nodes.delete(node.sequence);
  }
  terminal(id: string): void {
    this.job(id).terminal = true;
  }
  clear(id: string): void {
    const job = this.job(id);
    for (const node of job.nodes) {
      this.bytes -= node.bytes.length + OVERHEAD;
      this.nodes.delete(node.sequence);
    }
    job.nodes = [];
    job.bytes = 0;
    job.omitted ||= job.end > 0;
  }
  forget(id: string): void {
    this.clear(id);
    this.jobs.delete(id);
  }
  read(id: string, cursor: number, budget = CHUNK): OutputBatch {
    const job = this.job(id);
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      cursor > job.end ||
      !Number.isInteger(budget) ||
      budget < 1 ||
      budget > CHUNK
    )
      throw new Error("INPUT_INVALID");
    const first = job.nodes[0]?.offset ?? job.end,
      gap = cursor < first;
    let next = Math.max(first, cursor),
      remaining = budget;
    const frames: OutputFrame[] = [];
    for (const node of job.nodes) {
      if (node.offset + node.bytes.length <= next) continue;
      const start = Math.max(0, next - node.offset),
        length = Math.min(remaining, node.bytes.length - start);
      if (!length) break;
      frames.push({
        sequence: node.sequence,
        offset: node.offset + start,
        stream: node.stream,
        bytes: node.bytes.slice(start, start + length),
      });
      next = node.offset + start + length;
      remaining -= length;
      if (!remaining || frames.length >= 256) break;
    }
    return {
      frames,
      nextOffset: next,
      endOffset: job.end,
      omitted: job.omitted,
      gap,
    };
  }
  usage(): { chargedBytes: number; chunks: number } {
    return { chargedBytes: this.bytes, chunks: this.nodes.size };
  }
}
