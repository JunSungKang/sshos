import { z } from 'zod';
import { terminalRuntimeSchema,terminalInputSchema,terminalSizeSchema } from './terminals';
import { executionReceiptSchema,executionSpecSchema } from './executions';
import { executionRuntimeSchema } from './execution-protocol';
import { connectInputSchema, sessionSnapshotSchema } from './session-contracts';
import { remotePathSchema } from './files';
import { mutationSpecSchema, initialStatSchema,mutationObservationSchema,mutationReceiptSchema } from './mutations';
import {TEXT_LIMIT} from './viewers/text';
import { viewerReadKindSchema } from './viewers/reader';
import { stagedTransferSchema,transferRuntimeSchema } from './transfer-protocol';
const identity = { requestId: z.uuid(), backendEpoch: z.uuid(), serverId: z.uuid(), generation: z.int().min(1) };
export const engineRequestSchema = z.discriminatedUnion('action', [
  z.object({...identity,action:z.literal('editor:prepare'),taskId:z.uuid(),viewerId:z.uuid(),readGeneration:z.int().positive(),tempPath:remotePathSchema}).strict(),
  z.object({...identity,action:z.literal('editor:save'),receipt:mutationReceiptSchema,bytes:z.instanceof(Uint8Array).refine(value=>value.length<=TEXT_LIMIT)}).strict(),
  z.object({...identity,action:z.literal('editor:finish'),taskId:z.uuid(),keepRestriction:z.boolean()}).strict(),
  z.object({...identity,action:z.literal('probe:run'),probeEpoch:z.uuid(),probeId:z.uuid(),transferActive:z.boolean()}).strict(),
  z.object({...identity,action:z.literal('probe:invalidate'),probeEpoch:z.uuid()}).strict(),
  z.object({...identity,action:z.literal('pty:start'),receipt:executionReceiptSchema}).strict(),
  z.object({...identity,action:z.literal('pty:freeze'),terminalId:z.uuid(),restoreToken:z.uuid(),clear:z.boolean()}).strict(),
  z.object({...identity,action:z.literal('pty:restoreAck'),terminalId:z.uuid(),restoreToken:z.uuid(),offset:z.int().nonnegative()}).strict(),
  z.object({...identity,action:z.literal('pty:read'),terminalId:z.uuid(),cursor:z.int().nonnegative()}).strict(),
  z.object({...identity,action:z.literal('pty:pause'),terminalId:z.uuid()}).strict(),
  z.object({...identity,action:z.literal('pty:input'),terminalId:z.uuid(),sequence:z.int().positive(),bytes:terminalInputSchema,source:z.enum(['key','paste'])}).strict(),
  z.object({...identity,action:z.literal('pty:resize'),terminalId:z.uuid(),size:terminalSizeSchema}).strict(),
  z.object({...identity,action:z.literal('pty:close'),terminalId:z.uuid()}).strict(),
  z.object({...identity,action:z.literal('pty:forget'),terminalId:z.uuid()}).strict(),
  z.object({...identity,action:z.literal('pty:snapshot'),offset:z.int().min(0).max(1000)}).strict(),
  z.object({...identity,action:z.literal('execution:inspect'),spec:executionSpecSchema}).strict(),
  z.object({...identity,action:z.literal('execution:start'),receipt:executionReceiptSchema,spec:executionSpecSchema,expected:initialStatSchema}).strict(),
  z.object({...identity,action:z.literal('execution:snapshot'),offset:z.int().min(0).max(1000)}).strict(),
  z.object({...identity,action:z.literal('execution:read'),executionId:z.uuid(),cursor:z.int().nonnegative()}).strict(),
  z.object({...identity,action:z.literal('execution:stop'),executionId:z.uuid()}).strict(),
  z.object({...identity,action:z.literal('execution:close'),executionId:z.uuid()}).strict(),
  z.object({...identity,action:z.literal('execution:forget'),executionId:z.uuid()}).strict(),
  z.object({ ...identity, action: z.literal('session:connect'), payload: connectInputSchema }).strict(),
  z.object({ ...identity, action: z.literal('session:disconnect') }).strict(),
  z.object({ ...identity, action: z.literal('session:snapshot') }).strict(),
  z.object({ ...identity, action: z.literal('session:confirmOS') }).strict(),
  z.object({ ...identity, action: z.literal('file:list'), browserId: z.uuid(), path: remotePathSchema }).strict(),
  z.object({ ...identity, action: z.literal('file:page'), browserId: z.uuid(), snapshotId: z.uuid(), offset: z.int().min(0).max(10000) }).strict(),
  z.object({ ...identity, action: z.literal('file:close'), browserId: z.uuid() }).strict(),
  z.object({ ...identity, action:z.literal('mutation:inspect'), spec:mutationSpecSchema }).strict(),
  z.object({ ...identity, action:z.literal('mutation:prepare'), taskId:z.uuid(), spec:mutationSpecSchema, expected:initialStatSchema.nullable() }).strict(),
  z.object({ ...identity, action:z.literal('mutation:step'), taskId:z.uuid(), stage:z.enum(['first','remove_source']) }).strict(),
  z.object({ ...identity, action:z.literal('mutation:finish'), taskId:z.uuid(), keepRestriction:z.boolean() }).strict(),
  z.object({ ...identity, action:z.literal('viewer:open'), viewerId:z.uuid(), readGeneration:z.int().min(1), path:remotePathSchema, parent:remotePathSchema, kind:viewerReadKindSchema }).strict(),
  z.object({ ...identity, action:z.literal('viewer:next'), viewerId:z.uuid(), readGeneration:z.int().min(1), sequence:z.int().nonnegative() }).strict(),
  z.object({ ...identity, action:z.literal('viewer:cancel'), viewerId:z.uuid(), readGeneration:z.int().min(1) }).strict(),
  z.object({ ...identity,action:z.literal('transfer:inspect'),direction:z.enum(['upload','download']),path:remotePathSchema,parent:remotePathSchema }).strict(),
  z.object({ ...identity, action:z.literal('transfer:reserve'), reservationToken:z.uuid(),count:z.int().min(1).max(100) }).strict(),
  z.object({ ...identity, action:z.literal('transfer:stage'), reservationToken:z.uuid(),index:z.int().min(0).max(99),spec:stagedTransferSchema }).strict(),
  z.object({ ...identity, action:z.literal('transfer:commit'), reservationToken:z.uuid() }).strict(),
  z.object({ ...identity, action:z.literal('transfer:release'), reservationToken:z.uuid() }).strict(),
  z.object({ ...identity, action:z.literal('transfer:cancel'), taskId:z.uuid() }).strict(),
  z.object({ ...identity, action:z.literal('transfer:snapshot'), offset:z.int().min(0).max(10000) }).strict(),
  z.object({ ...identity, action:z.literal('transfer:acknowledge'), taskId:z.uuid() }).strict()
]);
export type EngineRequest = z.infer<typeof engineRequestSchema>;
export type EngineCommand = EngineRequest extends infer T ? T extends EngineRequest ? Omit<T, 'requestId' | 'backendEpoch'> : never : never;
export const engineEventSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('mutation_observation')}).extend(mutationObservationSchema.shape).strict(),
  z.object({type:z.literal('pty'),backendEpoch:z.uuid(),sequence:z.int().positive(),snapshot:terminalRuntimeSchema}).strict(),
  z.object({type:z.literal('execution'),backendEpoch:z.uuid(),sequence:z.int().positive(),snapshot:executionRuntimeSchema}).strict(),
  z.object({ type: z.literal('session'), backendEpoch: z.uuid(), sequence: z.int().positive(), snapshot: sessionSnapshotSchema }).strict(),
  z.object({type:z.literal('transfer'),backendEpoch:z.uuid(),sequence:z.int().positive(),snapshot:transferRuntimeSchema}).strict(),
  z.object({ type: z.literal('response'), ...identity, ok: z.boolean(), result: z.unknown().optional(), errorCode: z.string().max(64).optional() }).strict()
]);
export type EngineEvent = z.infer<typeof engineEventSchema>;
