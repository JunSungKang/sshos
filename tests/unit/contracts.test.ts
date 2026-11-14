import { expect, it } from 'vitest';
import { runtimeSnapshotSchema, workerEventSchema } from '../../src/shared/contracts';
const epoch = '5c3416b0-fc22-4394-b1c2-563513bc0687';
it('rejects unrecognized worker messages, epochs and hidden payloads', () => {
  expect(workerEventSchema.safeParse({ type: 'ready', backendEpoch: epoch, sshLibrary: 'ssh2' }).success).toBe(true);
  expect(workerEventSchema.safeParse({ type: 'exec', backendEpoch: epoch, sshLibrary: 'ssh2' }).success).toBe(false);
  expect(workerEventSchema.safeParse({ type: 'ready', backendEpoch: 'bad', sshLibrary: 'ssh2' }).success).toBe(false);
  expect(workerEventSchema.safeParse({ type: 'ready', backendEpoch: epoch, sshLibrary: 'ssh2', command: 'anything' }).success).toBe(false);
});
it('does not accept secrets or fabricated connected servers in foundation snapshots', () => {
  const valid = { backendEpoch: epoch, engine: 'ready', connectedServers: 0, appVersion: '0.1.0', versions: { electron: '45', node: '24', chrome: '145' } };
  expect(runtimeSnapshotSchema.safeParse(valid).success).toBe(true);
  expect(runtimeSnapshotSchema.safeParse({ ...valid, connectedServers: 1 }).success).toBe(false);
  expect(runtimeSnapshotSchema.safeParse({ ...valid, password: 'sentinel' }).success).toBe(false);
});
