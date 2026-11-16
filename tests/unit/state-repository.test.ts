import { afterEach, describe, expect, it,vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile,readFile } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {canonicalJSON} from '../../src/main/persistence/store';
import { resolve } from 'node:path';
import { StateRepository, normalizeHost } from '../../src/main/persistence/state-repository';
import { SecretVault } from '../../src/main/persistence/secrets';
const owned: string[] = [];
afterEach(async () => {vi.restoreAllMocks(); for (const path of owned.splice(0)) await rm(path, { recursive: true }); });
async function dataRoot() { await mkdir(resolve('.local/tmp'), { recursive: true }); const parent = await mkdtemp(resolve('.local/tmp/repo-')); owned.push(parent); return resolve(parent, 'data'); }
const draft = { name: '운영 서버', host: 'EXAMPLE.COM.', port: 22, username: 'ubuntu', authentication: 'password' as const };
describe('profile persistence and identity', () => {
  it.each([['dragonball','chocolate'],['doraemon','chocolate'],['league','fantasy']])('loads checksummed retired theme %s as %s without losing connection records',async(old,current)=>{
    const directory=await dataRoot(),repo=await StateRepository.open(directory),profile=await repo.create(draft),secretId=crypto.randomUUID();
    await repo.trust('example.com:22',Buffer.from('fixture-public-key'),'SHA256:fixture');
    await repo.store.update(state=>({...state!,profiles:[{...profile,secretId}],encryptedSecrets:[{id:secretId,profileId:profile.id,endpoint:'example.com:22',username:'fixture',ciphertext:'opaque-fixture'}],settings:{...state!.settings,showHiddenFiles:true}}));
    const previous=repo.snapshot(),path=resolve(directory,'state.json'),envelope=JSON.parse(await readFile(path,'utf8')) as {payload:{settings:{theme:string}};payloadSha256:string};
    envelope.payload.settings.theme=old!;envelope.payloadSha256=createHash('sha256').update(canonicalJSON(envelope.payload)).digest('hex');await writeFile(path,JSON.stringify(envelope));
    const reopened=await StateRepository.open(directory);
    expect(reopened.recovered).toBe(false);
    expect(reopened.snapshot()).toEqual({...previous,settings:{...previous.settings,theme:current}});
    await reopened.store.save(reopened.snapshot());
    const persisted=JSON.parse(await readFile(path,'utf8')) as typeof envelope;
    expect(persisted.payload.settings.theme).toBe(current);
    expect(persisted.payloadSha256).toBe(createHash('sha256').update(canonicalJSON(persisted.payload)).digest('hex'));
  });
  it.each(['clone','authentication','delete'])('rechecks profile busy state when a queued %s write actually executes',async operation=>{const repo=await StateRepository.open(await dataRoot()),profile=await repo.create(draft),native=repo.store.update.bind(repo.store);let busy=false,release!:()=>void;vi.spyOn(repo.store,'update').mockImplementationOnce(change=>new Promise<void>((resolve,reject)=>{release=()=>{void native(change).then(resolve,reject);};}));const pending=operation==='delete'?repo.remove(profile.id,()=>busy):repo.update(profile.id,operation==='clone'?{...draft,host:'other.test'}:{...draft,authentication:'key',keyPath:'/main-owned/key'},()=>busy),rejected=expect(pending).rejects.toThrow('PROFILE_BUSY');busy=true;release();await rejected;expect(repo.snapshot().profiles).toEqual([profile]);expect(repo.store.faulted).toBe(false);});
  it('normalizes DNS/IP and rejects URL/invalid hosts', () => {
    expect(normalizeHost(draft.host)).toBe('example.com'); expect(normalizeHost('[::1]')).toBe('::1');
    for (const value of ['https://host', 'user@host', 'bad host', '-bad.test', 'host/path','127.00.0.1','0x7f000001','127.1','127.0.0.1.','[example.com]','[127.0.0.1]']) expect(() => normalizeHost(value)).toThrow();
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
  it('refuses corrupt ciphertext, unavailability and invalid OS decrypt shapes without a fallback',async()=>{for(const value of ['', 'not-base64!']){let called=false;const vault=new SecretVault({isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async()=>Buffer.alloc(1),decryptStringAsync:async()=>{called=true;return {result:'secret',shouldReEncrypt:false};}});await expect(vault.decrypt(value,async()=>{})).rejects.toThrow('SECRET_UNAVAILABLE');expect(called).toBe(false);}for(const response of [{result:123,shouldReEncrypt:false},{result:'secret',shouldReEncrypt:'yes'}]){const vault=new SecretVault({isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async()=>Buffer.alloc(1),decryptStringAsync:async()=>response as never});await expect(vault.decrypt(Buffer.from('cipher').toString('base64'),async()=>{})).rejects.toThrow('SECRET_UNAVAILABLE');}const unavailable=new SecretVault({isAsyncEncryptionAvailable:async()=>false,encryptStringAsync:async()=>Buffer.alloc(1),decryptStringAsync:async()=>{throw new Error('unreachable');}});await expect(unavailable.decrypt('YQ==',async()=>{})).rejects.toThrow('SECRET_UNAVAILABLE');});
  it('uses a successful nonrotating result once and rejects encrypt/decrypt API errors as fixed codes',async()=>{let persisted=false;const vault=new SecretVault({isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async()=>{throw new Error('/private-key-path');},decryptStringAsync:async()=>({result:'volatile',shouldReEncrypt:false})});expect(await vault.decrypt('YQ==',async()=>{persisted=true;})).toBe('volatile');expect(persisted).toBe(false);await expect(vault.encrypt('secret')).rejects.toThrow(/^SECRET_UNAVAILABLE$/u);const failed=new SecretVault({isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async()=>Buffer.alloc(1),decryptStringAsync:async()=>{throw new Error('OS locked');}});await expect(failed.decrypt('YQ==',async()=>{})).rejects.toThrow(/^SECRET_UNAVAILABLE$/u);});
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

it('atomically clears secret ownership on authentication changes, preserves it on display edits and removes trust only after disconnect',async()=>{const repo=await StateRepository.open(await dataRoot()),profile=await repo.create(draft),secretId=crypto.randomUUID();await repo.store.update(state=>({...state!,profiles:[{...profile,secretId}],encryptedSecrets:[{id:secretId,profileId:profile.id,endpoint:'example.com:22',username:'ubuntu',ciphertext:'opaque'}]}));expect((await repo.update(profile.id,{...draft,name:'rename'},()=>false)).secretId).toBe(secretId);await repo.update(profile.id,{...draft,authentication:'key',keyPath:'/main-owned/key'},()=>false);expect(repo.snapshot().encryptedSecrets).toEqual([]);expect(repo.snapshot().profiles[0]?.secretId).toBeUndefined();await repo.trust('example.com:22',Buffer.from('public'),'SHA256:public');await expect(repo.removeTrust('example.com:22',false)).rejects.toThrow('PROFILE_BUSY');expect(repo.snapshot().hostTrust).toHaveLength(1);await repo.removeTrust('example.com:22',true);expect(repo.snapshot().hostTrust).toEqual([]);await expect(repo.update(crypto.randomUUID(),draft,()=>false)).rejects.toThrow('PROFILE_NOT_FOUND');await expect(repo.remove(profile.id,()=>true)).rejects.toThrow('PROFILE_BUSY');await repo.remove(profile.id,()=>false);expect(repo.snapshot().profiles).toEqual([]);});

it('retries verified storage and marks a recovered backup trust as untrusted before reuse',async()=>{const root=await dataRoot(),repo=await StateRepository.open(root);await repo.trust('example.com:22',Buffer.from('public-key'),'SHA256:public');await repo.create(draft);await writeFile(resolve(root,'state.json'),'{corrupted');await repo.retryStorage();expect(repo.snapshot().hostTrust[0]?.trusted).toBe(false);expect(repo.store.faulted).toBe(false);await repo.retryStorage();expect(repo.snapshot().hostTrust[0]?.trusted).toBe(false);});
