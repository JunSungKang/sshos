import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerReceiptWriter } from "../../src/worker/receipt-writer";
import { MainReceiptChannel } from "../../src/main/receipt-channel";
import type { ReceiptRepository } from "../../src/main/persistence/receipts";
import { transferReceipt } from "../fixtures/transfers";

const download = () => ({
  ...transferReceipt("download"),
  relayParentId: crypto.randomUUID(),
});
function requestFor(row: ReturnType<typeof download>) {
  return {
    type: "relay:checkDisk",
    requestId: crypto.randomUUID(),
    backendEpoch: row.backendEpoch,
    serverId: row.serverId,
    generation: row.generation,
    taskId: row.taskId,
    parentId: row.relayParentId,
  };
}
afterEach(() => {
  vi.useRealTimers();
});
describe("relay worker to main dispatch check", () => {
  it("awaits the disk check on the recorded download before authorizing the worker", async () => {
    const row = download(),
      check = vi.fn(async () => {}),
      mainPost = vi.fn((msg) => worker.accept(msg));
    const repo = {
      get: (id: string) => (id === row.taskId ? row : null),
      faulted: false,
    } as unknown as ReceiptRepository;
    const main = new MainReceiptChannel(
      row.backendEpoch,
      () => repo,
      () => true,
      mainPost,
      check,
    );
    const worker = new WorkerReceiptWriter(row.backendEpoch, (q) =>
      main.accept(q),
    );
    await worker.checkRelay(row);
    expect(check).toHaveBeenCalledWith(row);
    expect(mainPost).toHaveBeenCalledOnce();
    check.mockRejectedValueOnce(Error("LOCAL_SPACE_UNKNOWN"));
    await expect(worker.checkRelay(row)).rejects.toThrow("LOCAL_SPACE_UNKNOWN");
  });
  it("does not check an unrelated child, account generation, parent, epoch, or malformed request", async () => {
    const row = download(),
      query = requestFor(row);
    const repo = { get: vi.fn(() => row as unknown), faulted: false },
      check = vi.fn(),
      post = vi.fn();
    const main = new MainReceiptChannel(
      row.backendEpoch,
      () => repo as unknown as ReceiptRepository,
      () => true,
      post,
      check,
    );
    for (const invalid of [
      { ...query, serverId: crypto.randomUUID() },
      { ...query, generation: 2 },
      { ...query, parentId: crypto.randomUUID() },
    ]) {
      main.accept(invalid);
      expect(post.mock.lastCall?.[0].error).toBe("TOKEN_EXPIRED");
    }
    for (const invalidRow of [
      undefined,
      { ...row, kind: "gui_exec" },
      { ...row, direction: "upload" },
      { ...row, backendEpoch: crypto.randomUUID() },
    ]) {
      repo.get.mockReturnValueOnce(invalidRow);
      main.accept(query);
      expect(post.mock.lastCall?.[0].error).toBe("TOKEN_EXPIRED");
    }
    expect(check).not.toHaveBeenCalled();
    post.mockClear();
    main.accept({ ...query, backendEpoch: crypto.randomUUID() });
    main.accept({ ...query, requestId: "bad" });
    expect(post).not.toHaveBeenCalled();
    const noHandler = new MainReceiptChannel(
      row.backendEpoch,
      () => repo as unknown as ReceiptRepository,
      () => true,
      post,
    );
    noHandler.accept(query);
    expect(post.mock.lastCall?.[0].error).toBe("TOKEN_EXPIRED");
  });
  it("withholds dispatch if the store faults, is replaced, or becomes unhealthy during the async disk check", async () => {
    for (const change of ["fault", "replace", "unhealthy"]) {
      const row = download(),
        post = vi.fn(),
        disk = Promise.withResolvers<void>();
      let repo = { get: () => row, faulted: false },
        healthy = true;
      const main = new MainReceiptChannel(
        row.backendEpoch,
        () => repo as unknown as ReceiptRepository,
        () => healthy,
        post,
        () => disk.promise,
      );
      main.accept(requestFor(row));
      expect(post).not.toHaveBeenCalled();
      if (change === "fault") repo.faulted = true;
      else if (change === "replace") repo = { ...repo };
      else healthy = false;
      disk.resolve();
      await disk.promise;
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({ error: "STORAGE_FAILED" }),
      );
    }
  });
  it("stops a pending check on storage failure, transport failure, lost ACK or missing disk history", async () => {
    const row = download(),
      query = requestFor(row),
      post = vi.fn(),
      check = vi.fn(),
      repo = { get: () => row, faulted: false };
    for (const [store, healthy] of [
      [null, true],
      [{ ...repo, faulted: true }, true],
      [repo, false],
    ] as const) {
      const main = new MainReceiptChannel(
        row.backendEpoch,
        () => store as ReceiptRepository | null,
        () => healthy,
        post,
        check,
      );
      main.accept(query);
      expect(post.mock.lastCall?.[0].error).toBe("STORAGE_FAILED");
    }
    expect(check).not.toHaveBeenCalled();
    vi.useFakeTimers();
    post.mockClear();
    const worker = new WorkerReceiptWriter(row.backendEpoch, post);
    const first = worker.checkRelay(row),
      second = worker.checkRelay(row);
    const checked = (i: number, overrides: object = {}) => ({
      action: "relay:diskChecked",
      requestId: post.mock.calls[i]![0].requestId,
      backendEpoch: row.backendEpoch,
      error: null,
      ...overrides,
    });
    worker.accept(checked(0, { backendEpoch: crypto.randomUUID() }));
    worker.accept(checked(0, { requestId: crypto.randomUUID() }));
    await expect(worker.checkRelay(row)).rejects.toThrow("STORAGE_FAILED");
    worker.accept(checked(1, { error: "LOCAL_SPACE_UNKNOWN" }));
    await expect(second).rejects.toThrow("LOCAL_SPACE_UNKNOWN");
    const expired = expect(first).rejects.toThrow("IO_TIMEOUT");
    await vi.runOnlyPendingTimersAsync();
    await expired;
    worker.accept(checked(0)); // a late acknowledgement grants nothing
    const next = worker.checkRelay(row);
    worker.stop();
    await expect(next).rejects.toThrow("STORAGE_FAILED");
    await expect(worker.checkRelay(row)).rejects.toThrow("STORAGE_FAILED");
    const disconnected = new WorkerReceiptWriter(row.backendEpoch, () => {
      throw Error("closed");
    });
    await expect(disconnected.checkRelay(row)).rejects.toThrow(
      "ENGINE_STOPPED",
    );
    await expect(disconnected.checkRelay(transferReceipt())).rejects.toThrow(
      "STORAGE_FAILED",
    );
  });
});
