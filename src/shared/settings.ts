import { z } from 'zod';
export const settingsViewSchema=z.object({
 language:z.literal('ko'),saveSecrets:z.boolean(),
 hostTrust:z.array(z.object({endpoint:z.string().max(300),fingerprint:z.string().max(128),trusted:z.boolean(),approvedAt:z.iso.datetime()}).strict()).max(100),
 savedSecrets:z.array(z.object({profileId:z.uuid(),name:z.string().max(128),endpoint:z.string().max(300),username:z.string().max(256),authentication:z.enum(['password','key'])}).strict()).max(10)
}).strict();
export type SettingsView=z.infer<typeof settingsViewSchema>;
