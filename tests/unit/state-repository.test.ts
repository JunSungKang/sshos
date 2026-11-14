import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { StateRepository, normalizeHost } from '../../src/main/persistence/state-repository';
import { SecretVault } from '../../src/main/persistence/secrets';
const owned: string[] = [];
afterEach(async () => { for (const path of owned.splice(0)) await rm(path, { recursive: true }); });
async function dataRoot() { await mkdir(resolve('.local/tmp'), { recursive: true }); const parent = await mkdtemp(resolve('.local/tmp/repo-')); owned.push(parent); return resolve(parent, 'data'); }
const draft = { name: '운영 서버', host: 'EXAMPLE.COM.', port: 22, username: 'ubuntu', authentication: 'password' as const };
describe('profile persistence and identity', () => {
  it('normalizes DNS/IP and rejects URL/invalid hosts', () => {
    expect(normalizeHost(draft.host)).toBe('example.com'); expect(normalizeHost('[::1]')).toBe('::1');
    for (const value of ['https://host', 'user@host', 'bad host', '-bad.test', 'host/path']) expect(() => normalizeHost(value)).toThrow();
  });
  it('preserves original identity when endpoint changes and blocks live changes', async () => {
    const root = await dataRoot(); const repo = await StateRepository.open(root); const first = await repo.create(draft);
    const second = await repo.update(first.id, { ...draft, host: 'other.test' }, () => false);
    expect(second.id).not.toBe(first.id); expect(repo.snapshot().profiles).toHaveLength(2);
    await expect(repo.update(first.id, { ...draft, host: 'third.test' }, () => true)).rejects.toThrow('PROFILE_BUSY');
    expect((await StateRepository.open(root)).snapshot().profiles).toHaveLength(2);
  });
  it('does not silently initialize an old empty/corrupt directory', async () => {
    const root = await dataRoot(); await mkdir(root);
    await expect(StateRepository.open(root)).rejects.toThrow('STORAGE_FAILED');
  });
  it('enforces profile count without permanently faulting valid storage', async () => {
    const repo = await StateRepository.open(await dataRoot());
    for (let i = 0; i < 10; i++) await repo.create({ ...draft, name: `서버${i}` });
    await expect(repo.create(draft)).rejects.toThrow('PROFILE_LIMIT');
    expect(repo.store.faulted).toBe(false);
    await repo.remove(repo.snapshot().profiles[0]!.id, () => false);
    await repo.create(draft); expect(repo.snapshot().profiles).toHaveLength(10);
  });
  it('requires renewed host trust after loading a backup', async () => {
    const root = await dataRoot(); const repo = await StateRepository.open(root);
    await repo.trust('example.com:22', Buffer.from('public-key-fixture'), 'SHA256:fixture');
    await repo.create(draft); await writeFile(resolve(root, 'state.json'), '{corrupted');
    const recovered = await StateRepository.open(root);
    expect(recovered.recovered).toBe(true); expect(recovered.snapshot().hostTrust[0]?.trusted).toBe(false);
  });
});
describe('secret encryption boundary', () => {
  it('does not use plaintext fallback on unavailable OS encryption', async () => {
    let encryptCalls = 0;
    const vault = new SecretVault({ isAsyncEncryptionAvailable: async () => false, encryptStringAsync: async () => { encryptCalls++; return Buffer.alloc(0); }, decryptStringAsync: async () => { throw new Error(); } });
    await expect(vault.encrypt('fixture')).rejects.toThrow('SECRET_UNAVAILABLE'); expect(encryptCalls).toBe(0);
  });
  it('persists key rotation before releasing the decrypted result', async () => {
    const order: string[] = [];
    const vault = new SecretVault({ isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async () => Buffer.from('ciphertext'), decryptStringAsync: async () => ({ result: 'fixture-only', shouldReEncrypt: true }) });
    expect(await vault.decrypt(Buffer.from('old').toString('base64'), async () => { order.push('saved'); })).toBe('fixture-only'); expect(order).toEqual(['saved']);
    await expect(vault.decrypt(Buffer.from('old').toString('base64'), async () => { throw new Error('disk full'); })).rejects.toThrow('STORAGE_FAILED');
  });
});
