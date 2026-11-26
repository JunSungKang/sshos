import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  open,
  realpath,
  rm,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  relayReceiptSchema,
  relayUnresolved,
  recoverRelay,
  type RelayReceipt,
} from "../../src/shared/relay";
import { fileReceiptSchema, type FileReceipt } from "../../src/shared/receipts";
import { ReceiptRepository } from "../../src/main/persistence/receipts";
import { canonicalJSON } from "../../src/main/persistence/store";
import { verifyRelayDigest } from "../../src/main/transfers/relay-digest";
import { fileStat } from "../../src/platform/local-files/selection";
import { transferReceipt } from "../fixtures/transfers";

const owned: string[] = [],
  sha = (data: Buffer | string) =>
    createHash("sha256").update(data).digest("hex");
async function directory() {
  const base = await realpath(resolve(".local/tmp"));
  if (!base.startsWith((await realpath(".")) + sep))
    throw Error("Invalid fixture directory");
  const dir = await mkdtemp(join(base, "relay-evidence-"));
  owned.push(dir);
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of owned.splice(0))
    await rm(dir, { recursive: true, force: true });
});
function pair(dir: string) {
  const a = transferReceipt("download"),
    b = transferReceipt("upload");
  const taskId = crypto.randomUUID(),
    digest = sha("abc");
  const origin = {
    ...a.endpointSnapshot,
    serverId: a.serverId,
    generation: 1,
    hostKeyFingerprint: a.hostKeyFingerprint,
    path: a.source,
  };
  const target = {
    ...b.endpointSnapshot,
    serverId: b.serverId,
    generation: 2,
    hostKeyFingerprint: "SHA256:target",
    path: b.destination,
  };
  const stageArea = {
    jobId: taskId,
    root: { path: dir, identity: "1:1" },
    directory: { path: join(dir, "stage"), identity: "1:2" },
    volumeId: "local-disk",
    filePath: join(dir, "stage", "payload"),
  };
  const parent: RelayReceipt = {
    kind: "server_relay",
    taskId,
    backendEpoch: a.backendEpoch,
    serverId: origin.serverId,
    generation: origin.generation,
    endpointSnapshot: a.endpointSnapshot,
    hostKeyFingerprint: a.hostKeyFingerprint,
    source: origin.path,
    destination: target.path,
    origin,
    target,
    size: a.totalBytes,
    sourceStat: a.sourceInitialStat,
    legIds: [a.taskId, b.taskId],
    downloadId: a.taskId,
    uploadId: b.taskId,
    stageArea,
    stageStat: b.sourceInitialStat,
    digest,
    phase: "sending",
    lastConfirmedPhase: "local_verified",
    publication: "none",
    localCleanup: "needed",
    remoteCleanup: "none",
    failureLocation: null,
    errorCode: null,
    acknowledgedAt: null,
    recoveryUncertain: false,
    recoveredFromPhase: null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
  const upload = {
    ...b,
    backendEpoch: a.backendEpoch,
    relayParentId: taskId,
    source: stageArea.filePath,
    localParent: stageArea.directory.path,
    generation: target.generation,
    hostKeyFingerprint: target.hostKeyFingerprint,
  };
  const download = {
    ...a,
    relayParentId: taskId,
    destination: stageArea.filePath,
    localParent: stageArea.directory.path,
    tempPath: join(stageArea.directory.path, `.sshos-${a.taskId}.part`),
  };
  const completed = {
    ...upload,
    phase: "completed" as const,
    dispatchAllowed: true,
    destinationCreated: true,
    tempCreated: true,
    streamSha256: digest,
    transferredBytes: 3,
    verifiedBytes: 3,
    lastConfirmedPhase: "temp_removed",
    cleanupState: "confirmed" as const,
  };
  return { parent, download, upload, completed };
}
async function record(dir: string, row: FileReceipt, backup = false) {
  const payload = fileReceiptSchema.parse(row);
  await writeFile(
    join(dir, "receipts", row.taskId + (backup ? ".json.bak" : ".json")),
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      payload,
      payloadSha256: sha(canonicalJSON(payload)),
    }),
  );
}

