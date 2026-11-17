import { describe, expect, it, vi } from "vitest";
import { TerminalInputBoundary } from "../../src/shared/terminal-input-boundary";
import { PTYStream } from "../../src/worker/terminal/stream";
import { ExecutionOutputRing } from "../../src/worker/execution/output-ring";
import { terminalSize } from "../../src/shared/terminals";
describe("PTY input and restore boundaries", () => {
  it("uses exact input sequences, distinguishes Enter from unconfirmed multiline input and bounds rolling rate/in-flight bytes", () => {
    let now = 0;
    const input = new TerminalInputBoundary(() => now);
    const done = input.reserve(1, new Uint8Array([13]), "key");
    expect(input.pendingBytes).toBe(1);
    expect(() => input.reserve(1, new Uint8Array([13]), "key")).toThrow(
      "INPUT_INVALID",
    );
    expect(() =>
      input.reserve(2, new TextEncoder().encode("x\ny"), "key"),
    ).toThrow("INPUT_INVALID");
    done();
    done();
    expect(input.pendingBytes).toBe(0);
    const pasted = input.reserve(2, new Uint8Array(65535), "paste");
    expect(() => input.reserve(3, new Uint8Array([1]), "key")).toThrow(
      "INPUT_LIMIT",
    );
    pasted();
    now = 1000;
    input.reserve(3, new Uint8Array([3]), "key")();
    expect(input.nextSequence).toBe(4);
  });
  it("rejects event floods explicitly and clamps only finite terminal dimensions", () => {
    const input = new TerminalInputBoundary(() => 0);
    for (let i = 1; i <= 120; i++)
      input.reserve(i, new Uint8Array([65]), "key")();
    expect(() => input.reserve(121, new Uint8Array([65]), "key")).toThrow(
      "INPUT_LIMIT",
    );
    expect(terminalSize(9999, 0)).toEqual({ cols: 500, rows: 1 });
    expect(terminalSize(1.9, 201)).toEqual({ cols: 2, rows: 200 });
    expect(() => terminalSize(NaN, 24)).toThrow("INPUT_INVALID");
  });
  it("freezes a fixed snapshot and does not resume before every replay chunk and the matching final ACK", () => {
    const ring = new ExecutionOutputRing(1024 ** 2, 6 * 1024 ** 2),
      pause = vi.fn(),
      resume = vi.fn(),
      stream = new PTYStream("one", ring, pause, resume);
    stream.append(new Uint8Array(100000));
    const token = crypto.randomUUID(),
      frozen = stream.freeze(token);
    expect(frozen.endOffset).toBe(100000);
    expect(stream.ready).toBe(false);
    expect(() => stream.acknowledgeRestore(token, 100000)).toThrow(
      "TOKEN_EXPIRED",
    );
    let cursor = frozen.startOffset;
    while (cursor < frozen.endOffset) {
      const batch = stream.read(cursor);
      expect(
        batch.frames.reduce((sum, row) => sum + row.bytes.length, 0),
      ).toBeLessThanOrEqual(32768);
      expect(resume).not.toHaveBeenCalled();
      const replay = stream.read(cursor);
      expect(replay.nextOffset).toBe(batch.nextOffset);
      cursor = batch.nextOffset;
    }
    expect(() =>
      stream.acknowledgeRestore(crypto.randomUUID(), cursor),
    ).toThrow("TOKEN_EXPIRED");
    stream.acknowledgeRestore(token, cursor);
    expect(stream.ready).toBe(true);
    expect(resume).toHaveBeenCalledOnce();
  });
  it("pauses live production at256KiB unacknowledged, resumes on consumption and locks again on renderer loss", () => {
    const pause = vi.fn(),
      resume = vi.fn(),
      ring = new ExecutionOutputRing(1024 ** 2, 6 * 1024 ** 2),
      stream = new PTYStream("one", ring, pause, resume);
    const token = crypto.randomUUID();
    stream.freeze(token);
    stream.acknowledgeRestore(token, 0);
    stream.append(new Uint8Array(256 * 1024));
    expect(pause).toHaveBeenCalled();
    const first = stream.read(0);
    expect(first.nextOffset).toBe(32768);
    const before = resume.mock.calls.length;
    stream.read(first.nextOffset);
    expect(resume.mock.calls.length).toBe(before + 1);
    stream.interrupt();
    expect(stream.ready).toBe(false);
    expect(() => stream.read(0)).toThrow("RESTORE_REQUIRED");
  });
  it("reports truncated history and starts a new frozen display without replaying removed bytes", () => {
    const ring = new ExecutionOutputRing(1024 ** 2, 6 * 1024 ** 2),
      stream = new PTYStream(
        "one",
        ring,
        () => {},
        () => {},
      );
    stream.append(new Uint8Array(2 * 1024 ** 2));
    let freeze = stream.freeze(crypto.randomUUID());
    expect(freeze.omitted).toBe(true);
    expect(freeze.startOffset).toBeGreaterThan(0);
    stream.clearDisplayHistory();
    freeze = stream.freeze(crypto.randomUUID());
    expect(freeze.startOffset).toBe(freeze.endOffset);
    stream.acknowledgeRestore(freeze.restoreToken, freeze.endOffset);
    expect(stream.ready).toBe(true);
  });
});
