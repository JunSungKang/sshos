import { describe, expect, it } from "vitest";
import { MetadataQueue } from "../../src/worker/connections/metadata-queue";
describe("control metadata operation serialization", () => {
  it("holds the whole operation, then continues FIFO even after an operation failure", async () => {
    const observed: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((done) => {
        release = done;
      }),
      queue = new MetadataQueue(() => {});
    const first = queue.run(async () => {
      observed.push("open");
      await gate;
      observed.push("close");
      throw new Error("fixture");
    });
    const failure = expect(first).rejects.toThrow("fixture");
    const second = queue.run(async () => {
      observed.push("next");
      return 2;
    });
    await Promise.resolve();
    expect(observed).toEqual(["open"]);
    release();
    await failure;
    expect(await second).toBe(2);
    expect(observed).toEqual(["open", "close", "next"]);
  });
  it("rejects queued work after disconnect without calling its SFTP action", async () => {
    let current = true,
      called = false,
      release!: () => void;
    const queue = new MetadataQueue(() => {
      if (!current) throw new Error("CONNECTION_LOST");
    });
    const first = queue.run(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    const next = queue.run(async () => {
      called = true;
    });
    const failure = expect(next).rejects.toThrow("CONNECTION_LOST");
    await Promise.resolve();
    current = false;
    release();
    await first;
    await failure;
    expect(called).toBe(false);
  });
  it("bounds pending metadata requests", async () => {
    let release!: () => void;
    const queue = new MetadataQueue(() => {}, 1);
    const first = queue.run(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    await expect(queue.run(async () => {})).rejects.toThrow("REQUEST_BUSY");
    release();
    await first;
  });
});
