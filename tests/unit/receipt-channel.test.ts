import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { MainReceiptChannel } from "../../src/main/receipt-channel";
import { WorkerReceiptWriter } from "../../src/worker/receipt-writer";
import { ReceiptRepository } from "../../src/main/persistence/receipts";
import type { ReceiptSave, ReceiptACK } from "../../src/shared/receipt-channel";
import { transferReceipt } from "../fixtures/transfers";
const owned: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const path of owned.splice(0)) await rm(path, { recursive: true });
});
const ack = (request: ReceiptSave, ok = true): ReceiptACK => ({
  action: "receipt:ack",
  requestId: request.requestId,
  backendEpoch: request.backendEpoch,
  serverId: request.serverId,
  generation: request.generation,
  sequence: request.sequence,
  ok,
});
it("bounds worker pending permissions at16, rejects malformed/foreign ACKs and does not pause with pending writes", async () => {
  const row = transferReceipt(),
    messages: unknown[] = [],
    worker = new WorkerReceiptWriter(row.backendEpoch, (message) =>
      messages.push(message),
    );
  const pending = Array.from({ length: 16 }, () =>
    worker.persist({ ...transferReceipt(), backendEpoch: row.backendEpoch }),
  );
  await expect(worker.persist(row)).rejects.toThrow("REQUEST_BUSY");
  expect(() => worker.pauseAfterQuiescence()).toThrow("REQUEST_BUSY");
  expect(worker.accept({ action: "receipt:ack", unexpected: true })).toBe(
    false,
  );
  const requests = messages as ReceiptSave[];
  worker.accept({ ...ack(requests[0]!), backendEpoch: crypto.randomUUID() });
  worker.accept({ ...ack(requests[0]!), requestId: crypto.randomUUID() });
  worker.accept({ ...ack(requests[0]!), serverId: crypto.randomUUID() });
  worker.accept({ ...ack(requests[0]!), sequence: 999 });
  for (const request of requests) worker.accept(ack(request));
  await Promise.all(pending);
  worker.pauseAfterQuiescence();
  expect(worker.faulted).toBe(true);
  await expect(worker.persist(row)).rejects.toThrow("STORAGE_FAILED");
  worker.resetAfterStorageVerification();
  expect(worker.faulted).toBe(false);
});
it("fails closed if parent send/fault notification/observer throw and does not rerun the failure observer", async () => {
  const onFault = vi.fn(() => {
      throw new Error("observer failure");
    }),
    worker = new WorkerReceiptWriter(
      crypto.randomUUID(),
      () => {
        throw new Error("closed port");
      },
      onFault,
    ),
    row = { ...transferReceipt(), backendEpoch: worker.epoch };
  await expect(worker.persist(row)).rejects.toThrow("STORAGE_FAILED");
  expect(worker.faulted).toBe(true);
  worker.stop();
  worker.stop();
  expect(onFault).toHaveBeenCalledTimes(1);
});
it("rejects unrelated/malformed main messages and wrong epochs without granting permission or touching storage", async () => {
  const f = await fixture(),
    post = vi.fn(),
    main = new MainReceiptChannel(
      f.row.backendEpoch,
      () => f.repo,
      () => true,
      post,
    );
  for (const value of [null, "data", {}, { type: "unrelated" }])
    expect(main.accept(value)).toBe(false);
  expect(
    main.accept({ type: "receipt:save", backendEpoch: crypto.randomUUID() }),
  ).toBe(true);
  expect(f.repo.faulted).toBe(false);
  expect(
    main.accept({
      type: "receipt:fault",
      backendEpoch: f.row.backendEpoch,
      errorCode: "bogus",
    }),
  ).toBe(true);
  expect(f.repo.faulted).toBe(false);
  expect(post).not.toHaveBeenCalled();
  main.accept({ type: "receipt:save", backendEpoch: f.row.backendEpoch });
  expect(f.repo.faulted).toBe(true);
});
it("deduplicates an in-flight write, detects a changed replay and never acknowledges success after a storage fault", async () => {
  const f = await fixture(),
    post = vi.fn(),
    main = new MainReceiptChannel(
      f.row.backendEpoch,
      () => f.repo,
      () => true,
      post,
    );
  let release!: () => void;
  const save = f.repo.save.bind(f.repo);
  vi.spyOn(f.repo, "save").mockImplementation(async (row) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await save(row);
  });
  const request: ReceiptSave = {
    type: "receipt:save",
    requestId: crypto.randomUUID(),
    backendEpoch: f.row.backendEpoch,
    serverId: f.row.serverId,
    generation: 1,
    sequence: 1,
    receipt: { ...f.row, phase: "preparing" },
  };
  main.accept(request);
  main.accept(request);
  main.accept({
    ...request,
    receipt: { ...request.receipt, stage: "changed" },
  });
  expect(f.repo.faulted).toBe(true);
  release();
  await main.settled();
  expect(
    post.mock.calls.every((call) => (call[0] as ReceiptACK).ok === false),
  ).toBe(true);
});
it("bounds the main completion cache and pending writers without reusing old sequence permissions", async () => {
  const row = transferReceipt(),
    saved = new Map([[row.taskId, row]]),
    replies: ReceiptACK[] = [];
  let held = false;
  const releases: (() => void)[] = [];
  const repo = {
      faulted: false,
      get: (id: string) => saved.get(id),
      save: async (value: typeof row) => {
        if (held) await new Promise<void>((resolve) => releases.push(resolve));
        saved.set(value.taskId, value);
      },
      markFault: () => {},
    } as unknown as ReceiptRepository,
    main = new MainReceiptChannel(
      row.backendEpoch,
      () => repo,
      () => true,
      (value) => replies.push(value as ReceiptACK),
    );
  const request = (sequence: number): ReceiptSave => ({
    type: "receipt:save",
    requestId: crypto.randomUUID(),
    backendEpoch: row.backendEpoch,
    serverId: row.serverId,
    generation: 1,
    sequence,
    receipt: row,
  });
  const first = request(1);
  for (let sequence = 1; sequence <= 201; sequence++) {
    main.accept(sequence === 1 ? first : request(sequence));
    await main.settled();
  }
  main.accept(first);
  expect(replies.at(-1)?.ok).toBe(false);
  held = true;
  for (let sequence = 202; sequence < 218; sequence++)
    main.accept(request(sequence));
  main.accept(request(218));
  expect(replies.at(-1)?.ok).toBe(false);
  for (const release of releases) release();
  await main.settled();
  expect(replies.filter((value) => value.ok)).toHaveLength(217);
});
async function fixture() {
  await mkdir(resolve(".local/tmp"), { recursive: true });
  const root = await mkdtemp(resolve(".local/tmp/receipt-channel-"));
  owned.push(root);
  const repo = await ReceiptRepository.open(root);
  const row = transferReceipt();
  await repo.save(row);
  return { repo, row };
}
describe("worker to main durable receipt channel", () => {
  it("acknowledges only durable registered records and deduplicates the same request", async () => {
    const f = await fixture();
    const writes = vi.spyOn(f.repo, "save");
    const requests: ReceiptSave[] = [];
    const main = new MainReceiptChannel(
      f.row.backendEpoch,
      () => f.repo,
      () => true,
      (message) => worker.accept(message),
    );
    const worker = new WorkerReceiptWriter(f.row.backendEpoch, (message) => {
      if ((message as { type: string }).type === "receipt:save")
        requests.push(message as ReceiptSave);
      queueMicrotask(() => main.accept(message));
    });
    await worker.persist({ ...f.row, phase: "preparing", stage: "preparing" });
    expect(f.repo.snapshots()[0]?.phase).toBe("preparing");
    expect(writes).toHaveBeenCalledTimes(1);
    main.accept(requests[0]);
    await main.settled();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(worker.faulted).toBe(false);
    const replay = { ...requests[0]!, requestId: crypto.randomUUID() };
    main.accept(replay);
    await main.settled();
    expect(writes).toHaveBeenCalledTimes(1);
  });
  it("refuses unknown resources, changed task identity and mismatched generations without dispatch permission", async () => {
    for (const variation of ["unknown", "path", "generation"] as const) {
      const f = await fixture();
      const replies: ReceiptACK[] = [];
      const main = new MainReceiptChannel(
        f.row.backendEpoch,
        () => f.repo,
        () => true,
        (message) => replies.push(message as ReceiptACK),
      );
      const receipt =
        variation === "unknown"
          ? { ...transferReceipt(), backendEpoch: f.row.backendEpoch }
          : variation === "path"
            ? { ...f.row, destination: "/home/altered" }
            : f.row;
      main.accept({
        type: "receipt:save",
        requestId: crypto.randomUUID(),
        backendEpoch: f.row.backendEpoch,
        serverId: receipt.serverId,
        generation: variation === "generation" ? 2 : 1,
        sequence: 1,
        receipt,
      });
      await main.settled();
      expect(replies.at(-1)?.ok).toBe(false);
      expect(f.repo.faulted).toBe(true);
      expect(f.repo.snapshots()).toEqual([f.row]);
    }
  });
  it("does not accept a late ACK after5s fault or reuse sequence numbers after explicit verification reset", async () => {
    vi.useFakeTimers();
    const row = transferReceipt();
    const messages: unknown[] = [];
    const worker = new WorkerReceiptWriter(row.backendEpoch, (message) =>
      messages.push(message),
    );
    const pending = worker.persist(row);
    const rejected = expect(pending).rejects.toThrow("STORAGE_FAILED");
    expect(() => worker.resetAfterStorageVerification()).toThrow(
      "REQUEST_BUSY",
    );
    const first = messages[0] as ReceiptSave;
    await vi.advanceTimersByTimeAsync(5001);
    await rejected;
    worker.accept(ack(first));
    expect(worker.faulted).toBe(true);
    await expect(worker.persist(row)).rejects.toThrow("STORAGE_FAILED");
    worker.resetAfterStorageVerification();
    const next = worker.persist(row);
    const request = messages.at(-1) as ReceiptSave;
    expect(request.sequence).toBeGreaterThan(first.sequence);
    worker.accept({ ...ack(request), generation: 2 });
    worker.accept(ack(request));
    await next;
    expect(worker.faulted).toBe(false);
  });
  it("invalidates all pending permissions on one writer fault, even if another success ACK arrives later", async () => {
    const first = transferReceipt();
    const second = { ...transferReceipt(), backendEpoch: first.backendEpoch };
    const messages: unknown[] = [];
    const worker = new WorkerReceiptWriter(first.backendEpoch, (message) =>
      messages.push(message),
    );
    const one = worker.persist(first),
      two = worker.persist(second);
    const rejectedOne = expect(one).rejects.toThrow("STORAGE_FAILED"),
      rejectedTwo = expect(two).rejects.toThrow("STORAGE_FAILED");
    const requests = messages.slice() as ReceiptSave[];
    worker.accept(ack(requests[0]!, false));
    worker.accept(ack(requests[1]!));
    await Promise.all([rejectedOne, rejectedTwo]);
    expect(worker.faulted).toBe(true);
  });
  it("rejects oversized receipt and credential fields before sending a write request", async () => {
    for (const invalid of [
      { ...transferReceipt(), password: "fixture-only" },
      {
        ...transferReceipt(),
        source: "/" + "a".repeat(32700) + "/source",
        localParent: "/" + "a".repeat(32700),
      },
    ]) {
      const messages: unknown[] = [];
      const worker = new WorkerReceiptWriter(invalid.backendEpoch, (message) =>
        messages.push(message),
      );
      await expect(worker.persist(invalid)).rejects.toThrow("STORAGE_FAILED");
      expect(messages).toEqual([
        {
          type: "receipt:fault",
          backendEpoch: invalid.backendEpoch,
          errorCode: "STORAGE_FAILED",
        },
      ]);
    }
  });
  it("withholds permission if another storage fault occurs before the durable ACK is released", async () => {
    const f = await fixture();
    let healthy = true;
    const original = f.repo.save.bind(f.repo);
    vi.spyOn(f.repo, "save").mockImplementation(async (row) => {
      await original(row);
      healthy = false;
    });
    const replies: ReceiptACK[] = [];
    const main = new MainReceiptChannel(
      f.row.backendEpoch,
      () => f.repo,
      () => healthy,
      (message) => replies.push(message as ReceiptACK),
    );
    main.accept({
      type: "receipt:save",
      requestId: crypto.randomUUID(),
      backendEpoch: f.row.backendEpoch,
      serverId: f.row.serverId,
      generation: 1,
      sequence: 1,
      receipt: { ...f.row, phase: "preparing", stage: "preparing" },
    });
    await main.settled();
    expect(f.repo.snapshots()[0]?.phase).toBe("preparing");
    expect(replies.at(-1)?.ok).toBe(false);
    expect(f.repo.faulted).toBe(true);
  });
});
