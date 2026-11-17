import { describe, expect, it } from "vitest";
import { ExecutionOutputRing } from "../../src/worker/execution/output-ring";
describe("bounded GUI execution output", () => {
  it("keeps stdout/stderr arrival order, partial cursor reads and newly coalesced bytes without replay", () => {
    const ring = new ExecutionOutputRing();
    ring.register("one");
    ring.append("one", "stdout", new TextEncoder().encode("first"));
    const first = ring.read("one", 0, 2);
    expect(new TextDecoder().decode(first.frames[0]!.bytes)).toBe("fi");
    ring.append("one", "stdout", new TextEncoder().encode(" second"));
    ring.append("one", "stderr", new TextEncoder().encode("error"));
    const next = ring.read("one", first.nextOffset);
    expect(next.frames.map((frame) => frame.stream)).toEqual([
      "stdout",
      "stderr",
    ]);
    expect(
      next.frames.map((frame) => new TextDecoder().decode(frame.bytes)),
    ).toEqual(["rst second", "error"]);
    next.frames[0]!.bytes.fill(0);
    expect(new TextDecoder().decode(ring.read("one", 2).frames[0]!.bytes)).toBe(
      "rst second",
    );
  });
  it("evicts oldest data at per-job bounds and reports the lost cursor explicitly", () => {
    const ring = new ExecutionOutputRing(65536, 131072);
    ring.register("one");
    ring.append("one", "stdout", new Uint8Array(100000).fill(1));
    const page = ring.read("one", 0);
    expect(page.gap).toBe(true);
    expect(page.omitted).toBe(true);
    expect(page.frames.every((frame) => frame.bytes.length <= 32768)).toBe(
      true,
    );
    expect(ring.usage().chargedBytes).toBeLessThanOrEqual(65536);
  });
  it("releases terminal output first under aggregate pressure and otherwise removes the oldest global chunks", () => {
    const ring = new ExecutionOutputRing(65536, 70000);
    for (const id of ["a", "b", "c"]) ring.register(id);
    ring.append("a", "stdout", new Uint8Array(30000));
    ring.append("b", "stderr", new Uint8Array(30000));
    ring.terminal("b");
    ring.append("c", "stdout", new Uint8Array(30000));
    expect(ring.read("b", 0).frames).toEqual([]);
    expect(ring.read("a", 0).frames).toHaveLength(1);
    ring.append("c", "stderr", new Uint8Array(30000));
    expect(ring.read("a", 0).gap).toBe(true);
    expect(ring.usage().chargedBytes).toBeLessThanOrEqual(70000);
  });
  it("bounds tiny alternating chunks by charging metadata and frees all storage on session cleanup", () => {
    const ring = new ExecutionOutputRing(65536, 131072);
    ring.register("one");
    for (let i = 0; i < 10000; i++)
      ring.append(
        "one",
        i % 2 ? "stderr" : "stdout",
        new Uint8Array([i % 256]),
      );
    expect(ring.usage().chunks).toBeLessThanOrEqual(Math.floor(65536 / 65));
    const page = ring.read("one", 0);
    expect(page.frames.length).toBeLessThanOrEqual(256);
    expect(page.gap).toBe(true);
    ring.forget("one");
    expect(ring.usage()).toEqual({ chargedBytes: 0, chunks: 0 });
    expect(() => ring.read("one", 0)).toThrow("TOKEN_EXPIRED");
  });
});
