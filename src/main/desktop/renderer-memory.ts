import { randomUUID } from "node:crypto";
type Renderer = { key: string; workingSetKiB: number | null };
/** Observes the renderer's working set, never the JS heap or app total. */
export class RendererMemoryGuard {
  private key: string | null = null;
  private high = 0;
  private latched = false;
  private token: string | null = null;
  private waiting = false;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private readonly interval: ReturnType<typeof setInterval>;
  constructor(
    private readonly renderer: () => Renderer | null,
    private readonly block: () => void,
    private readonly replace: (key: string) => void,
  ) {
    this.interval = setInterval(() => this.sample(), 1000);
    this.interval.unref();
  }
  sample(): void {
    const row = this.renderer();
    if (row?.key !== this.key) {
      this.reset();
      this.key = row?.key ?? null;
    }
    if (
      !row ||
      row.workingSetKiB === null ||
      !Number.isFinite(row.workingSetKiB) ||
      row.workingSetKiB < 0
    ) {
      this.high = 0;
      return;
    }
    if (row.workingSetKiB / 1024 <= 1536) {
      this.high = 0;
      this.latched = false;
      return;
    }
    if (this.latched || this.waiting) return;
    if (++this.high < 2) return;
    this.latched = true;
    this.waiting = true;
    this.token = randomUUID();
    const key = row.key,
      token = this.token;
    // Revoke input synchronously before asking a possibly overloaded renderer.
    this.block();
    this.deadline = setTimeout(() => {
      this.deadline = null;
      if (
        this.waiting &&
        this.key === key &&
        this.token === token &&
        this.renderer()?.key === key
      ) {
        this.waiting = false;
        this.replace(key);
      }
    }, 2000);
    this.deadline.unref();
  }
  get displayToken(): string | null {
    return this.token;
  }
  acknowledge(key: string, token: string): boolean {
    if (key !== this.key || token !== this.token) return false;
    this.waiting = false;
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
    return true;
  }
  private reset(): void {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
    this.high = 0;
    this.latched = false;
    this.waiting = false;
    this.token = null;
  }
  dispose(): void {
    clearInterval(this.interval);
    this.reset();
  }
}
