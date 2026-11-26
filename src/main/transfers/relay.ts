import { verifyRelayDigest } from "./relay-digest";
import { randomUUID } from "node:crypto";
import { join, posix } from "node:path";
import { z } from "zod";
import { remotePathSchema, validName } from "../../shared/files";
import { errorCodeOf } from "../../shared/errors";
import {
  currentRelayLeg,
  relayReceiptSchema,
  relayTerminal,
  relayUnresolved,
  type RelayEndpoint,
  type RelayPreview,
  type RelayReceipt,
  type RelayView,
} from "../../shared/relay";
import {
  transferStatSchema,
  type TransferStat,
  type TransferReceipt,
} from "../../shared/transfers";
import { receiptUnresolved } from "../../shared/receipts";
import {
  stagedTransferSchema,
  type TransferRuntime,
} from "../../shared/transfer-protocol";
import {
  RelayStageCreationError,
  type RelayStaging,
} from "../../platform/local-files/relay-staging";
import type { FileController } from "../file-operations/files";
import type { ConnectionController } from "../connections/connections";
import type { ReceiptRepository } from "../persistence/receipts";
import type { EngineGateway } from "../engine-gateway";
import type { TransferController } from "./transfers";

const nameSchema = z.string().refine(validName);
const destinationInput = {
  destinationSessionToken: z.uuid(),
  directory: remotePathSchema,
  name: nameSchema.optional(),
};
const firstPreview = z
  .object({ ...destinationInput, entryToken: z.uuid() })
  .strict();
const retryPreview = z
  .object({ ...destinationInput, parentId: z.uuid() })
  .strict();
const remoteCapacity = z
  .object({
    capacity: z.enum(["known", "unknown"]),
    availableBytes: z
      .string()
      .regex(/^\d{1,39}$/)
      .nullable(),
    errorCode: z
      .string()
      .regex(/^[A-Z_]{1,64}$/)
      .nullable()
      .optional(),
  })
  .strict();
const diskErrors = new Set([
  "LOCAL_DISK_FULL",
  "LOCAL_SPACE_UNKNOWN",
  "LOCAL_QUOTA_EXCEEDED",
]);
type Dependencies = {
  files: FileController;
  connections: ConnectionController;
  gateway: EngineGateway;
  repository: () => ReceiptRepository | null;
  healthy: () => boolean;
  staging: RelayStaging;
  transfers: TransferController;
};
type Intent = {
  view: RelayPreview;
  stat: TransferStat;
  epoch: string;
  expires: number;
  oldId: string | null;
  revision: number;
  sourceToken: string | null;
  entryToken: string | null;
};
const ts = () => new Date().toISOString();
const snapshot = (e: RelayEndpoint) => ({
  name: e.name,
  host: e.host,
  port: e.port,
  username: e.username,
  endpoint: e.endpoint,
});
const isSameAccount = (a: RelayEndpoint, b: RelayEndpoint) =>
  a.serverId === b.serverId &&
  a.host === b.host &&
  a.port === b.port &&
  a.username === b.username &&
  a.hostKeyFingerprint === b.hostKeyFingerprint;
