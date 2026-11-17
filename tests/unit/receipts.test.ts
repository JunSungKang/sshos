import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { canonicalJSON } from "../../src/main/persistence/store";
import { resolve } from "node:path";
import {
  ReceiptRepository,
  recoverMutation,
} from "../../src/main/persistence/receipts";
import {
  mutationReceiptSchema,
  type MutationReceipt,
} from "../../src/shared/mutations";
import { fileReceiptSchema } from "../../src/shared/receipts";
import { executionReceipt } from "../fixtures/executions";
import { transferReceipt } from "../fixtures/transfers";
import { transferClaims } from "../../src/shared/file-policies/transfer-claims";
const owned: string[] = [];
async function directory() {
  const root = resolve(".local/tmp");
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(resolve(root, "receipts-"));
  owned.push(path);
  return path;
}
afterEach(async () => {
  for (const path of owned.splice(0)) await rm(path, { recursive: true });
});
export function receipt(): MutationReceipt {
  const now = new Date().toISOString();
  return {
    kind: "file_mutation",
    taskId: crypto.randomUUID(),
    serverId: crypto.randomUUID(),
    generation: 1,
    backendEpoch: crypto.randomUUID(),
    endpointSnapshot: {
      name: "fixture",
      host: "example.invalid",
      port: 22,
      username: "fixture",
      endpoint: "example.invalid:22",
    },
    hostKeyFingerprint: "SHA256:fixture",
    operation: "mkdir",
    source: null,
    destination: "/home/new",
    parent: "/home",
    sourceInitialStat: null,
    phase: "prepared",
    stage: "prepared",
    lastConfirmedPhase: "prepared",
    destinationCreated: false,
    sourceRemovalConfirmed: false,
    errorCode: null,
    recoveryUncertain: false,
    recoveredFromPhase: null,
    acknowledgedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
it("reopens5001 valid completed records and prunes them while preserving unresolved, live and backup-uncertain records", async () => {
  const dir = await directory();
  await ReceiptRepository.open(dir);
  const base = receipt(),
    now = Date.now() - 10000,
    ids: string[] = [];
  const write = async (row: unknown, backup = false) => {
    const payload = fileReceiptSchema.parse(row),
      raw = JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        payload,
        payloadSha256: createHash("sha256")
          .update(canonicalJSON(payload))
          .digest("hex"),
      });
    await writeFile(
      resolve(
        dir,
        "receipts",
        payload.taskId + ".json" + (backup ? ".bak" : ""),
      ),
      raw,
      { mode: 0o600 },
    );
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      while (next < 5001) {
        const index = next++,
          id = crypto.randomUUID();
        ids[index] = id;
        await write({
          ...base,
          taskId: id,
          phase: "completed",
          destinationCreated: true,
          createdAt: new Date(now + index).toISOString(),
        });
      }
    }),
  );
  const unknown = { ...receipt(), phase: "result_unknown" as const },
    cleanup = {
      ...transferReceipt(),
      phase: "failed" as const,
      tempCreated: true,
      cleanupState: "needed" as const,
    },
    live = {
      ...executionReceipt(),
      phase: "running" as const,
      channelAccepted: true,
    },
    backup = { ...receipt(), phase: "completed" as const };
  await Promise.all([
    write(unknown),
    write(cleanup),
    write(live),
    write(backup, true),
  ]);
  const opened = await ReceiptRepository.open(dir, {
    epoch: live.backendEpoch,
    executionIds: new Set([live.taskId]),
  });
  expect(opened.snapshots()).toHaveLength(1004);
  expect(opened.get(ids[0]!)).toBeUndefined();
  expect(opened.get(ids[5000]!)).toMatchObject({ phase: "completed" });
  expect(opened.get(unknown.taskId)?.phase).toBe("result_unknown");
  expect(opened.get(cleanup.taskId)).toMatchObject({
    phase: "failed",
    cleanupState: "needed",
  });
  expect(opened.get(live.taskId)?.phase).toBe("running");
  expect(opened.get(backup.taskId)).toMatchObject({
    phase: "result_unknown",
    recoveryUncertain: true,
  });
  expect(opened.damagedIds()).toEqual([]);
  expect(
    (await readdir(resolve(dir, "receipts"))).filter((name) =>
      name.endsWith(".json"),
    ),
  ).toHaveLength(1004);
  expect(() =>
    opened.checkNew(unknown.serverId, [
      { path: unknown.destination!, mode: "write" },
    ]),
  ).toThrow("RESULT_UNKNOWN");
}, 30000);
it("stores strict receipts without credential, input or output payloads", async () => {
  const dir = await directory();
  const repo = await ReceiptRepository.open(dir);
  const row = receipt();
  await repo.save(row);
  expect(repo.snapshots()).toEqual([row]);
  expect(
    mutationReceiptSchema.safeParse({ ...row, password: "sentinel" }).success,
  ).toBe(false);
  expect(
    mutationReceiptSchema.safeParse({ ...row, argv: ["secret"] }).success,
  ).toBe(false);
});
it("recovers dispatch conservatively and keeps unknown result after user acknowledgement", async () => {
  const dir = await directory();
  const repo = await ReceiptRepository.open(dir);
  const row = {
    ...receipt(),
    phase: "dispatched" as const,
    stage: "operation_intent",
  };
  await repo.save(row);
  const restored = await ReceiptRepository.open(dir);
  expect(restored.snapshots()[0]?.phase).toBe("result_unknown");
  expect(() =>
    restored.checkNew(row.serverId, [{ path: "/home/new", mode: "write" }]),
  ).toThrow("RESULT_UNKNOWN");
  await expect(restored.forget(row.taskId)).rejects.toThrow("INPUT_INVALID");
  await restored.acknowledge(row.taskId);
  expect(restored.snapshots()[0]?.phase).toBe("result_unknown");
  expect(() =>
    restored.checkNew(row.serverId, [{ path: "/home/new", mode: "write" }]),
  ).not.toThrow();
});
it("marks backup terminal state uncertain and never promotes it to current success", async () => {
  const dir = await directory();
  const repo = await ReceiptRepository.open(dir);
  const row = {
    ...receipt(),
    phase: "completed" as const,
    destinationCreated: true,
  };
  await repo.save(row);
  await repo.save({
    ...row,
    updatedAt: new Date(Date.now() + 100).toISOString(),
  });
  await writeFile(resolve(dir, "receipts", row.taskId + ".json"), "{broken");
  const restored = await ReceiptRepository.open(dir);
  expect(restored.snapshots()[0]?.phase).toBe("result_unknown");
  expect(restored.snapshots()[0]?.recoveryUncertain).toBe(true);
  expect(restored.snapshots()[0]?.destinationCreated).toBe(true);
  expect(
    recoverMutation({ ...receipt(), phase: "prepared" }, false).phase,
  ).toBe("failed");
});
it("keeps a corrupt record isolated and removes only explicitly selected local receipt files", async () => {
  const dir = await directory();
  const repo = await ReceiptRepository.open(dir);
  const good = { ...receipt(), phase: "completed" as const };
  await repo.save(good);
  const bad = crypto.randomUUID();
  await writeFile(resolve(dir, "receipts", bad + ".json"), "{broken");
  const restored = await ReceiptRepository.open(dir);
  expect(restored.damagedIds()).toEqual([bad]);
  expect(restored.snapshots()).toHaveLength(1);
  await restored.forget(bad);
  expect(restored.snapshots()[0]?.taskId).toBe(good.taskId);
  expect(
    await readFile(resolve(dir, "receipts", good.taskId + ".json"), "utf8"),
  ).toContain(good.taskId);
});
it("recovers transfer dispatch, preserves unknown on repeated open and retains cleanup records until acknowledgement", async () => {
  const dir = await directory();
  const repo = await ReceiptRepository.open(dir);
  const row = {
    ...transferReceipt(),
    phase: "finalizing" as const,
    stage: "final_link_intent",
    dispatchAllowed: true,
    tempCreated: true,
    cleanupState: "needed" as const,
  };
  await repo.save(row);
  const restored = await ReceiptRepository.open(dir);
  expect(restored.snapshots()[0]).toMatchObject({
    kind: "file_transfer",
    phase: "result_unknown",
    recoveredFromPhase: "finalizing",
  });
  const reopened = await ReceiptRepository.open(dir);
  expect(reopened.snapshots()[0]?.recoveredFromPhase).toBe("finalizing");
  await reopened.acknowledge(row.taskId);
  expect(reopened.snapshots()[0]?.phase).toBe("result_unknown");
  const completed = {
    ...transferReceipt("download"),
    phase: "completed" as const,
    stage: "completed",
    destinationCreated: true,
    tempCreated: true,
    cleanupState: "unknown" as const,
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  await reopened.save(completed);
  const latest = await ReceiptRepository.open(dir);
  expect(
    latest.snapshots().find((item) => item.taskId === completed.taskId)?.phase,
  ).toBe("completed");
  await expect(latest.forget(completed.taskId)).rejects.toThrow(
    "INPUT_INVALID",
  );
  const claims = transferClaims(completed);
  expect(() => latest.checkNew(crypto.randomUUID(), [], claims.local)).toThrow(
    "RESULT_UNKNOWN",
  );
  await latest.acknowledge(completed.taskId);
  await latest.forget(completed.taskId);
});
it("rejects mutable transfer identity, credentials and in-memory finalization state before writing", async () => {
  const dir = await directory();
  const repo = await ReceiptRepository.open(dir);
  const row = transferReceipt();
  await repo.save(row);
  await expect(
    repo.save({ ...row, destination: "/home/different" }),
  ).rejects.toThrow("INPUT_INVALID");
  await expect(
    repo.save({ ...row, phase: "finalize_intent_pending" }),
  ).rejects.toThrow("INPUT_INVALID");
  expect(repo.faulted).toBe(false);
  expect(
    fileReceiptSchema.safeParse({ ...row, password: "fixture-only" }).success,
  ).toBe(false);
  expect(
    fileReceiptSchema.safeParse({ ...row, tempPath: "/another/temp" }).success,
  ).toBe(false);
  expect(repo.snapshots()[0]?.destination).toBe(row.destination);
  await repo.save({ ...row, phase: "failed", stage: "failed" });
  await expect(repo.save(row)).rejects.toThrow("INPUT_INVALID");
});
it("requires a new acknowledgement for the uncertainty introduced by backup recovery", () => {
  const row = {
    ...receipt(),
    phase: "completed" as const,
    acknowledgedAt: new Date().toISOString(),
  };
  expect(recoverMutation(row, true)).toMatchObject({
    phase: "result_unknown",
    acknowledgedAt: null,
  });
});

it("persists four distinct operation kinds and recovers execution without argv or automatic replay", async () => {
  const dir = await directory(),
    repo = await ReceiptRepository.open(dir),
    record = executionReceipt();
  await repo.save({ ...record, phase: "running", channelAccepted: true });
  await expect(
    repo.save({ ...record, source: "/another/program" }),
  ).rejects.toThrow("INPUT_INVALID");
  const ptyId = crypto.randomUUID();
  const pty = {
    ...executionReceipt(),
    kind: "pty" as const,
    taskId: ptyId,
    executionId: null,
    terminalId: ptyId,
    source: null,
    cwd: null,
  };
  await repo.save(pty);
  const reopened = await ReceiptRepository.open(dir);
  expect(reopened.get(record.taskId)).toMatchObject({
    phase: "result_unknown",
    recoveredFromPhase: "running",
  });
  expect(reopened.get(ptyId)?.phase).toBe("cancelled_not_sent");
  expect(() =>
    reopened.checkNew(record.serverId, [
      { path: record.source!, mode: "write" },
    ]),
  ).not.toThrow();
  await reopened.acknowledge(record.taskId);
  expect(reopened.get(record.taskId)?.phase).toBe("result_unknown");
  const payload = await readFile(
    resolve(dir, "receipts", record.taskId + ".json"),
    "utf8",
  );
  for (const key of ["argv", "stdin", "stdout", "stderr", "commandHash"])
    expect(payload).not.toContain('"' + key + '"');
});

it("preserves live execution phases only for the exact same worker epoch and known resource on explicit storage retry", async () => {
  const dir = await directory(),
    repo = await ReceiptRepository.open(dir),
    row = {
      ...executionReceipt(),
      phase: "running" as const,
      channelAccepted: true,
    };
  await repo.save(row);
  const continuity = {
    epoch: row.backendEpoch,
    executionIds: new Set([row.taskId]),
  };
  const live = await ReceiptRepository.open(dir, continuity);
  expect(live.get(row.taskId)?.phase).toBe("running");
  await live.save({
    ...row,
    phase: "exited",
    exitObserved: true,
    exitCode: 7,
    channelClosed: true,
  });
  const other = {
    ...executionReceipt(),
    phase: "running" as const,
    channelAccepted: true,
  };
  await live.save(other);
  const foreign = await ReceiptRepository.open(dir, {
    epoch: crypto.randomUUID(),
    executionIds: new Set([other.taskId]),
  });
  expect(foreign.get(other.taskId)?.phase).toBe("result_unknown");
});
it("never lets same-worker continuity override backup uncertainty or prune a live-owned historical record", async () => {
  const dir = await directory(),
    repo = await ReceiptRepository.open(dir),
    row = {
      ...executionReceipt(),
      phase: "running" as const,
      channelAccepted: true,
    };
  await repo.save(row);
  await repo.save({
    ...row,
    updatedAt: new Date(Date.now() + 100).toISOString(),
  });
  await writeFile(resolve(dir, "receipts", row.taskId + ".json"), "{broken");
  const restored = await ReceiptRepository.open(dir, {
    epoch: row.backendEpoch,
    executionIds: new Set([row.taskId]),
  });
  expect(restored.get(row.taskId)).toMatchObject({
    phase: "result_unknown",
    recoveryUncertain: true,
    acknowledgedAt: null,
  });
  const historic = {
    ...executionReceipt(),
    phase: "exited" as const,
    channelAccepted: true,
    channelClosed: true,
    exitObserved: true,
    exitCode: 0,
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  await restored.save(historic);
  const retained = await ReceiptRepository.open(dir, {
    epoch: historic.backendEpoch,
    executionIds: new Set([historic.taskId]),
  });
  expect(retained.get(historic.taskId)?.phase).toBe("exited");
});

it("invalidates cached unresolved claims after every durable save, acknowledgement and deletion", async () => {
  const dir = await directory(),
    repo = await ReceiptRepository.open(dir),
    row = receipt();
  expect(() =>
    repo.checkNew(row.serverId, [{ path: row.destination!, mode: "write" }]),
  ).not.toThrow();
  await repo.save({
    ...row,
    phase: "result_unknown",
    errorCode: "RESULT_UNKNOWN",
  });
  for (let i = 0; i < 3; i++)
    expect(() =>
      repo.checkNew(row.serverId, [{ path: row.destination!, mode: "write" }]),
    ).toThrow("RESULT_UNKNOWN");
  await repo.acknowledge(row.taskId);
  expect(() =>
    repo.checkNew(row.serverId, [{ path: row.destination!, mode: "write" }]),
  ).not.toThrow();
  await repo.forget(row.taskId);
  expect(() =>
    repo.checkNew(row.serverId, [{ path: row.destination!, mode: "write" }]),
  ).not.toThrow();
  const next = {
    ...receipt(),
    serverId: row.serverId,
    destination: row.destination,
    phase: "result_unknown" as const,
  };
  await repo.save(next);
  expect(() =>
    repo.checkNew(row.serverId, [{ path: row.destination!, mode: "write" }]),
  ).toThrow("RESULT_UNKNOWN");
  repo.markFault();
  expect(() => repo.checkNew(row.serverId, [])).toThrow("STORAGE_FAILED");
});
