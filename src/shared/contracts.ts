import { z } from 'zod';
import type { ProfileDraft, ProfileView } from './models';

export const runtimeSnapshotSchema = z.object({
  backendEpoch: z.uuid(),
  engine: z.enum(['starting', 'ready', 'stopped']),
  connectedServers: z.literal(0),
  storage: z.object({ status: z.enum(['ready', 'recovered', 'unavailable']), path: z.string().max(4096) }).strict(),
  appVersion: z.string().max(32),
  versions: z.object({ electron: z.string(), node: z.string(), chrome: z.string() }).strict()
}).strict();
export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>;

export const workerEventSchema = z.object({
  type: z.literal('ready'), backendEpoch: z.uuid(), sshLibrary: z.literal('ssh2')
}).strict();

export interface DesktopBridge {
  lifecycle: { getSnapshot(): Promise<RuntimeSnapshot> };
  profile: {
    list(): Promise<ProfileView[]>;
    create(input: ProfileDraft): Promise<ProfileView>;
    update(id: string, input: ProfileDraft): Promise<ProfileView>;
    delete(id: string): Promise<void>;
    pickKey(): Promise<{ token: string; filename: string } | null>;
  };
  settings: { retryStorage(): Promise<void> };
}
