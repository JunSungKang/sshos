import { z } from "zod";
import { remotePathSchema } from "./files";
import {
  transferStatSchema,
  MAX_TRANSFER_BYTES,
  type TransferReceipt,
} from "./transfers";
import { endpointSnapshotSchema } from "./mutations";
import { localDirectorySchema } from "./transfer-protocol";

const endpoint = endpointSnapshotSchema.extend({
  serverId: z.uuid(),
  generation: z.int().positive(),
  hostKeyFingerprint: z.string().min(1).max(128),
  path: remotePathSchema,
});
export type RelayEndpoint = z.infer<typeof endpoint>;
export type RelayDiskView = {
  volumeId: string;
  sizeBytes: number;
  marginBytes: number;
  requiredBytes: number;
  osFreeBytes: string;
  effectiveBytes: string;
  shortfallBytes: number;
};
export type RelayPreview = {
  confirmationToken: string | null;
  source: RelayEndpoint;
  destination: RelayEndpoint;
  size: number;
  disk: RelayDiskView | null;
  remoteAvailableBytes: string | null;
  errorCode: string | null;
  expiresAt: string;
};
const phase = z.enum([
  "queued",
  "receiving",
  "verifying_local",
  "waiting_to_send",
  "sending",
  "verifying_remote",
  "publishing",
  "completed",
  "failed",
  "interrupted",
  "result_unknown",
  "cancelled",
  "waiting_for_space",
]);
const cleanup = z.enum(["none", "needed", "unknown", "confirmed"]);
const stagingSchema = z
  .object({
    jobId: z.uuid(),
    root: localDirectorySchema,
    directory: localDirectorySchema,
    volumeId: z.string().min(1).max(4096),
    baseIdentity: z.string().min(1).max(128).optional(),
    probeIdentity: z.string().min(1).max(128).optional(),
    filePath: z.string().min(1).max(32768),
  })
  .strict();
export const relayReceiptSchema = z
  .object({
    kind: z.literal("server_relay"),
    taskId: z.uuid(),
    serverId: z.uuid(),
    generation: z.int().positive(),
    backendEpoch: z.uuid(),
    endpointSnapshot: endpointSnapshotSchema,
    hostKeyFingerprint: z.string().max(128),
    source: remotePathSchema,
    destination: remotePathSchema,
    origin: endpoint,
    target: endpoint,
    size: z.int().min(0).max(MAX_TRANSFER_BYTES),
    sourceStat: transferStatSchema,
    legIds: z.array(z.uuid()).min(1).max(128),
    downloadId: z.uuid(),
    uploadId: z.uuid().nullable(),
    stageArea: stagingSchema.nullable(),
    stageStat: transferStatSchema.nullable(),
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    phase,
    lastConfirmedPhase: z.string().max(64),
    publication: z.enum(["none", "unknown", "confirmed"]),
    localCleanup: cleanup,
    remoteCleanup: cleanup,
    failureLocation: z
      .enum(["source", "pc", "destination"])
      .nullable()
      .default(null),
    errorCode: z.string().max(64).nullable(),
    acknowledgedAt: z.iso.datetime().nullable(),
    recoveryUncertain: z.boolean().default(false),
    recoveredFromPhase: z.string().max(64).nullable().default(null),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (row) =>
      (row.stageArea === null || row.stageArea.jobId === row.taskId) &&
      row.size === row.sourceStat.size &&
      row.origin.path === row.source &&
      row.target.path === row.destination &&
      row.origin.serverId === row.serverId &&
      row.origin.generation === row.generation &&
      row.origin.hostKeyFingerprint === row.hostKeyFingerprint &&
      row.origin.host === row.endpointSnapshot.host &&
      row.origin.port === row.endpointSnapshot.port &&
      row.origin.username === row.endpointSnapshot.username &&
      row.origin.endpoint === row.endpointSnapshot.endpoint &&
      row.origin.serverId !== row.target.serverId &&
      (!row.stageStat ||
        (row.stageStat.size === row.size && !!row.stageStat.identity)) &&
      (row.phase !== "completed" ||
        (row.publication === "confirmed" &&
          !!row.digest &&
          row.uploadId !== null)) &&
      row.downloadId !== row.uploadId &&
      !row.legIds.includes(row.taskId) &&
      row.legIds.includes(row.downloadId) &&
      (row.uploadId === null || row.legIds.includes(row.uploadId)) &&
      new Set(row.legIds).size === row.legIds.length,
  );
export type RelayReceipt = z.infer<typeof relayReceiptSchema>;

/** Match the exact accepted leg before granting writes or reconciling a restart. */
export function currentRelayLeg(
  parent: RelayReceipt,
  child: TransferReceipt,
): boolean {
  const upload = child.direction === "upload";
  const endpoint = upload ? parent.target : parent.origin;
  const stage = parent.stageArea;
  const stat = upload ? parent.stageStat : parent.sourceStat;
  return (
    child.taskId === (upload ? parent.uploadId : parent.downloadId) &&
    child.relayParentId === parent.taskId &&
    child.backendEpoch === parent.backendEpoch &&
    child.serverId === endpoint.serverId &&
    child.generation === endpoint.generation &&
    child.hostKeyFingerprint === endpoint.hostKeyFingerprint &&
    child.endpointSnapshot.host === endpoint.host &&
    child.endpointSnapshot.port === endpoint.port &&
    child.endpointSnapshot.username === endpoint.username &&
    child.endpointSnapshot.endpoint === endpoint.endpoint &&
    (upload ? child.destination : child.source) === endpoint.path &&
    child.totalBytes === parent.size &&
    (!stage ||
      (child.localParent === stage.directory.path &&
        (upload ? child.source : child.destination) === stage.filePath)) &&
    (!stat ||
      (child.sourceInitialStat.identity === stat.identity &&
        child.sourceInitialStat.mtime === stat.mtime))
  );
}
export type RelayView = {
  id: string;
  source: RelayEndpoint;
  destination: RelayEndpoint;
  size: number;
  phase: RelayReceipt["phase"];
  lastConfirmedPhase: string;
  bytes: number;
  rate: number | null;
  publication: RelayReceipt["publication"];
  localCleanup: RelayReceipt["localCleanup"];
  remoteCleanup: RelayReceipt["remoteCleanup"];
  errorCode: string | null;
  failureLocation: "source" | "pc" | "destination" | null;
  localStagePath: string | null;
  localStageBytes: number | null;
  remoteTempPath: string | null;
  cancelable: boolean;
  retryable: boolean;
  discardable: boolean;
  acknowledgeable: boolean;
};
export const relayTerminal = (row: RelayReceipt) =>
  [
    "completed",
    "failed",
    "interrupted",
    "result_unknown",
    "cancelled",
  ].includes(row.phase);
export const relayUnresolved = (row: RelayReceipt) =>
  row.stageArea !== null ||
  (!row.acknowledgedAt &&
    (row.localCleanup === "unknown" ||
      row.remoteCleanup === "unknown" ||
      row.remoteCleanup === "needed" ||
      row.phase === "result_unknown"));
export function recoverRelay(row: RelayReceipt, backup: boolean): RelayReceipt {
  if (!backup && relayTerminal(row)) return row;
  const uncertain = backup || row.uploadId !== null;
  return {
    ...row,
    phase: uncertain ? "result_unknown" : "interrupted",
    publication: uncertain ? "unknown" : row.publication,
    errorCode: uncertain ? "RESULT_UNKNOWN" : "CONNECTION_LOST",
    acknowledgedAt: null,
    recoveryUncertain: backup,
    recoveredFromPhase: row.phase,
  };
}
