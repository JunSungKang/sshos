import { z } from 'zod';
import { connectInputSchema, sessionSnapshotSchema } from './session-contracts';
const identity = { requestId: z.uuid(), backendEpoch: z.uuid(), serverId: z.uuid(), generation: z.int().min(1) };
export const engineRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...identity, action: z.literal('session:connect'), payload: connectInputSchema }).strict(),
  z.object({ ...identity, action: z.literal('session:disconnect') }).strict(),
  z.object({ ...identity, action: z.literal('session:snapshot') }).strict(),
  z.object({ ...identity, action: z.literal('session:confirmOS') }).strict()
]);
export type EngineRequest = z.infer<typeof engineRequestSchema>;
export type EngineCommand = EngineRequest extends infer T ? T extends EngineRequest ? Omit<T, 'requestId' | 'backendEpoch'> : never : never;
export const engineEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), backendEpoch: z.uuid(), sequence: z.int().positive(), snapshot: sessionSnapshotSchema }).strict(),
  z.object({ type: z.literal('response'), ...identity, ok: z.boolean(), result: z.unknown().optional(), errorCode: z.string().max(64).optional() }).strict()
]);
export type EngineEvent = z.infer<typeof engineEventSchema>;