describe("relay admission and recovery evidence", () => {
  it("rejects contradictory parent identities, unrelated attempt IDs and inconsistent verified state", () => {
    const { parent } = pair("/stage");
    expect(relayReceiptSchema.safeParse(parent).success).toBe(true);
    for (const invalid of [
      { stageArea: { ...parent.stageArea, jobId: crypto.randomUUID() } },
      { size: 99 },
      { source: "/other" },
      { destination: "/other" },
      { serverId: crypto.randomUUID() },
      { generation: 20 },
      { hostKeyFingerprint: "other" },
      ...(["host", "endpoint", "username", "port"] as const).map((field) => ({
        endpointSnapshot: {
          ...parent.endpointSnapshot,
          [field]: field === "port" ? 2222 : "other",
        },
      })),
      { target: { ...parent.target, serverId: parent.origin.serverId } },
      { downloadId: parent.uploadId },
      { taskId: parent.downloadId, stageArea: null },
      { downloadId: crypto.randomUUID() },
      { uploadId: crypto.randomUUID() },
      { legIds: [...parent.legIds, parent.downloadId] },
      { stageStat: { ...parent.stageStat, size: 0 } },
      { stageStat: { ...parent.stageStat, identity: "" } },
      { phase: "completed" },
      { phase: "completed", publication: "confirmed", digest: null },
    ])
      expect(
        relayReceiptSchema.safeParse({ ...parent, ...invalid }).success,
      ).toBe(false);
    expect(
      relayReceiptSchema.safeParse({
        ...parent,
        phase: "completed",
        publication: "confirmed",
      }).success,
    ).toBe(true);
  });
  it("keeps a recorded stage unresolved after acknowledgement and treats a backup as uncertain", () => {
    const { parent } = pair("/stage");
    const clean = {
      ...parent,
      phase: "failed" as const,
      stageArea: null,
      stageStat: null,
      localCleanup: "confirmed" as const,
    };
    expect(recoverRelay(clean, false)).toBe(clean);
    expect(recoverRelay(clean, true)).toMatchObject({
      phase: "result_unknown",
      publication: "unknown",
      recoveryUncertain: true,
    });
    expect(recoverRelay({ ...parent, uploadId: null }, false)).toMatchObject({
      phase: "interrupted",
      publication: "none",
    });
    expect(relayUnresolved(clean)).toBe(false);
    expect(
      relayUnresolved({
        ...clean,
        stageArea: parent.stageArea,
        acknowledgedAt: clean.updatedAt,
      }),
    ).toBe(true);
    for (const options of [
      { localCleanup: "unknown" as const },
      { remoteCleanup: "needed" as const },
      { remoteCleanup: "unknown" as const },
      { phase: "result_unknown" as const },
    ]) {
      expect(relayUnresolved({ ...clean, ...options })).toBe(true);
      expect(
        relayUnresolved({
          ...clean,
          ...options,
          acknowledgedAt: clean.updatedAt,
        }),
      ).toBe(false);
    }
  });
  it("validates each new child against the accepted role, identity, path and source observation before writing", async () => {
    const dir = await directory(),
      repo = await ReceiptRepository.open(dir);
    const { parent, upload, download } = pair(dir);
    await expect(repo.save(download)).rejects.toThrow("INPUT_INVALID");
    await repo.save(parent);
    for (const patch of [
      { relayParentId: crypto.randomUUID() },
      { taskId: crypto.randomUUID() },
      { backendEpoch: crypto.randomUUID() },
      { generation: 99 },
      { serverId: parent.origin.serverId },
      { hostKeyFingerprint: "other" },
      ...(["host", "endpoint", "username", "port"] as const).map((field) => ({
        endpointSnapshot: {
          ...upload.endpointSnapshot,
          [field]: field === "port" ? 2222 : "other",
        },
      })),
      { destination: "/home/other" },
      { localParent: dir },
      { source: "other" },
      {
        totalBytes: 4,
        sourceInitialStat: { ...upload.sourceInitialStat, size: 4 },
      },
      {
        sourceInitialStat: {
          ...upload.sourceInitialStat,
          identity: "different",
        },
      },
      { sourceInitialStat: { ...upload.sourceInitialStat, mtime: "2" } },
    ])
      await expect(repo.save({ ...upload, ...patch })).rejects.toThrow();
    expect(repo.faulted).toBe(false);
    await repo.save(download);
    await repo.save(upload);
    await expect(repo.forget(download.taskId)).rejects.toThrow("REQUEST_BUSY");
    await expect(
      repo.save({
        ...parent,
        legIds: [parent.downloadId],
        uploadId: null,
        digest: "f".repeat(64),
      }),
    ).rejects.toThrow("INPUT_INVALID");
    await expect(
      repo.save({
        ...parent,
        target: { ...parent.target, username: "another-account" },
      }),
    ).rejects.toThrow("INPUT_INVALID");
    const replaced = crypto.randomUUID();
    await repo.save({
      ...parent,
      legIds: [...parent.legIds, replaced],
      uploadId: replaced,
    });
    await expect(
      repo.save({ ...parent, legIds: [...parent.legIds, replaced] }),
    ).rejects.toThrow("INPUT_INVALID");
    expect(repo.faulted).toBe(false);
  });
  it("reconciles only current publication proof and distinguishes durable pre-publication failure from uncertainty", async () => {
    const dir = await directory();
    await ReceiptRepository.open(dir);
    const cases = [
      ["completed", {}],
      [
        "interrupted",
        { phase: "failed", dispatchAllowed: false, destinationCreated: false },
      ],
      ["result_unknown", { generation: 11 }],
      ["result_unknown", { hostKeyFingerprint: "another" }],
      ["result_unknown", { dispatchAllowed: false }],
      ["result_unknown", { streamSha256: "0".repeat(64) }],
      ["result_unknown", { verifiedBytes: 0 }],
      ["result_unknown", { transferredBytes: 0 }],
      ["result_unknown", { recoveryUncertain: true }],
      ["result_unknown", { destinationCreated: false }],
    ] as const;
    const parents: string[] = [];
    for (const [, overrides] of cases) {
      const { parent, completed } = pair(dir);
      await record(dir, parent);
      await record(dir, { ...completed, ...overrides });
      parents.push(parent.taskId);
    }
    const repo = await ReceiptRepository.open(dir);
    cases.forEach(([phase], i) =>
      expect(repo.get(parents[i]!)).toMatchObject({
        phase,
        publication:
          phase === "completed"
            ? "confirmed"
            : phase === "interrupted"
              ? "none"
              : "unknown",
      }),
    );
    expect(repo.damagedIds()).toEqual([]);
  });
  it("reserves admission space for both legs and allows only the accepted parent to consume its promised capacity", async () => {
    const dir = await directory(),
      repo = await ReceiptRepository.open(dir),
      rows = Array.from({ length: 33 }, () => pair(dir));
    for (const row of rows) {
      repo.checkRelayAdmission();
      await repo.save(row.parent);
    }
    const { parent, download } = rows[0]!;
    await repo.save({ ...download, phase: "result_unknown" });
    expect(() => repo.checkRelayAdmission()).toThrow("UNRESOLVED_LIMIT");
    // Ninety-nine evidence slots are now committed, including the unstarted legs.
    repo.checkNew("unrelated", []);
    await repo.save({ ...transferReceipt("upload"), phase: "result_unknown" });
    expect(() => repo.checkNew("unrelated", [])).toThrow("UNRESOLVED_LIMIT");
    expect(() =>
      repo.checkNew("unrelated", [], [], crypto.randomUUID()),
    ).toThrow("UNRESOLVED_LIMIT");
    repo.checkNew(parent.target.serverId, [], [], parent.taskId);
    await repo.settled();
    expect(repo.revision).toBe(35);
  });
  it("blocks conflicting operations on B while the parent is unknown and retains immutable child evidence", async () => {
    const dir = await directory(),
      repo = await ReceiptRepository.open(dir),
      { parent, download } = pair(dir);
    await repo.save({
      ...parent,
      phase: "result_unknown",
      publication: "unknown",
    });
    expect(() =>
      repo.checkNew(parent.target.serverId, [
        { path: parent.destination, mode: "write" },
      ]),
    ).toThrow("RESULT_UNKNOWN");
    repo.checkNew(parent.origin.serverId, [
      { path: parent.destination, mode: "write" },
    ]);
    await repo.acknowledge(parent.taskId);
    repo.checkNew(parent.target.serverId, [
      { path: parent.destination, mode: "write" },
    ]);
    // A fresh independent fixture makes the local inode and digest immutable after observation.
    const original = pair(dir);
    await repo.save(original.parent);
    const child = {
      ...original.download,
      localTempIdentity: "first-inode",
      streamSha256: sha("abc"),
    };
    await repo.save(child);
    await expect(
      repo.save({ ...child, localTempIdentity: "second-inode" }),
    ).rejects.toThrow("INPUT_INVALID");
    await expect(
      repo.save({ ...child, streamSha256: sha("changed") }),
    ).rejects.toThrow("INPUT_INVALID");
    await expect(repo.acknowledge(download.taskId)).rejects.toThrow(
      "INPUT_INVALID",
    );
  });
  it("preserves older evidence despite an incomplete backup's leg list and a damaged parent", async () => {
    const dir = await directory(),
      { parent, completed } = pair(dir),
      old = new Date(Date.now() - 40 * 86400000).toISOString();
    await ReceiptRepository.open(dir);
    const backup = {
      ...parent,
      phase: "waiting_to_send" as const,
      legIds: [parent.downloadId],
      uploadId: null,
    };
    await record(dir, backup, true);
    await record(dir, { ...completed, updatedAt: old });
    let repo = await ReceiptRepository.open(dir);
    expect(repo.get(parent.taskId)).toMatchObject({
      phase: "result_unknown",
      recoveryUncertain: true,
    });
    expect(repo.get(completed.taskId)).toBeDefined();
    await expect(repo.forget(completed.taskId)).rejects.toThrow("REQUEST_BUSY");
    await writeFile(
      join(dir, "receipts", parent.taskId + ".json"),
      "unreadable",
    );
    await unlink(join(dir, "receipts", parent.taskId + ".json.bak")).catch(
      () => {},
    );
    repo = await ReceiptRepository.open(dir);
    expect(repo.damagedIds()).toContain(parent.taskId);
    await expect(repo.forget(parent.taskId)).rejects.toThrow("REQUEST_BUSY");
    await expect(repo.forget(completed.taskId)).rejects.toThrow("REQUEST_BUSY");
    expect(repo.get(completed.taskId)).toBeDefined();
  });
  it("serializes eligibility and deletion when two consumers forget the same resolved record", async () => {
    const dir = await directory(),
      repo = await ReceiptRepository.open(dir),
      { parent } = pair(dir);
    await repo.save({
      ...parent,
      phase: "failed",
      stageArea: null,
      stageStat: null,
      localCleanup: "confirmed",
    });
    const results = await Promise.allSettled([
      repo.forget(parent.taskId),
      repo.forget(parent.taskId),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: new Error("INPUT_INVALID"),
    });
    expect(repo.get(parent.taskId)).toBeUndefined();
  });
});

