import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  AtomicJSONStore,
  canonicalJSON,
} from "../../src/main/persistence/store";

const owned: string[] = [];
async function path() {
  const base = resolve(".local/tmp");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(resolve(base, "store-"));
  owned.push(dir);
  return resolve(dir, "state.json");
}
afterEach(async () => {
  for (const dir of owned.splice(0)) await rm(dir, { recursive: true });
});
const schema = z.object({ count: z.int().nonnegative() }).strict();
describe("single-writer durable JSON", () => {
  it("does not downgrade a future schema by falling back to an older backup", async () => {
    const file = await path();
    const store = new AtomicJSONStore(file, schema, 1024);
    await store.initialize({ count: 1 });
    await store.save({ count: 2 });
    const future = JSON.parse(await readFile(file, "utf8"));
    future.schemaVersion = 2;
    await writeFile(file, JSON.stringify(future));
    const loaded = new AtomicJSONStore(file, schema, 1024);
    await expect(loaded.load()).rejects.toThrow("STORAGE_FUTURE_SCHEMA");
    await expect(loaded.save({ count: 0 })).rejects.toThrow("STORAGE_FAILED");
    expect(JSON.parse(await readFile(file, "utf8")).schemaVersion).toBe(2);
  });
  it("initializes explicitly, serializes concurrent changes, and reloads exact state", async () => {
    const file = await path();
    const store = new AtomicJSONStore(file, schema, 1024);
    await store.initialize({ count: 0 });
    await Promise.all(
      Array.from({ length: 20 }, () =>
        store.update((current) => ({ count: current!.count + 1 })),
      ),
    );
    expect(store.snapshot().count).toBe(20);
    const reloaded = new AtomicJSONStore(file, schema, 1024);
    expect(await reloaded.load()).toEqual({
      value: { count: 20 },
      recovered: false,
    });
    await expect(
      new AtomicJSONStore(file, schema, 1024).initialize({ count: 0 }),
    ).rejects.toThrow("STORAGE_EXISTS");
  });
  it("recovers valid backup but locks when both copies are invalid", async () => {
    const file = await path();
    const store = new AtomicJSONStore(file, schema, 1024);
    await store.initialize({ count: 1 });
    await store.save({ count: 2 });
    await writeFile(file, "{corrupt");
    const recovered = new AtomicJSONStore(file, schema, 1024);
    expect(await recovered.load()).toEqual({
      value: { count: 1 },
      recovered: true,
    });
    await recovered.save({ count: 3 });
    expect(
      (await new AtomicJSONStore(file, schema, 1024).load()).value.count,
    ).toBe(3);
    await writeFile(file, "{broken");
    await writeFile(`${file}.bak`, "{broken");
    const failed = new AtomicJSONStore(file, schema, 1024);
    await expect(failed.load()).rejects.toThrow("STORAGE_FAILED");
    await expect(failed.save({ count: 0 })).rejects.toThrow("STORAGE_FAILED");
  });
  it("rejects valid JSON with modified payload checksum and refuses silent initialization", async () => {
    const file = await path();
    const store = new AtomicJSONStore(file, schema, 1024);
    await store.initialize({ count: 1 });
    const raw = JSON.parse(await readFile(file, "utf8"));
    raw.payload.count = 999;
    await writeFile(file, JSON.stringify(raw));
    await expect(
      new AtomicJSONStore(file, schema, 1024).load(),
    ).rejects.toThrow("STORAGE_FAILED");
  });
  it("canonicalizes object keys by Unicode code point and rejects unsupported values", () => {
    expect(canonicalJSON({ "\u{10000}": 2, "\uE000": 1 })).toBe(
      '{"\uE000":1,"\u{10000}":2}',
    );
    expect(() => canonicalJSON({ value: undefined })).toThrow();
    expect(() => canonicalJSON(NaN)).toThrow();
  });
});
