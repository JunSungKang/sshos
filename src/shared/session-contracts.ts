import { z } from 'zod';
const status = z.enum(['idle', 'connecting', 'authenticating', 'connected', 'awaiting_host_trust', 'disconnecting', 'disconnected', 'failed']);
export const sessionSnapshotSchema = z.object({
  serverId: z.uuid(), generation: z.int().min(1), status,
  os: z.enum(['unknown', 'supported', 'unsupported']), osConfirmed: z.boolean(),
  homePath:z.string().max(4096).nullable().optional(),
  sftp: z.enum(['unknown', 'available', 'unavailable']), initialPath: z.string().max(4096).nullable(), errorCode: z.string().max(64).nullable()
}).strict();
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;
const credential = z.string().refine(value => new TextEncoder().encode(value).length <= 1024);
export const connectInputSchema = z.object({
  host: z.string().max(253), port: z.int().min(1).max(65535), username: z.string().max(256),
  authentication: z.enum(['password', 'key']), password: credential.optional(), passphrase: credential.optional(),
  keyBytes: z.instanceof(Uint8Array).refine(value => value.length <= 512 * 1024).optional(),
  trustedHostKey: z.string().max(65536).nullable()
}).strict();
export type ConnectInput = z.infer<typeof connectInputSchema>;
export const connectOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('connected'), snapshot: sessionSnapshotSchema }).strict(),
  z.object({ status: z.literal('awaiting_host_trust'), publicKey: z.string().max(65536), fingerprint: z.string().max(128) }).strict()
]);
export type ConnectOutcome = z.infer<typeof connectOutcomeSchema>;
export const sessionViewSchema = sessionSnapshotSchema.extend({ serverName: z.string().max(256), host: z.string().max(253), port: z.int(), username: z.string().max(256), sessionToken: z.uuid().nullable() }).strict();
export type SessionView = z.infer<typeof sessionViewSchema>;
export const hostChallengeSchema = z.object({ challengeId: z.uuid(), serverId: z.uuid(), generation: z.int().min(1), endpoint: z.string().max(300), fingerprint: z.string().max(128), expiresAt: z.string().max(64) }).strict();
export type HostChallenge = z.infer<typeof hostChallengeSchema>;
export const sessionCredentialsSchema = z.object({ password: credential.optional(), passphrase: credential.optional(), saveSecret: z.boolean() }).strict();
export type SessionCredentials = z.infer<typeof sessionCredentialsSchema>;
