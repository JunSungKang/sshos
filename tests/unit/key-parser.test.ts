import { fixtureKey } from '../../scripts/fixtures/keys.mjs';
import { describe, expect, it } from 'vitest';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { utils } from 'ssh2';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { inspectPrivateKey } from '../../src/worker/connection/key-policy';
// Exercise the compiled worker entrypoint rather than replacing it with a mock.
const require = createRequire(import.meta.url);
const { PrivateKeyParser } = require(resolve('dist/worker/connection/key-parser.js')) as typeof import('../../src/worker/connection/key-parser');

describe('bounded isolated key parsing', () => {
  it('parses encrypted and unencrypted supported keys in a real worker', async () => {
    const parser = new PrivateKeyParser();
    for (const encrypted of [false, true]) {
      const key = fixtureKey( encrypted ? { passphrase: 'fixture-only', cipher: 'aes256-ctr', rounds: 1 } : {});
      const result = await parser.parse(Buffer.from(key.private), encrypted ? 'fixture-only' : undefined);
      expect(createPrivateKey(result.privatePEM).asymmetricKeyType).toBe('ed25519');
      expect(result.publicSSH).toBe(key.public.split(' ').slice(0, 2).join(' '));
    }
  });
  it('supports PKCS1 RSA and refuses weak keys, raw PKCS8 and wrong passphrase', async () => {
    const parser = new PrivateKeyParser();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(createPrivateKey((await parser.parse(Buffer.from(rsa.privateKey.export({ type: 'pkcs1', format: 'pem' })))).privatePEM).asymmetricKeyType).toBe('rsa');
    await expect(parser.parse(Buffer.from(rsa.privateKey.export({ type: 'pkcs8', format: 'pem' })))).rejects.toThrow('AUTH_UNSUPPORTED');
    const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
    await expect(parser.parse(Buffer.from(weak.privateKey.export({ type: 'pkcs1', format: 'pem' })))).rejects.toThrow('KEY_INVALID');
    const encrypted = fixtureKey( { passphrase: 'fixture-only', cipher: 'aes256-ctr', rounds: 1 });
    await expect(parser.parse(Buffer.from(encrypted.private), 'wrong-fixture')).rejects.toThrow('KEY_INVALID');
  });
  it('rejects oversize/concurrent requests without allowing unbounded parser threads', async () => {
    const parser = new PrivateKeyParser();
    await expect(parser.parse(Buffer.alloc(512 * 1024 + 1))).rejects.toThrow('KEY_INVALID');
    const key = fixtureKey();
    const first = parser.parse(Buffer.from(key.private));
    await expect(parser.parse(Buffer.from(key.private))).rejects.toThrow('KEY_INVALID');
    await first;
  });
  it('rejects malformed or excessive bcrypt work before decryption', () => {
    expect(() => inspectPrivateKey(Buffer.from('not a key'))).toThrow();
    const key = fixtureKey( { passphrase: 'fixture-only', cipher: 'aes256-ctr', rounds: 1 });
    const binary = Buffer.from(key.private.split('\n').slice(1, -2).join(''), 'base64');
    let offset = Buffer.byteLength('openssh-key-v1\0');
    for (let i = 0; i < 2; i++) { const size = binary.readUInt32BE(offset); offset += 4 + size; }
    const optionsSize = binary.readUInt32BE(offset); offset += 4;
    binary.writeUInt32BE(101, offset + optionsSize - 4);
    const tampered = `-----BEGIN OPENSSH PRIVATE KEY-----\n${binary.toString('base64')}\n-----END OPENSSH PRIVATE KEY-----`;
    expect(() => inspectPrivateKey(Buffer.from(tampered))).toThrow('KEY_INVALID');
  });
});
