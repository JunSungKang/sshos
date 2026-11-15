import { z } from 'zod';
const identity={requestId:z.uuid(),backendEpoch:z.uuid()};
export const recoveryRequestSchema=z.discriminatedUnion('action',[
  z.object({...identity,action:z.literal('storage:barrier'),faulted:z.boolean()}).strict(),
  z.object({...identity,action:z.literal('storage:reset'),barrierToken:z.uuid()}).strict()
]);
export const recoveryResponseSchema=z.object({...identity,type:z.literal('storage:response'),ok:z.boolean(),barrierToken:z.uuid().nullable(),errorCode:z.enum(['REQUEST_BUSY','STORAGE_FAILED','TOKEN_EXPIRED']).nullable()}).strict();
export type RecoveryRequest=z.infer<typeof recoveryRequestSchema>;
export type RecoveryResponse=z.infer<typeof recoveryResponseSchema>;
