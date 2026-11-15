import { z } from 'zod';
import { remotePathSchema } from './files';

export const mutationSpecSchema = z.object({ operation:z.enum(['mkdir','delete','rename']), parent:remotePathSchema, source:remotePathSchema.nullable(), destination:remotePathSchema.nullable(), type:z.enum(['file','directory']).nullable() }).strict();
export type MutationSpec = z.infer<typeof mutationSpecSchema>;
export const initialStatSchema = z.object({ type:z.enum(['file','directory']), size:z.number().int().nonnegative().safe(), mtime:z.number().int().nonnegative().safe(), mode:z.number().int().nonnegative().max(0xffffffff) }).strict();
export type InitialStat = z.infer<typeof initialStatSchema>;
export const mutationResultSchema = z.object({ phase:z.enum(['completed','failed','partial','result_unknown','first_ack']), errorCode:z.string().max(64).nullable(), destinationCreated:z.boolean(), sourceRemovalConfirmed:z.boolean(), lastConfirmedPhase:z.string().max(64) }).strict();
export type MutationResult = z.infer<typeof mutationResultSchema>;
export type MutationPreview = { confirmationToken:string; operation:MutationSpec['operation']; serverName:string; endpoint:string; username:string; source:string|null; destination:string|null; expiresAt:string };
export const endpointSnapshotSchema = z.object({ name:z.string().max(256), host:z.string().max(253), port:z.int().min(1).max(65535), username:z.string().max(256), endpoint:z.string().max(300) }).strict();
export const mutationReceiptSchema = z.object({
  kind:z.literal('file_mutation'), taskId:z.uuid(), serverId:z.uuid(), generation:z.int().min(1), backendEpoch:z.uuid(),
  endpointSnapshot:endpointSnapshotSchema, hostKeyFingerprint:z.string().max(128), operation:z.enum(['mkdir','delete','rename']),
  source:remotePathSchema.nullable(), destination:remotePathSchema.nullable(), parent:remotePathSchema, sourceInitialStat:initialStatSchema.nullable(),
  phase:z.enum(['prepared','dispatched','completed','failed','partial','result_unknown']), stage:z.string().max(64), lastConfirmedPhase:z.string().max(64),
  destinationCreated:z.boolean(), sourceRemovalConfirmed:z.boolean(), errorCode:z.string().max(64).nullable(),
  recoveryUncertain:z.boolean(), recoveredFromPhase:z.string().max(64).nullable(), acknowledgedAt:z.iso.datetime().nullable(),
  createdAt:z.iso.datetime(), updatedAt:z.iso.datetime()
}).strict();
export type MutationReceipt = z.infer<typeof mutationReceiptSchema>;
export type TaskSummary = {taskId:string;kind:'file_mutation'|'file_transfer'|'gui_exec'|'pty';operation:'mkdir'|'delete'|'rename'|'upload'|'download'|'exec'|'pty';phase:string;source:string|null;destination:string|null;errorCode:string|null;acknowledgedAt:string|null;updatedAt:string;serverName:string;recordError:boolean;unresolved:boolean;terminal:boolean;transferredBytes:number|null;verifiedBytes:number|null;totalBytes:number|null;cleanupState:string|null;cancelable:boolean;registering:boolean;bytesPerSecond:number|null;cleanupPending:boolean};
export type TaskPage = {rows:TaskSummary[];nextOffset:number|null;damagedIds:string[]};
export type RecordActionPreview = {confirmationToken:string;taskId:string;action:'acknowledge'|'forget';source:string|null;destination:string|null;phase:string};
