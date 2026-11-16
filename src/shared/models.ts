import { z } from 'zod';
import {themeIdSchema} from './themes';

const bytes = (max: number) => z.string().refine(s => new TextEncoder().encode(s).length <= max, 'INPUT_INVALID');
const scalarName = z.string().refine(s => Array.from(s).length >= 1 && Array.from(s).length <= 64 && !/[\u0000-\u001f\u007f]/u.test(s), 'INPUT_INVALID');
export const profileInputSchema = z.object({
  name: scalarName, host: bytes(253).refine(s => s.length > 0), port: z.int().min(1).max(65535),
  username: bytes(256).refine(s => s.length > 0 && !/[\u0000-\u001f\u007f]/u.test(s)),
  authentication: z.enum(['password', 'key']), keyPath: bytes(4096).optional(), secretId: z.uuid().optional()
}).strict();
export const profileSchema = profileInputSchema.extend({ id: z.uuid() }).strict();
export type Profile = z.infer<typeof profileSchema>;
export type ProfileInput = z.infer<typeof profileInputSchema>;
export const profileDraftSchema = profileInputSchema.omit({ keyPath: true, secretId: true }).extend({ keyToken: z.uuid().optional() }).strict();
export type ProfileDraft = z.infer<typeof profileDraftSchema>;
export const profileViewSchema = profileInputSchema.omit({ keyPath: true, secretId: true }).extend({ id: z.uuid(), keyFilename: z.string().max(4096).nullable(), hasSavedSecret: z.boolean() }).strict();
export type ProfileView = z.infer<typeof profileViewSchema>;
export const hostTrustSchema = z.object({ endpoint: bytes(300), publicKey: z.string().min(1).max(65536), fingerprint: z.string().max(128), trusted: z.boolean(), approvedAt: z.iso.datetime() }).strict();
export const secretSchema = z.object({ id: z.uuid(), profileId: z.uuid(), endpoint: bytes(300), username: bytes(256), ciphertext: z.string().min(1).max(16384) }).strict();
export const stateSchema = z.object({
  profiles: z.array(profileSchema).max(10), hostTrust: z.array(hostTrustSchema).max(100),
  encryptedSecrets: z.array(secretSchema).max(20), settings: z.object({ language: z.literal('ko'), saveSecrets: z.boolean(), showHiddenFiles: z.boolean().default(false),theme:themeIdSchema.default('chocolate') }).strict()
}).strict();
export type AppState = z.infer<typeof stateSchema>;
export const initialState = (): AppState => ({ profiles: [], hostTrust: [], encryptedSecrets: [], settings: { language: 'ko', saveSecrets: false, showHiddenFiles: false,theme:'chocolate' } });
