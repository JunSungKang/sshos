import { beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import { Client, Server, utils, type Connection, type ParsedKey, type AgentAuthMethod, type PasswordAuthMethod } from 'ssh2';
import { HostKeyVerifier } from '../../src/worker/connection/host-verifier';
import { SingleKeyAgent } from '../../src/worker/connection/single-key-agent';
import { oneShotAuthentication } from '../../src/worker/connection/authentication';
import { algorithms } from '../../src/worker/connection/algorithms';

function parse(pem: string): ParsedKey {
  const key = utils.parseKey(pem);
  if (key instanceof Error || Array.isArray(key)) throw new Error('Test fixture key invalid');
  return key;
}
let hostPEM: string;
let host: ParsedKey;
let identity: { privateKey: KeyObject; publicKey: KeyObject };
let identityParsed: ParsedKey;
beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  hostPEM = pair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(); host = parse(hostPEM);
  identity = generateKeyPairSync('rsa', { modulusLength: 2048 });
  identityParsed = parse(identity.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
});

async function fixture() {
  let authRequests = 0; const signedHashes: string[] = []; const connections = new Set<Connection>();
  const server = new Server({ hostKeys: [hostPEM] }, connection => {
    connections.add(connection);
    connection.on('error', () => {});
    connection.on('close', () => connections.delete(connection));
    connection.on('authentication', ctx => {
      authRequests++;
      if (ctx.method === 'password' && ctx.username === 'fixture' && ctx.password === 'test-only') { ctx.accept(); return; }
      if (ctx.method === 'publickey' && ctx.key.data.equals(identityParsed.getPublicSSH())) {
        if (!ctx.signature) { ctx.accept(); return; }
        const hash = ctx.hashAlgo ?? 'sha1'; signedHashes.push(hash);
        if (ctx.blob && ['sha256', 'sha512'].includes(hash) && verify(hash, ctx.blob, identity.publicKey, ctx.signature)) { ctx.accept(); return; }
      }
      ctx.reject(['password', 'publickey']);
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address(); if (typeof address !== 'object' || address === null) throw new Error('No fixture address');
  return {
    port: address.port,
    requests: () => authRequests,
    signedHashes,
    close: () => new Promise<void>(resolve => { for (const connection of connections) connection.end(); server.close(() => resolve()); })
  };
}

async function connect(port: number, verifier: HostKeyVerifier, method: PasswordAuthMethod | AgentAuthMethod) {
  const client = new Client();
  return new Promise<boolean>((resolve, reject) => {
    let complete = false;
    const timeout = setTimeout(() => { client.destroy(); reject(new Error('Fixture timeout')); }, 3000);
    const finish = (ready: boolean) => { if (complete) return; complete = true; clearTimeout(timeout); client.end(); resolve(ready); };
    client.on('ready', () => finish(true)); client.on('error', () => finish(false)); client.on('close', () => finish(false));
    client.connect({ host: '127.0.0.1', port, username: 'fixture', readyTimeout: 2000, hostVerifier: verifier.verify, authHandler: oneShotAuthentication(method), algorithms });
  });
}

describe('real loopback SSH handshake (not an Ubuntu/OpenSSH target result)', () => {
  it('sends no authentication request before unknown-host trust approval', async () => {
    const remote = await fixture(); const verifier = new HostKeyVerifier(null);
    try {
      expect(await connect(remote.port, verifier, { type: 'password', username: 'fixture', password: 'test-only' })).toBe(false);
      expect(remote.requests()).toBe(0);
      expect(verifier.observation()?.publicKey.equals(host.getPublicSSH())).toBe(true);
    } finally { await remote.close(); }
  });
  it('allows a fresh connection with the approved exact host key', async () => {
    const remote = await fixture();
    try {
      expect(await connect(remote.port, new HostKeyVerifier(host.getPublicSSH()), { type: 'password', username: 'fixture', password: 'test-only' })).toBe(true);
      expect(remote.requests()).toBe(1);
    } finally { await remote.close(); }
  });
  it('blocks a changed host key before authentication', async () => {
    const remote = await fixture();
    try {
      expect(await connect(remote.port, new HostKeyVerifier(identityParsed.getPublicSSH()), { type: 'password', username: 'fixture', password: 'test-only' })).toBe(false);
      expect(remote.requests()).toBe(0);
    } finally { await remote.close(); }
  });
  it('authenticates via the in-process RSA agent without a SHA-1 signature', async () => {
    const remote = await fixture();
    const agent = new SingleKeyAgent(identity.privateKey, `ssh-rsa ${identityParsed.getPublicSSH().toString('base64')}`);
    try {
      expect(await connect(remote.port, new HostKeyVerifier(host.getPublicSSH()), { type: 'agent', username: 'fixture', agent })).toBe(true);
      expect(remote.signedHashes.length).toBeGreaterThan(0);
      expect(remote.signedHashes.every(hash => hash === 'sha256' || hash === 'sha512')).toBe(true);
    } finally { agent.dispose(); await remote.close(); }
  });
  it('does not retry a rejected password or fall back to other methods', async () => {
    const remote = await fixture();
    try {
      expect(await connect(remote.port, new HostKeyVerifier(host.getPublicSSH()), { type: 'password', username: 'fixture', password: 'wrong-test-value' })).toBe(false);
      expect(remote.requests()).toBe(1);
    } finally { await remote.close(); }
  });
});
