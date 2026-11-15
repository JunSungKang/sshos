import { z } from 'zod';
import { remotePathSchema } from './files';
import { endpointSnapshotSchema } from './mutations';

export const MAX_TRANSFER_BYTES=64*1024**3;
export const TRANSFER_CHUNK_BYTES=32*1024;
export const TRANSFER_PIPELINE=16;
export const transferPhaseSchema=z.enum(['queued','preparing','transferring','verifying','finalize_intent_pending','finalizing','cancel_requested','completed','failed','interrupted','cancelled','result_unknown','skipped']);
export type TransferPhase=z.infer<typeof transferPhaseSchema>;
export const transferTerminal=(phase:TransferPhase):boolean => ['completed','failed','interrupted','cancelled','result_unknown','skipped'].includes(phase);
export const transferStatSchema=z.object({size:z.int().min(0).max(MAX_TRANSFER_BYTES),mtime:z.string().regex(/^\d{1,32}$/u),identity:z.string().max(128)}).strict();
export type TransferStat=z.infer<typeof transferStatSchema>;
const path=z.string().min(1).refine(value => !value.includes('\0') && new TextEncoder().encode(value).length<=32768);
export const transferReceiptSchema=z.object({
  kind:z.literal('file_transfer'),taskId:z.uuid(),serverId:z.uuid(),generation:z.int().positive(),backendEpoch:z.uuid(),
  direction:z.enum(['upload','download']),endpointSnapshot:endpointSnapshotSchema,hostKeyFingerprint:z.string().max(128),
  source:path,destination:path,tempPath:path,remoteParent:remotePathSchema,localParent:path,sourceInitialStat:transferStatSchema,
  totalBytes:z.int().min(0).max(MAX_TRANSFER_BYTES),transferredBytes:z.int().min(0).max(MAX_TRANSFER_BYTES),verifiedBytes:z.int().min(0).max(MAX_TRANSFER_BYTES),streamSha256:z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  phase:transferPhaseSchema,stage:z.string().max(64),cleanupState:z.enum(['none','confirmed','needed','unknown']),
  tempCreated:z.boolean(),destinationCreated:z.boolean(),dispatchAllowed:z.boolean(),lastConfirmedPhase:z.string().max(64),errorCode:z.string().max(64).nullable(),
  recoveryUncertain:z.boolean(),recoveredFromPhase:z.string().max(64).nullable(),acknowledgedAt:z.iso.datetime().nullable(),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime()
}).strict().refine(row => row.totalBytes === row.sourceInitialStat.size && row.transferredBytes<=row.totalBytes && row.verifiedBytes<=row.totalBytes);
export type TransferReceipt=z.infer<typeof transferReceiptSchema>;
export function recoverTransfer(row:TransferReceipt,backup:boolean):TransferReceipt {
  if (backup || ['finalize_intent_pending','finalizing','result_unknown'].includes(row.phase) || row.stage === 'temp_create_intent' && !row.tempCreated) return {...row,phase:'result_unknown',errorCode:'RESULT_UNKNOWN',recoveryUncertain:backup,recoveredFromPhase:row.phase,cleanupState:row.tempCreated ? 'needed' : row.cleanupState};
  if (!transferTerminal(row.phase)) return {...row,phase:'interrupted',errorCode:'CONNECTION_LOST',cleanupState:row.tempCreated ? 'needed' : row.cleanupState,recoveredFromPhase:row.phase};
  return row;
}