function leg(
  row: RelayReceipt,
  dir: "upload" | "download",
  stat: TransferStat,
) {
  const area = row.stageArea,
    id = dir === "upload" ? row.uploadId : row.downloadId,
    e = dir === "upload" ? row.target : row.origin;
  if (!area || !id || (dir === "upload" && !row.digest))
    throw Error("INPUT_INVALID");
  const now = ts(),
    parent = posix.dirname(e.path);
  return stagedTransferSchema.parse({
    localDirectory: area.directory,
    relay: {
      parentId: row.taskId,
      ...(dir === "upload" ? { expectedSha256: row.digest } : {}),
    },
    row: {
      kind: "file_transfer",
      taskId: id,
      relayParentId: row.taskId,
      serverId: e.serverId,
      generation: e.generation,
      backendEpoch: row.backendEpoch,
      endpointSnapshot: snapshot(e),
      hostKeyFingerprint: e.hostKeyFingerprint,
      direction: dir,
      source: dir === "download" ? e.path : area.filePath,
      destination: dir === "upload" ? e.path : area.filePath,
      tempPath:
        dir === "upload"
          ? posix.join(parent, `.sshos-${id}.part`)
          : join(area.directory.path, `.sshos-${id}.part`),
      remoteParent: parent,
      localParent: area.directory.path,
      sourceInitialStat: stat,
      totalBytes: stat.size,
      transferredBytes: 0,
      verifiedBytes: 0,
      streamSha256: null,
      phase: "queued",
      stage: "queued",
      cleanupState: "none",
      tempCreated: false,
      destinationCreated: false,
      dispatchAllowed: false,
      lastConfirmedPhase: "queued",
      errorCode: null,
      lateObservations: [],
      recoveryUncertain: false,
      recoveredFromPhase: null,
      acknowledgedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  });
}
/** The main-process single writer is the sole owner of the parent's checkpoints. */
export class RelayController {
  private intents = new Map<string, Intent>();
  private tail: Promise<void> = Promise.resolve();
  private held = new Map<string, { endpoint: RelayEndpoint; epoch: string }>();
  private unrecordedStages = new Map<
    string,
    NonNullable<RelayReceipt["stageArea"]>
  >();
  private previewGeneration = 0;
  private historyCache: {
    repo: ReceiptRepository;
    version: number;
    parents: RelayReceipt[];
    children: Map<string, TransferReceipt>;
  } | null = null;
  private unconfirmedHolds = new Map<
    string,
    { endpoint: RelayEndpoint; epoch: string }
  >();
  private live = new Set<string>();
  private inflight = new Set<string>();
  private failedStorage = new Set<string>();
  constructor(private d: Dependencies) {
    d.transfers.onRelaySettled((child, runtime) => {
      const parentId = child.relayParentId;
      if (!parentId || !this.live.has(parentId)) return;
      void this.serial(() =>
        this.finished(parentId, child.taskId, runtime),
      ).catch(() => this.failedStorage.add(parentId));
    });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(work);
    this.tail = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
  async settled() {
    await this.tail;
  }
  invalidateRenderer() {
    this.previewGeneration++;
    this.intents.clear();
  }
  private repo() {
    const repo = this.d.repository();
    if (!repo || repo.faulted || !this.d.healthy())
      throw Error("STORAGE_FAILED");
    return repo;
  }
  private get(id: string) {
    const row = this.repo().get(id);
    if (row?.kind !== "server_relay") throw Error("TOKEN_EXPIRED");
    return row;
  }
  private endpoints(token: string, path: string): RelayEndpoint {
    const cap = this.d.connections.sessionCapability(token),
      current = this.d.connections
        .views()
        .find(
          (s) => s.serverId === cap.serverId && s.generation === cap.generation,
        );
    if (
      !current ||
      current.status !== "connected" ||
      current.sftp !== "available"
    )
      throw Error("SFTP_UNAVAILABLE");
    if (
      current.os !== "supported" &&
      !(current.os === "unknown" && current.osConfirmed)
    )
      throw Error(current.os === "unknown" ? "OS_UNKNOWN" : "OS_UNSUPPORTED");
    const identity = this.d.connections.sessionIdentity(
      cap.serverId,
      cap.generation,
    );
    return {
      ...identity.endpointSnapshot,
      ...cap,
      hostKeyFingerprint: identity.hostKeyFingerprint,
      path,
    };
  }
  private token(e: RelayEndpoint, newGeneration = false): string {
    const token = this.d.connections
      .views()
      .find((v) => v.serverId === e.serverId)?.sessionToken;
    if (!token) throw Error("SESSION_UNAVAILABLE");
    const current = this.endpoints(token, e.path);
    if (
      !isSameAccount(e, current) ||
      (!newGeneration && e.generation !== current.generation)
    )
      throw Error("TOKEN_EXPIRED");
    return token;
  }
  private async sourceStat(e: RelayEndpoint): Promise<TransferStat> {
    return transferStatSchema.parse(
      await this.d.gateway.request({
        action: "transfer:inspect",
        serverId: e.serverId,
        generation: e.generation,
        direction: "download",
        path: e.path,
        parent: posix.dirname(e.path),
      }),
    );
  }
  private async capacity(
    e: RelayEndpoint,
    size: number,
    preview?: RelayPreview,
  ) {
    const observation = remoteCapacity.parse(
      await this.d.gateway.request({
        action: "relay:inspectDestination",
        serverId: e.serverId,
        generation: e.generation,
        path: e.path,
        parent: posix.dirname(e.path),
        size,
      }),
    );
    if (preview) preview.remoteAvailableBytes = observation.availableBytes;
    if (observation.errorCode) throw Error(observation.errorCode);
    if (
      observation.availableBytes !== null &&
      BigInt(observation.availableBytes) < BigInt(size)
    )
      throw Error("REMOTE_DISK_FULL");
    return observation;
  }
  private inspecting = 0;
  async preview(payload: unknown, retry = false): Promise<RelayPreview> {
    if (this.inspecting >= 2) throw Error("REQUEST_BUSY");
    this.inspecting++;
    try {
      return await this.preparePreview(payload, retry);
    } finally {
      this.inspecting--;
    }
  }
  private async preparePreview(
    payload: unknown,
    retry: boolean,
  ): Promise<RelayPreview> {
    this.repo();
    const generation = this.previewGeneration;
    let previous: RelayReceipt | null = null,
      origin: RelayEndpoint,
      sourceToken: string | null = null,
      entryToken: string | null = null;
    const input = retry
      ? retryPreview.parse(payload)
      : firstPreview.parse(payload);
    if ("parentId" in input) {
      previous = this.get(input.parentId);
      if (!this.canRetry(previous)) throw Error("REQUEST_BUSY");
      origin = previous.origin;
      if (!previous.stageStat) sourceToken = this.token(origin);
    } else {
      entryToken = input.entryToken;
      const entry = this.d.files.resolveEntry(entryToken);
      if (entry.type !== "file" || !validName(entry.rawName))
        throw Error("PATH_UNSUPPORTED");
      sourceToken = entry.browser.sessionToken;
      origin = this.endpoints(
        sourceToken,
        posix.join(entry.path, entry.rawName),
      );
    }
    const name =
      input.name ??
      (previous
        ? posix.basename(previous.destination)
        : posix.basename(origin.path));
    const target = this.endpoints(
      input.destinationSessionToken,
      remotePathSchema.parse(posix.join(input.directory, name)),
    );
    if (origin.serverId === target.serverId) throw Error("INPUT_INVALID");
    if (
      origin.hostKeyFingerprint === target.hostKeyFingerprint &&
      origin.username === target.username &&
      origin.host === target.host &&
      origin.port === target.port &&
      origin.path === target.path
    )
      throw Error("NAME_CONFLICT");
    if (previous && !isSameAccount(previous.target, target))
      throw Error("TOKEN_EXPIRED");
    const epoch = this.d.gateway.epoch,
      stat = previous?.sourceStat ?? (await this.sourceStat(origin));
    for (const [key, value] of this.intents)
      if (value.expires <= performance.now()) this.intents.delete(key);
    if (this.intents.size >= 6) throw Error("REQUEST_BUSY");
    const view: RelayPreview = {
      confirmationToken: null,
      source: origin,
      destination: target,
      size: stat.size,
      disk: null,
      remoteAvailableBytes: null,
      errorCode: null,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    try {
      if (!previous?.stageStat) {
        view.disk = await this.d.staging.preview(stat.size);
        if (view.disk.shortfallBytes) throw Error("LOCAL_DISK_FULL");
      }
      await this.capacity(target, stat.size, view);
      if (epoch !== this.d.gateway.epoch) throw Error("ENGINE_STOPPED");
      if (sourceToken) this.token(origin);
      this.token(target);
      if (entryToken) this.d.files.resolveEntry(entryToken);
      this.repo().checkNew(target.serverId, [
        { path: target.path, mode: "write" },
      ]);
      if (previous?.stageStat) {
        if (!previous.stageArea || !previous.digest)
          throw Error("VERIFY_MISMATCH");
        await verifyRelayDigest(
          previous.stageArea.filePath,
          await this.stageStat(previous),
          previous.digest,
        );
        if (!this.canRetry(this.get(previous.taskId)))
          throw Error("REQUEST_BUSY");
      }
      if (
        generation !== this.previewGeneration ||
        epoch !== this.d.gateway.epoch
      )
        throw Error("TOKEN_EXPIRED");
      if (this.intents.size >= 6) throw Error("REQUEST_BUSY");
      this.token(target);
      const confirmationToken = randomUUID();
      view.confirmationToken = confirmationToken;
      this.intents.set(confirmationToken, {
        view: structuredClone(view),
        stat,
        epoch,
        expires: performance.now() + 60000,
        oldId: previous?.taskId ?? null,
        revision: previous?.legIds.length ?? 0,
        sourceToken,
        entryToken,
      });
    } catch (e) {
      view.errorCode = errorCodeOf(e);
    }
    return view;
  }
  private async stageStat(row: RelayReceipt) {
    if (!row.stageArea || !row.digest || !row.stageStat)
      throw Error("PATH_CHANGED");
    const stat = await this.d.staging.verify(row.stageArea);
    if (
      stat.identity !== row.stageStat.identity ||
      stat.size !== row.size ||
      stat.mtime !== row.stageStat.mtime
    )
      throw Error("SOURCE_CHANGED");
    return stat;
  }
  private async save(
    row: RelayReceipt,
    change: Partial<RelayReceipt> = {},
  ): Promise<RelayReceipt> {
    const next = relayReceiptSchema.parse({
      ...row,
      ...change,
      updatedAt: ts(),
    });
    if (Buffer.byteLength(JSON.stringify(next)) > 62000)
      throw Error("FILE_LIMIT");
    await this.repo().save(next);
    return next;
  }
  private async hold(id: string, e: RelayEndpoint) {
    if (this.held.has(id)) return;
    for (const [parentId, claim] of this.unconfirmedHolds) {
      if (claim.epoch === this.d.gateway.epoch)
        await this.d.gateway.request({
          action: "transfer:releaseRelay",
          serverId: claim.endpoint.serverId,
          generation: claim.endpoint.generation,
          parentId,
        });
      this.unconfirmedHolds.delete(parentId);
    }
    const epoch = this.d.gateway.epoch;
    try {
      await this.d.gateway.request({
        action: "transfer:holdRelay",
        serverId: e.serverId,
        generation: e.generation,
        parentId: id,
      });
    } catch (cause) {
      // No child can have been submitted yet. Compensate even when the reservation reply was lost.
      if (epoch === this.d.gateway.epoch) {
        try {
          await this.d.gateway.request({
            action: "transfer:releaseRelay",
            serverId: e.serverId,
            generation: e.generation,
            parentId: id,
          });
        } catch {
          this.unconfirmedHolds.set(id, { endpoint: e, epoch });
        }
      }
      throw cause;
    }
    this.held.set(id, { endpoint: e, epoch });
  }
  private async release(row: RelayReceipt) {
    if (!this.held.has(row.taskId)) return;
    if (this.d.gateway.epoch === row.backendEpoch)
      await this.d.gateway.request({
        action: "transfer:releaseRelay",
        serverId: row.origin.serverId,
        generation: row.origin.generation,
        parentId: row.taskId,
      });
    this.held.delete(row.taskId);
  }
  async dispatchCheck(child: TransferReceipt): Promise<void> {
    const row = this.get(child.relayParentId ?? "");
    if (
      row.downloadId !== child.taskId ||
      !this.live.has(row.taskId) ||
      !row.stageArea ||
      row.backendEpoch !== this.d.gateway.epoch ||
      !["queued", "receiving"].includes(row.phase)
    )
      throw Error("TOKEN_EXPIRED");
    this.token(row.origin);
    this.token(row.target);
    await this.capacity(row.target, row.size);
    await this.d.staging.recheck(row.stageArea, row.size);
    this.token(row.origin);
    this.token(row.target);
    if (this.d.gateway.epoch !== row.backendEpoch)
      throw Error("ENGINE_STOPPED");
    const current = this.get(row.taskId);
    if (current.downloadId !== child.taskId || current.phase !== row.phase)
      throw Error("REQUEST_CANCELLED");
  }
  private async start(token: string) {
    const intent = this.intents.get(token);
    this.intents.delete(token);
    if (
      !intent ||
      intent.expires <= performance.now() ||
      intent.epoch !== this.d.gateway.epoch
    )
      throw Error("TOKEN_EXPIRED");
    const { view } = intent,
      previous = intent.oldId ? this.get(intent.oldId) : null;
    const e = view.source,
      b = view.destination;
    if (intent.entryToken) this.d.files.resolveEntry(intent.entryToken);
    this.token(b);
    if (intent.sourceToken) this.token(e);
    if (
      previous &&
      (!this.canRetry(previous) || previous.legIds.length !== intent.revision)
    )
      throw Error("REQUEST_BUSY");
    await this.capacity(b, view.size);
    if (
      !previous?.stageStat &&
      JSON.stringify(await this.sourceStat(e)) !== JSON.stringify(intent.stat)
    )
      throw Error("SOURCE_CHANGED");
    if (!previous) this.repo().checkRelayAdmission();
    const id = previous?.taskId ?? randomUUID(),
      aid = randomUUID(),
      now = ts();
    let row: RelayReceipt = previous ?? {
      kind: "server_relay",
      taskId: id,
      serverId: e.serverId,
      generation: e.generation,
      backendEpoch: intent.epoch,
      endpointSnapshot: snapshot(e),
      hostKeyFingerprint: e.hostKeyFingerprint,
      source: e.path,
      destination: b.path,
      origin: e,
      target: b,
      size: view.size,
      sourceStat: intent.stat,
      legIds: [aid],
      downloadId: aid,
      uploadId: null,
      stageArea: null,
      stageStat: null,
      digest: null,
      phase: "queued",
      lastConfirmedPhase: "accepted",
      publication: "none",
      localCleanup: "none",
      remoteCleanup: "none",
      failureLocation: null,
      errorCode: null,
      acknowledgedAt: null,
      recoveryUncertain: false,
      recoveredFromPhase: null,
      createdAt: now,
      updatedAt: now,
    };
    if (row.legIds.length > 125) throw Error("TASK_LIMIT");
    await this.hold(id, previous?.stageStat ? b : e);
    this.live.add(id);
    try {
      if (previous?.stageStat) {
        row = await this.save(row, {
          target: b,
          destination: b.path,
          phase: "waiting_to_send",
          errorCode: null,
          acknowledgedAt: null,
          uploadId: null,
          remoteCleanup: "none",
        });
        await this.send(row);
      } else {
        if (previous)
          row = {
            ...row,
            acknowledgedAt: null,
            downloadId: aid,
            legIds: [...row.legIds, aid],
            target: b,
            destination: b.path,
            phase: "queued",
            errorCode: null,
          };
        row = await this.save(row, { localCleanup: "unknown" });
        if (!view.disk) throw Error("LOCAL_SPACE_UNKNOWN");
        const stage = await this.d.staging.create(
          id,
          row.size,
          view.disk.volumeId,
        );
        this.unrecordedStages.set(id, stage);
        row = { ...row, stageArea: stage, localCleanup: "needed" };
        row = await this.save(row);
        this.unrecordedStages.delete(id);
        const spec = leg(row, "download", intent.stat);
        await this.d.transfers.registerRelay(spec, this.token(e));
      }
    } catch (error) {
      const code = errorCodeOf(error);
      if (error instanceof RelayStageCreationError) {
        this.unrecordedStages.set(id, error.stage);
        row = { ...row, stageArea: error.stage, localCleanup: "unknown" };
      } else if (!row.stageArea) row = { ...row, localCleanup: "confirmed" };
      const saved = this.d.repository()?.get(id);
      if (saved?.kind !== "server_relay") {
        await this.release(row);
        this.live.delete(id);
        throw error;
      }
      if (this.d.repository()?.faulted) {
        this.failedStorage.add(id);
        throw error;
      }
      // A failed reply may follow a durable child intent; always use the latest checkpoint.
      if (saved.legIds.length >= row.legIds.length && saved.uploadId)
        row = saved;
      const child = this.repo().get(row.uploadId ?? row.downloadId);
      if (
        child?.kind === "file_transfer" &&
        (this.d.transfers.isActive(child.taskId) ||
          child.recoveryUncertain ||
          child.phase === "result_unknown")
      ) {
        await this.save(row, {
          phase: "result_unknown",
          publication: row.uploadId ? "unknown" : "none",
          errorCode: code,
        });
        throw error;
      }
      await this.stop(
        row,
        code,
        diskErrors.has(code) && !row.stageStat ? "waiting_for_space" : "failed",
        !row.stageStat,
      );
      this.unrecordedStages.delete(id);
    }
    return id;
  }
  private async send(row: RelayReceipt) {
    const token = this.token(row.target),
      stat = await this.stageStat(row);
    await this.capacity(row.target, row.size);
    this.token(row.target);
    if (this.inflight.has(row.taskId)) throw Error("REQUEST_CANCELLED");
    const uploadId = randomUUID();
    row = await this.save(row, {
      uploadId,
      legIds: [...row.legIds, uploadId],
      phase: "sending",
      errorCode: null,
    });
    const spec = leg(row, "upload", stat);
    await this.d.transfers.registerRelay(spec, token);
  }

  private async cleanup(row: RelayReceipt): Promise<RelayReceipt> {
    if (!row.stageArea) return row;
    const a = this.repo().get(row.downloadId);
    const identity =
      a?.kind === "file_transfer" ? a.localTempIdentity : undefined;
    try {
      await this.d.staging.discard(
        row.stageArea,
        row.stageStat?.identity ?? identity ?? null,
        identity ? { taskId: row.downloadId, identity } : undefined,
      );
      if (
        a?.kind === "file_transfer" &&
        receiptUnresolved(a) &&
        !this.d.transfers.isActive(a.taskId)
      ) {
        await this.d.transfers.acknowledge(a);
        await this.repo().acknowledge(a.taskId);
      }
      return this.save(row, {
        stageArea: null,
        stageStat: null,
        localCleanup: "confirmed",
      });
    } catch {
      return this.save(row, { localCleanup: "unknown" });
    }
  }
  private async stop(
    row: RelayReceipt,
    errorCode: string | null,
    phase: RelayReceipt["phase"],
    clean: boolean,
  ) {
    const local =
      !!errorCode &&
      (diskErrors.has(errorCode) || errorCode === "STORAGE_FAILED");
    const target =
      !!errorCode &&
      (errorCode.startsWith("REMOTE_") || errorCode === "NAME_CONFLICT");
    const place: RelayReceipt["failureLocation"] = local
      ? "pc"
      : target || row.uploadId || row.stageStat
        ? "destination"
        : errorCode === "SOURCE_CHANGED" || errorCode === "CONNECTION_LOST"
          ? "source"
          : null;
    row = await this.save(row, {
      phase,
      errorCode,
      failureLocation: errorCode ? place : null,
    });
    if (clean) row = await this.cleanup(row);
    await this.release(row);
    if (!row.stageArea && row.phase !== "waiting_for_space")
      this.live.delete(row.taskId);
  }
  private async finished(
    id: string,
    childId: string,
    runtime: TransferRuntime,
  ) {
    let row = this.get(id);
    if (
      !this.live.has(id) ||
      row.backendEpoch !== this.d.gateway.epoch ||
      childId !== (row.uploadId ?? row.downloadId)
    )
      return;
    if (relayTerminal(row)) {
      if (!runtime.active && !runtime.cleanupPending && !runtime.slotOccupied)
        await this.release(row);
      return;
    }
    const child = this.repo().get(childId);
    if (
      child?.kind !== "file_transfer" ||
      child.relayParentId !== id ||
      child.phase !== runtime.phase ||
      runtime.recordError ||
      runtime.active ||
      runtime.slotOccupied ||
      runtime.cleanupPending
    ) {
      if (runtime.recordError) this.failedStorage.add(id);
      return;
    }
    const upload = child.direction === "upload";
    if (
      !currentRelayLeg(row, child) ||
      child.recoveryUncertain ||
      (child.phase === "completed" &&
        (!child.dispatchAllowed ||
          !child.destinationCreated ||
          child.transferredBytes !== row.size ||
          child.verifiedBytes !== row.size ||
          !["temp_removed", "destination_confirmed"].includes(
            child.lastConfirmedPhase,
          )))
    ) {
      await this.stop(
        await this.save(row, {
          publication: row.uploadId ? "unknown" : "none",
        }),
        "RESULT_UNKNOWN",
        "result_unknown",
        false,
      );
      return;
    }
    if (!receiptUnresolved(child)) await this.d.transfers.acknowledge(child);
    if (
      child.phase !== "completed" ||
      !child.destinationCreated ||
      child.streamSha256 === null
    ) {
      const uncertain =
        child.phase === "result_unknown" ||
        (upload && child.destinationCreated);
      const beforePayload =
        child.direction === "download" &&
        !child.tempCreated &&
        !child.transferredBytes &&
        diskErrors.has(child.errorCode ?? "");
      row = await this.save(row, {
        remoteCleanup: upload ? child.cleanupState : row.remoteCleanup,
        publication: upload && uncertain ? "unknown" : "none",
        lastConfirmedPhase: child.lastConfirmedPhase,
      });
      await this.stop(
        row,
        child.errorCode,
        uncertain
          ? "result_unknown"
          : child.phase === "cancelled"
            ? "cancelled"
            : beforePayload
              ? "waiting_for_space"
              : child.phase === "interrupted"
                ? "interrupted"
                : "failed",
        !upload || child.phase === "cancelled",
      );
      return;
    }
    if (upload) {
      if (!row.digest || row.digest !== child.streamSha256) {
        await this.stop(
          await this.save(row, { publication: "unknown" }),
          "VERIFY_MISMATCH",
          "result_unknown",
          false,
        );
        return;
      }
      row = await this.save(row, {
        publication: "confirmed",
        remoteCleanup: child.cleanupState,
        lastConfirmedPhase: "destination_confirmed",
        phase: "completed",
        errorCode: null,
      });
      await this.cleanup(row);
      await this.release(row);
      if (!this.get(id).stageArea) this.live.delete(id);
      return;
    }
    if (!row.stageArea || !child.localTempIdentity) {
      await this.stop(row, "VERIFY_MISMATCH", "failed", false);
      return;
    }
    try {
      const stat = await this.d.staging.verify(row.stageArea);
      if (stat.identity !== child.localTempIdentity || stat.size !== row.size)
        throw Error("VERIFY_MISMATCH");
      await this.d.staging.retain(row.stageArea, row.size, stat.identity);
      if (receiptUnresolved(child)) {
        await this.d.staging.removeTemp(
          row.stageArea,
          child.taskId,
          stat.identity,
        );
        await this.d.transfers.acknowledge(child);
        await this.repo().acknowledge(child.taskId);
      }
      row = await this.save(row, {
        stageStat: stat,
        digest: child.streamSha256,
        lastConfirmedPhase: "local_stage_verified",
        phase: "waiting_to_send",
      });
      if (this.inflight.has(id)) {
        await this.stop(row, "REQUEST_CANCELLED", "cancelled", true);
        return;
      }
      await this.send(row);
    } catch (error) {
      if (this.d.repository()?.faulted) {
        this.failedStorage.add(id);
        return;
      }
      row = this.get(id);
      const b = row.uploadId ? this.repo().get(row.uploadId) : null;
      if (
        row.uploadId &&
        b?.kind === "file_transfer" &&
        (this.d.transfers.isActive(b.taskId) || b.phase === "result_unknown")
      ) {
        await this.stop(
          await this.save(row, { publication: "unknown" }),
          errorCodeOf(error),
          "result_unknown",
          false,
        );
        return;
      }
      await this.stop(row, errorCodeOf(error), "failed", !row.stageStat);
    }
  }
  private canRetry(row: RelayReceipt) {
    if (
      !this.live.has(row.taskId) ||
      row.backendEpoch !== this.d.gateway.epoch ||
      this.failedStorage.has(row.taskId) ||
      row.publication !== "none" ||
      (!row.acknowledgedAt && ["unknown", "needed"].includes(row.remoteCleanup))
    )
      return false;
    if (row.phase === "waiting_for_space") return row.stageArea === null;
    return (
      row.stageArea !== null &&
      row.stageStat !== null &&
      !!row.digest &&
      ["failed", "interrupted"].includes(row.phase)
    );
  }

  private history() {
    const repo = this.d.repository();
    if (!repo)
      return { parents: [], children: new Map<string, TransferReceipt>() };
    if (
      this.historyCache?.repo === repo &&
      this.historyCache.version === repo.revision
    )
      return this.historyCache;
    const rows = repo.snapshots();
    this.historyCache = {
      repo,
      version: repo.revision,
      parents: rows.filter((r): r is RelayReceipt => r.kind === "server_relay"),
      children: new Map(
        rows
          .filter(
            (r): r is TransferReceipt =>
              r.kind === "file_transfer" && !!r.relayParentId,
          )
          .map((r) => [r.taskId, r]),
      ),
    };
    return this.historyCache;
  }
  private active(row: RelayReceipt) {
    return (
      this.live.has(row.taskId) &&
      ((!relayTerminal(row) && row.phase !== "waiting_for_space") ||
        this.d.transfers.isActive(row.uploadId ?? row.downloadId))
    );
  }
  isActive(id: string) {
    const row = this.d.repository()?.get(id);
    return row?.kind === "server_relay" && this.active(row);
  }
  hasWork(serverId?: string) {
    return this.history().parents.some(
      (row) =>
        (!serverId ||
          row.origin.serverId === serverId ||
          row.target.serverId === serverId) &&
        (!relayTerminal(row) || relayUnresolved(row)),
    );
  }
  hasFinalizing(serverId?: string) {
    return this.list().some(
      (row) =>
        (!serverId ||
          row.destination.serverId === serverId ||
          row.source.serverId === serverId) &&
        row.phase === "publishing",
    );
  }
  list(): RelayView[] {
    const history = this.history(),
      children = new Map(history.children);
    for (const c of this.d.transfers.overlays())
      if (c.relayParentId) children.set(c.taskId, c);
    return history.parents.map((row) => {
      const id = row.uploadId ?? row.downloadId,
        c = children.get(id),
        state = this.d.transfers.taskState(id);
      let phase = row.phase;
      if (!relayTerminal(row) && row.phase !== "waiting_for_space" && c) {
        if (c.phase === "transferring")
          phase = c.direction === "upload" ? "sending" : "receiving";
        if (c.phase === "verifying")
          phase =
            c.direction === "upload" ? "verifying_remote" : "verifying_local";
        if (c.phase === "finalizing" || c.phase === "finalize_intent_pending")
          phase = c.direction === "upload" ? "publishing" : "verifying_local";
        if (c.phase === "queued")
          phase = c.direction === "upload" ? "waiting_to_send" : "queued";
      }
      const recordError = this.failedStorage.has(row.taskId),
        active = this.active(row);
      return {
        id: row.taskId,
        source: row.origin,
        destination: row.target,
        size: row.size,
        phase: recordError || state.cleanupPending ? "result_unknown" : phase,
        needsAttention:
          recordError ||
          state.cleanupPending ||
          row.phase === "waiting_for_space" ||
          (!active && relayUnresolved(row)),
        lastConfirmedPhase: c?.lastConfirmedPhase ?? row.lastConfirmedPhase,
        bytes:
          phase === "verifying_local" || phase === "verifying_remote"
            ? (c?.verifiedBytes ?? 0)
            : (c?.transferredBytes ?? 0),
        rate: state.bytesPerSecond,
        publication: recordError && row.uploadId ? "unknown" : row.publication,
        localCleanup: row.localCleanup,
        remoteCleanup: row.remoteCleanup,
        errorCode: recordError
          ? "STORAGE_FAILED"
          : state.cleanupPending
            ? "RESULT_UNKNOWN"
            : row.errorCode,
        failureLocation: recordError ? "pc" : row.failureLocation,
        localStagePath: row.stageArea
          ? row.stageStat
            ? row.stageArea.filePath
            : row.stageArea.directory.path
          : null,
        localStageBytes: row.stageArea ? (row.stageStat?.size ?? null) : null,
        remoteTempPath:
          row.uploadId &&
          c?.direction === "upload" &&
          (c.cleanupState === "needed" ||
            c.cleanupState === "unknown" ||
            (c.tempCreated && c.cleanupState === "none"))
            ? c.tempPath
            : null,
        cancelable:
          !recordError &&
          !state.cleanupPending &&
          ((active && phase !== "publishing") ||
            row.phase === "waiting_for_space"),
        retryable: this.canRetry(row),
        discardable:
          !!row.stageArea &&
          !active &&
          !state.active &&
          !state.cleanupPending &&
          !recordError,
        acknowledgeable:
          relayTerminal(row) &&
          !row.acknowledgedAt &&
          !active &&
          (row.publication === "unknown" ||
            row.remoteCleanup === "needed" ||
            row.remoteCleanup === "unknown" ||
            row.phase === "result_unknown" ||
            (row.localCleanup === "unknown" && !row.stageArea)),
      };
    });
  }
  private async cancel(id: string) {
    const row = this.get(id);
    const childId = row.uploadId ?? row.downloadId;
    if (this.d.transfers.isActive(childId)) {
      await this.d.transfers.handle("transfer:cancel", childId);
      return;
    }
    if (!this.live.has(id) || relayTerminal(row)) throw Error("REQUEST_BUSY");
    await this.stop(row, "REQUEST_CANCELLED", "cancelled", true);
  }
  async cancelForShutdown(serverId?: string) {
    for (const row of this.list())
      if (
        row.cancelable &&
        (!serverId ||
          row.destination.serverId === serverId ||
          (row.source.serverId === serverId && !this.get(row.id).stageStat))
      )
        await this.handle("relay:cancel", row.id);
  }
  async restore(afterBarrier = false) {
    return this.serial(async () => {
      const repo = this.repo();
      if (afterBarrier) {
        // Storage recovery has already stopped or settled all child I/O. Discard all old dispatch authority.
        this.invalidateRenderer();
        this.live.clear();
        this.inflight.clear();
        this.failedStorage.clear();
        for (const [id, claim] of this.held)
          this.unconfirmedHolds.set(id, claim);
        this.held.clear();
        for (const [id, claim] of this.unconfirmedHolds) {
          if (claim.epoch === this.d.gateway.epoch) {
            try {
              await this.d.gateway.request({
                action: "transfer:releaseRelay",
                parentId: id,
                serverId: claim.endpoint.serverId,
                generation: claim.endpoint.generation,
              });
            } catch {
              continue;
            } // Admission will reconcile this bookkeeping claim again before requesting a new one.
          }
          this.unconfirmedHolds.delete(id);
        }
        for (const [id, stageArea] of this.unrecordedStages) {
          const row = repo.get(id);
          if (row?.kind === "server_relay" && !row.stageArea)
            await this.save(row, { stageArea, localCleanup: "needed" });
          else if (!row) await this.d.staging.discard(stageArea, null);
          this.unrecordedStages.delete(id);
        }
      }
      for (const row of repo.snapshots())
        if (row.kind === "server_relay" && row.stageArea)
          await this.d.staging.restore(row.stageArea, row.size);
    });
  }
  async engineStopped() {
    const ids = [...this.live];
    this.live.clear();
    this.held.clear();
    this.unconfirmedHolds.clear();
    this.invalidateRenderer();
    await this.serial(async () => {
      for (const id of ids) {
        const row = this.get(id);
        if (!relayTerminal(row))
          await this.save(row, {
            phase: row.uploadId ? "result_unknown" : "interrupted",
            publication: row.uploadId ? "unknown" : row.publication,
            errorCode: "ENGINE_STOPPED",
          });
      }
    });
  }
  discardForQuit(id: string, stillAuthorized: () => boolean): Promise<void> {
    return this.serial(async () => {
      if (!stillAuthorized()) throw Error("TOKEN_EXPIRED");
      await this.discard(id);
    });
  }
  private async discard(id: string) {
    const row = this.get(id);
    const childId = row.uploadId ?? row.downloadId;
    if (
      this.isActive(id) ||
      this.d.transfers.taskState(childId).cleanupPending ||
      this.d.transfers.isActive(childId)
    )
      throw Error("REQUEST_BUSY");
    if (!row.stageArea) return;
    const cleaned = await this.cleanup(row);
    if (cleaned.stageArea) throw Error("PATH_CHANGED");
    this.live.delete(id);
    await this.release(row);
  }
  private async acknowledge(id: string) {
    const row = this.get(id);
    if (!this.list().find((v) => v.id === id)?.acknowledgeable)
      throw Error("REQUEST_BUSY");
    for (const childId of row.legIds) {
      const child = this.repo().get(childId);
      if (child?.kind === "file_transfer" && receiptUnresolved(child)) {
        await this.d.transfers.acknowledge(child);
        await this.repo().acknowledge(childId);
      }
    }
    await this.save(row, { acknowledgedAt: ts() });
  }
  private async inspect(id: string) {
    const row = this.get(id),
      token = this.token(row.target, true),
      e = this.endpoints(token, row.destination);
    try {
      const stat = transferStatSchema.nullable().parse(
        await this.d.gateway.request({
          action: "relay:observeDestination",
          serverId: e.serverId,
          generation: e.generation,
          path: e.path,
          parent: posix.dirname(e.path),
        }),
      );
      return { present: stat !== null, size: stat?.size ?? null };
    } catch (err) {
      if (errorCodeOf(err) === "PATH_UNSUPPORTED")
        return { present: null, size: null };
      throw err;
    }
  }
  async handle(action: string, payload?: unknown): Promise<unknown> {
    if (action === "relay:preview") return this.preview(payload);
    if (action === "relay:retryPreview") return this.preview(payload, true);
    if (action === "relay:list") {
      if (payload !== undefined) throw Error("INPUT_INVALID");
      return this.list();
    }
    const id = z.uuid().parse(payload);
    if (action === "relay:releasePreview") {
      this.intents.delete(id);
      return;
    }
    if (action === "relay:start") return this.serial(() => this.start(id));
    if (action === "relay:inspect") return this.inspect(id);
    if (action === "relay:discard") return this.serial(() => this.discard(id));
    if (action === "relay:acknowledge")
      return this.serial(() => this.acknowledge(id));
    if (action === "relay:cancel") {
      this.inflight.add(id);
      try {
        return await this.serial(() => this.cancel(id));
      } finally {
        this.inflight.delete(id);
      }
    }
    throw Error("INPUT_INVALID");
  }
}
