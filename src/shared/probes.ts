import { z } from 'zod';
export const probeIdentitySchema=z.object({serverId:z.uuid(),sessionGeneration:z.int().positive(),backendEpoch:z.uuid(),probeEpoch:z.uuid(),probeId:z.uuid(),transferActive:z.boolean()}).strict();
export type ProbeIdentity=z.infer<typeof probeIdentitySchema>;
export const probeResultSchema=probeIdentitySchema.extend({status:z.enum(['sample','delayed','unavailable','waiting','paused']),elapsedMs:z.number().finite().min(0).max(5000).nullable(),measuredAt:z.iso.datetime().nullable()}).strict().refine(row=>row.status==='sample' ? row.elapsedMs!==null && row.measuredAt!==null:row.elapsedMs===null && row.measuredAt===null);
export type ProbeResult=z.infer<typeof probeResultSchema>;
export const probeViewSchema=z.object({serverId:z.uuid().nullable(),generation:z.int().positive().nullable(),status:z.enum(['idle','measuring','sample','delayed','unavailable','waiting','paused','disconnected']),sample:probeResultSchema.nullable()}).strict();
export type ProbeView=z.infer<typeof probeViewSchema>;