describe("verified relay stage digest", () => {
  it("verifies empty and multi-chunk sparse files, bounds identity checks and rejects a different digest", async () => {
    const path = join(await directory(), "payload"),
      handle = await open(path, "wx");
    try {
      const empty = fileStat(await handle.stat({ bigint: true }));
      await verifyRelayDigest(path, empty, sha(""));
      await handle.truncate(140000);
      const expected = fileStat(await handle.stat({ bigint: true }));
      await verifyRelayDigest(path, expected, sha(Buffer.alloc(expected.size)));
      for (const change of [{ size: 0 }, { identity: "wrong" }, { mtime: "0" }])
        await expect(
          verifyRelayDigest(path, { ...expected, ...change }, sha("")),
        ).rejects.toThrow("SOURCE_CHANGED");
      await expect(
        verifyRelayDigest(path, expected, sha("other")),
      ).rejects.toThrow("VERIFY_MISMATCH");
    } finally {
      await handle.close();
    }
  });
  it("rejects real EOF and a final size change on the open staged inode without approving a partial hash", async () => {
    const path = join(await directory(), "payload"),
      own = await open(path, "wx");
    try {
      for (const extended of [false, true]) {
        await own.truncate(extended ? 11 : 160000);
        const original = fileStat(await lstat(path, { bigint: true })),
          digest = sha(Buffer.alloc(original.size));
        const proto = Object.getPrototypeOf(own),
          read = proto.read;
        vi.spyOn(proto, "read").mockImplementationOnce(async function (
          this: unknown,
          ...args: unknown[]
        ) {
          const chunk = await Reflect.apply(read, this, args);
          await truncate(path, extended ? 12 : 0);
          return chunk;
        });
        await expect(verifyRelayDigest(path, original, digest)).rejects.toThrow(
          "SOURCE_CHANGED",
        );
        vi.restoreAllMocks();
      }
    } finally {
      await own.close();
    }
  });
});
