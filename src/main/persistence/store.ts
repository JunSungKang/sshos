import { createHash, randomUUID } from "node:crypto";
import { open, rename, unlink, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  resolve,
  relative,
  isAbsolute,
  sep,
} from "node:path";
import { constants } from "node:fs";
import { z } from "zod";

function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0)!);
  const y = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i]! - y[i]!;
  }
  return x.length - y.length;
}
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) {
    const entries: string[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) throw new Error("STORAGE_INVALID");
      entries.push(canonicalJSON(value[i]));
    }
    return `[${entries.join(",")}]`;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort(compareCodePoints)
      .map((k) => `${JSON.stringify(k)}:${canonicalJSON(object[k])}`)
      .join(",")}}`;
  }
  throw new Error("STORAGE_INVALID");
}
const envelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    payload: z.unknown(),
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const hash = (value: unknown) =>
  createHash("sha256").update(canonicalJSON(value)).digest("hex");
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

export class AtomicJSONStore<T> {
  private current: T | undefined;
  private revision = 0;
  private tail: Promise<void> = Promise.resolve();
  private fault = false;
  private directorySyncUnavailable = false;
  private readonly path: string;
  readonly backup: string;
  constructor(
    path: string,
    private readonly schema: z.ZodType<T>,
    private readonly limit: number,
    private readonly onDirectorySyncUnavailable?: () => void,
  ) {
    if (!/^(state|[a-f0-9-]{36})\.json$/u.test(basename(path)))
      throw new Error("STORAGE_INVALID");
    this.path = resolve(path);
    this.backup = `${this.path}.bak`;
  }
  get faulted(): boolean {
    return this.fault;
  }
  async settled(): Promise<void> {
    await this.tail;
  }
  snapshot(): T {
    if (this.current === undefined) throw new Error("STORAGE_UNAVAILABLE");
    return structuredClone(this.current);
  }
  private async read(
    path: string,
  ): Promise<{ payload: T; revision: number; raw: Buffer }> {
    const parent = await realpath(dirname(this.path));
    const actual = await realpath(path);
    const rel = relative(parent, actual);
    if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
      throw new Error("STORAGE_INVALID");
    const fd = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stat = await fd.stat();
      if (!stat.isFile() || stat.size > this.limit || stat.size === 0)
        throw new Error("STORAGE_INVALID");
      const buffer = Buffer.alloc(this.limit + 1);
      let size = 0;
      while (size < buffer.length) {
        const r = await fd.read(buffer, size, buffer.length - size, size);
        if (!r.bytesRead) break;
        size += r.bytesRead;
      }
      if (size > this.limit) throw new Error("STORAGE_INVALID");
      const raw = Buffer.from(buffer.subarray(0, size));
      const decoded: unknown = JSON.parse(raw.toString("utf8"));
      if (
        typeof decoded === "object" &&
        decoded !== null &&
        "schemaVersion" in decoded &&
        typeof decoded.schemaVersion === "number" &&
        decoded.schemaVersion > 1
      )
        throw new Error("STORAGE_FUTURE_SCHEMA");
      const envelope = envelopeSchema.parse(decoded);
      const payload = this.schema.parse(envelope.payload);
      if (hash(envelope.payload) !== envelope.payloadSha256)
        throw new Error("STORAGE_INVALID");
      return { payload, revision: envelope.revision, raw };
    } finally {
      await fd.close();
    }
  }
  async load(): Promise<{ value: T; recovered: boolean }> {
    try {
      const row = await this.read(this.path);
      this.current = row.payload;
      this.revision = row.revision;
      return { value: this.snapshot(), recovered: false };
    } catch (error) {
      if (error instanceof Error && error.message === "STORAGE_FUTURE_SCHEMA") {
        this.fault = true;
        throw error;
      }
      try {
        const row = await this.read(this.backup);
        this.current = row.payload;
        this.revision = row.revision;
        return { value: this.snapshot(), recovered: true };
      } catch {
        this.fault = true;
        throw new Error("STORAGE_FAILED");
      }
    }
  }
  async recover(): Promise<{ value: T; recovered: boolean }> {
    await this.tail;
    const result = await this.load();
    this.fault = false;
    return result;
  }
  /** Explicit first initialization only; caller must prove this is a new store. */
  async initialize(value: T): Promise<void> {
    if (this.current !== undefined || this.fault)
      throw new Error("STORAGE_FAILED");
    for (const path of [this.path, this.backup]) {
      try {
        const fd = await open(path, "r");
        await fd.close();
        throw new Error("STORAGE_EXISTS");
      } catch (error) {
        if (code(error) !== "ENOENT") throw error;
      }
    }
    await this.save(value);
  }
  save(value: T): Promise<void> {
    return this.update(() => value);
  }
  update(change: (current: T | undefined) => T): Promise<void> {
    if (this.fault) return Promise.reject(new Error("STORAGE_FAILED"));
    const operation = this.tail.then(async () => {
      if (this.fault) throw new Error("STORAGE_FAILED");
      const payload = this.schema.parse(
        change(this.current === undefined ? undefined : this.snapshot()),
      );
      const revision = this.revision + 1;
      if (!Number.isSafeInteger(revision)) throw new Error("STORAGE_FAILED");
      const raw = Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          revision,
          payload,
          payloadSha256: hash(payload),
        }),
      );
      if (raw.length > this.limit) throw new Error("STORAGE_FAILED");
      const temp = resolve(dirname(this.path), `${randomUUID()}.tmp`);
      const backupTemp = resolve(dirname(this.path), `${randomUUID()}.tmp`);
      const owned = new Set<string>();
      const write = async (path: string, bytes: Buffer) => {
        const fd = await open(path, "wx", 0o600);
        owned.add(path);
        try {
          await fd.writeFile(bytes);
          await fd.sync();
        } finally {
          await fd.close();
        }
      };
      try {
        await write(temp, raw);
        let previous:
          | Awaited<ReturnType<AtomicJSONStore<T>["read"]>>
          | undefined;
        try {
          previous = await this.read(this.path);
        } catch (error) {
          // Recovering from a backup must not overwrite it with a broken current.
          if (this.current === undefined && code(error) !== "ENOENT")
            throw error;
        }
        if (previous) {
          await write(backupTemp, previous.raw);
          await this.replace(backupTemp, this.backup);
          owned.delete(backupTemp);
        }
        await this.replace(temp, this.path);
        owned.delete(temp);
        try {
          const directory = await open(dirname(this.path), "r");
          try {
            await directory.sync();
          } finally {
            await directory.close();
          }
        } catch (error) {
          if (
            !["EINVAL", "ENOTSUP", "EISDIR", "EPERM", "EACCES"].includes(
              code(error) ?? "",
            )
          )
            throw error;
          if (!this.directorySyncUnavailable) {
            this.directorySyncUnavailable = true;
            try {
              this.onDirectorySyncUnavailable?.();
            } catch {
              /* Reporting cannot change the already-written file outcome. */
            }
          }
        }
        this.current = payload;
        this.revision = revision;
      } catch {
        this.fault = true;
        throw new Error("STORAGE_FAILED");
      } finally {
        for (const path of owned) {
          try {
            await unlink(path);
          } catch {
            /* Retain storage fault; never remove unknown files. */
          }
        }
      }
    });
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return new Promise<void>((resolveResult, reject) => {
      const timer = setTimeout(() => {
        this.fault = true;
        reject(new Error("STORAGE_FAILED"));
      }, 5000);
      operation.then(
        () => {
          clearTimeout(timer);
          resolveResult();
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
  private async replace(source: string, destination: string): Promise<void> {
    const pauses = [100, 200, 400];
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(source, destination);
        return;
      } catch (error) {
        const delay = pauses[attempt];
        if (
          delay === undefined ||
          !["EACCES", "EPERM", "EBUSY"].includes(code(error) ?? "")
        )
          throw error;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
      }
    }
  }
}
