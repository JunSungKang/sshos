import { beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync, createPrivateKey, verify } from 'node:crypto';
import { utils, type ParsedKey } from 'ssh2';
import { SingleKeyAgent } from '../../src/worker/connection/single-key-agent';
import { HostKeyVerifier } from '../../src/worker/connection/host-verifier';
import { oneShotAuthentication } from '../../src/worker/connection/authentication';

let rsa: ReturnType<typeof generateKeyPairSync<'rsa'>>;
let rsaPublic: ParsedKey;
function parse(key: string): ParsedKey {
  const result = utils.parseKey(key);
  if (result instanceof Error || Array.isArray(result)) throw new Error('Fixture key failed');
  return result;
}
beforeAll(() => {
  rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  rsaPublic = parse(rsa.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
});
function signer() { return new SingleKeyAgent(rsa.privateKey, `ssh-rsa ${rsaPublic.getPublicSSH().toString('base64')}`); }

describe('single-key signing boundary', () => {
  it.each(['sha256', 'sha512'] as const)('signs valid RSA data with %s', async hash => {
    const agent = signer();
    const message = Buffer.from('authentication exchange');
    const signature = await new Promise<Buffer>((resolve, reject) => agent.sign(rsaPublic, message, { hash }, (error, value) => error || !value ? reject(error) : resolve(value)));
    expect(verify(hash, message, rsa.publicKey, signature)).toBe(true);
    agent.dispose();
  });
  it.each(['sha1', undefined, 'md5'])('refuses RSA hash %s without a signature', async hash => {
    const agent = signer(); let calls = 0;
    await new Promise<void>(resolve => agent.sign(rsaPublic, Buffer.from('data'), { hash } as never, (error, signature) => {
      calls++; expect(error?.message).toBe('SIGNING_DENIED'); expect(signature).toBeUndefined(); resolve();
    }));
    expect(calls).toBe(1); agent.dispose();
  });
  it('refuses a key from another identity and refuses use after disposal', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const different = parse(other.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
    const agent = signer();
    const attempt = (key: ParsedKey) => new Promise<Error | null | undefined>(resolve => agent.sign(key, Buffer.from('data'), { hash: 'sha256' }, error => resolve(error)));
    expect(await attempt(different)).toBeInstanceOf(Error);
    agent.dispose(); expect(await attempt(rsaPublic)).toBeInstanceOf(Error);
  });
  it('returns only a public identity and rejects private/public mismatch and weak RSA', () => {
    const agent = signer();
    agent.getIdentities((error, keys) => { expect(error).toBeNull(); expect(keys).toHaveLength(1); expect((keys?.[0] as ParsedKey).isPrivateKey()).toBe(false); });
    const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
    expect(() => new SingleKeyAgent(weak.privateKey, `ssh-rsa ${rsaPublic.getPublicSSH().toString('base64')}`)).toThrow('KEY_INVALID');
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => new SingleKeyAgent(other.privateKey, `ssh-rsa ${rsaPublic.getPublicSSH().toString('base64')}`)).toThrow('KEY_INVALID');
    agent.dispose();
  });
  it('does not deliver a pending signature after the session disposes its key', async () => {
    const agent = signer();
    const result = new Promise<void>(resolve => agent.sign(rsaPublic, Buffer.from('data'), { hash: 'sha256' }, (error, signature) => {
      expect(error?.message).toBe('KEY_UNAVAILABLE'); expect(signature).toBeUndefined(); resolve();
    }));
    agent.dispose(); await result;
  });
  it('signs Ed25519 using the raw selected public key', async () => {
    const pair = generateKeyPairSync('ed25519');
    const jwk = pair.publicKey.export({ format: 'jwk' });
    if (!jwk.x) throw new Error('Fixture JWK lacks x');
    const type = Buffer.from('ssh-ed25519'); const key = Buffer.from(jwk.x, 'base64url');
    const blob = Buffer.alloc(4 + type.length + 4 + key.length);
    blob.writeUInt32BE(type.length, 0); type.copy(blob, 4); blob.writeUInt32BE(key.length, 4 + type.length); key.copy(blob, 8 + type.length);
    const identity = parse(`ssh-ed25519 ${blob.toString('base64')}`);
    const agent = new SingleKeyAgent(createPrivateKey(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })), `ssh-ed25519 ${blob.toString('base64')}`);
    const message = Buffer.from('signed data');
    const signature = await new Promise<Buffer>((resolve, reject) => agent.sign(identity, message, (error, value) => error || !value ? reject(error) : resolve(value)));
    expect(verify(null, message, pair.publicKey, signature)).toBe(true); agent.dispose();
  });
});

describe('host trust gate', () => {
  it('captures but rejects an unknown key and uses a full SHA256 fingerprint', () => {
    const verifier = new HostKeyVerifier(null); const blob = rsaPublic.getPublicSSH();
    expect(verifier.verify(blob)).toBe(false); expect(verifier.observation()?.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    const copy = verifier.observation()!; copy.publicKey.fill(0);
    expect(verifier.observation()?.publicKey.equals(blob)).toBe(true);
  });
  it('requires exact bytes even if callers mutate the stored-key buffer', () => {
    const blob = Buffer.from(rsaPublic.getPublicSSH()); const verifier = new HostKeyVerifier(blob); blob.fill(0);
    expect(verifier.verify(rsaPublic.getPublicSSH())).toBe(true);
    expect(verifier.verify(Buffer.concat([rsaPublic.getPublicSSH(), Buffer.from([0])]))).toBe(false);
    expect(verifier.verify(Buffer.alloc(0))).toBe(false);
  });
});

it('offers only the chosen authentication method once and never falls back', () => {
  const chosen = { type: 'password' as const, username: 'fixture', password: 'test-only' };
  const handler = oneShotAuthentication(chosen);
  expect(handler()).toBe(chosen); expect(handler()).toBe(false); expect(handler()).toBe(false);
});


it('does not expose disposed identities, accept malformed sign requests or forward unexpected signing exceptions',async()=>{const agent=signer();let called=false;agent.sign(rsaPublic,Buffer.from('x'),{hash:'sha256'});agent.sign({getPublicSSH:()=>{throw new Error('untrusted object');}} as ParsedKey,Buffer.from('x'),error=>{called=true;expect(error?.message).toBe('SIGNING_DENIED');});expect(called).toBe(true);await new Promise<void>(done=>agent.sign(rsaPublic,'not bytes' as never,{hash:'sha256'},error=>{expect(error?.message).toBe('SIGNING_DENIED');done();}));agent.dispose();agent.getIdentities((error,keys)=>{expect(error?.message).toBe('KEY_UNAVAILABLE');expect(keys).toBeUndefined();});});
