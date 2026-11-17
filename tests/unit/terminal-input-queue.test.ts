import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalInputQueue } from "../../src/renderer/features/console/terminal-input-queue";
afterEach(() => vi.useRealTimers());
describe("renderer input queue without implicit replay", () => {
  it("splits into4096byte packets and preserves exact bytes and order while pacing writes", async () => {
    vi.useFakeTimers();
    const records: { sequence: number; bytes: Uint8Array }[] = [],
      queue = new TerminalInputQueue(
        async (sequence, bytes) => {
          records.push({ sequence, bytes: Uint8Array.from(bytes) });
          return { accepted: true, nextSequence: sequence + 1 };
        },
        () => {},
        () => {
          throw new Error("Unexpected input failure");
        },
      );
    queue.reset(4);
    queue.setEnabled(true);
    const bytes = Uint8Array.from({ length: 10000 }, (_, i) => i % 256);
    expect(queue.enqueue(bytes)).toBe(true);
    const settled = queue.settled();
    await vi.runAllTimersAsync();
    await settled;
    expect(records.map((row) => row.sequence)).toEqual([4, 5, 6]);
    expect(records.every((row) => row.bytes.length <= 4096)).toBe(true);
    expect(Buffer.concat(records.map((row) => Buffer.from(row.bytes)))).toEqual(
      Buffer.from(bytes),
    );
    expect(queue.pendingBytes).toBe(0);
    queue.dispose();
  });
  it("waits only for explicitly unaccepted packets and never replays a packet after an unknown result", async () => {
    vi.useFakeTimers();
    let calls = 0,
      accepted = 0;
    const faults: string[] = [],
      queue = new TerminalInputQueue(
        async (sequence) => {
          calls++;
          if (calls <= 2) return { accepted: false, retryAfterMs: 20 };
          accepted++;
          return { accepted: true, nextSequence: sequence + 1 };
        },
        () => {},
        (message) => faults.push(message),
      );
    queue.setEnabled(true);
    queue.enqueue(new Uint8Array([65]));
    const settled = queue.settled();
    await vi.runAllTimersAsync();
    await settled;
    expect(calls).toBe(3);
    expect(accepted).toBe(1);
    expect(faults).toEqual([]);
    queue.dispose();
    const failed = new TerminalInputQueue(
      async () => {
        throw new Error("INPUT_RESULT_UNKNOWN");
      },
      () => {},
      (message) => faults.push(message),
    );
    failed.setEnabled(true);
    failed.enqueue(new Uint8Array([66, 67]));
    const failure = expect(failed.settled()).rejects.toThrow(
      "INPUT_RESULT_UNKNOWN",
    );
    await vi.runAllTimersAsync();
    await failure;
    expect(failed.pendingBytes).toBe(2);
    expect(failed.enqueue(new Uint8Array([68]))).toBe(false);
    expect(failed.reset(2)).toBe(2);
    expect(faults).toHaveLength(1);
    failed.dispose();
  });
  it("holds unsent automatic responses while a paste owns input, then synchronizes the next sequence without dropping those bytes", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (sequence: number) => ({
        accepted: true as const,
        nextSequence: sequence + 1,
      })),
      queue = new TerminalInputQueue(
        send,
        () => {},
        () => {},
      );
    queue.setEnabled(false);
    expect(queue.enqueue(new Uint8Array([27, 91, 99]))).toBe(true);
    expect(send).not.toHaveBeenCalled();
    queue.synchronize(8);
    queue.setEnabled(true);
    const settled = queue.settled();
    await vi.runAllTimersAsync();
    await settled;
    expect(send.mock.calls[0]?.[0]).toBe(8);
    expect(queue.pendingBytes).toBe(0);
    queue.dispose();
  });
  it("retains at most64KiB and reports overflow while allowing existing input to drain", async () => {
    vi.useFakeTimers();
    const fault = vi.fn(),
      records: number[] = [],
      queue = new TerminalInputQueue(
        async (sequence, bytes) => {
          records.push(bytes.length);
          return { accepted: true, nextSequence: sequence + 1 };
        },
        () => {},
        fault,
      );
    queue.enqueue(new Uint8Array(65536));
    expect(queue.enqueue(new Uint8Array([65]))).toBe(false);
    expect(fault).toHaveBeenCalledOnce();
    expect(queue.pendingBytes).toBe(65536);
    queue.setEnabled(true);
    const settled = queue.settled();
    await vi.runAllTimersAsync();
    await settled;
    expect(records.reduce((a, b) => a + b, 0)).toBe(65536);
    expect(queue.pendingBytes).toBe(0);
    queue.dispose();
  });
});
