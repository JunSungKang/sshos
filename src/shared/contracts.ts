import { z } from 'zod';

export const runtimeSnapshotSchema = z.object({
  backendEpoch: z.uuid(),
  engine: z.enum(['starting', 'ready', 'stopped']),
  connectedServers: z.literal(0),
  appVersion: z.string().max(32),
  versions: z.object({ electron: z.string(), node: z.string(), chrome: z.string() }).strict()
}).strict();
export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>;

export const workerEventSchema = z.object({
  type: z.literal('ready'), backendEpoch: z.uuid(), sshLibrary: z.literal('ssh2')
}).strict();

export interface DesktopBridge {
  lifecycle: { getSnapshot(): Promise<RuntimeSnapshot> };
}
