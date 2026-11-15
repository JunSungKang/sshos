import { Client, type SFTPWrapper } from 'ssh2';
import { createPrivateKey } from 'node:crypto';
import { type ConnectInput, type ConnectOutcome, type SessionSnapshot } from '../../shared/session-contracts';
import { HostKeyVerifier } from './host-verifier';
import { SingleKeyAgent } from './single-key-agent';
import { oneShotAuthentication } from './authentication';
import { algorithms } from './algorithms';
import { PrivateKeyParser } from './key-parser';
import { identifyOS } from './os-release';
import type { ControlAccess } from '../files/browser';
import { AuxiliarySockets, type AuxiliaryRole, type AuxiliaryLease } from './auxiliary-sockets';

interface RecordEntry {
  snapshot: SessionSnapshot; client: Client; sftp: SFTPWrapper | null; input: ConnectInput; agent: SingleKeyAgent | null;auxiliary:AuxiliarySockets|null;
}
export class SessionManager {
  private readonly entries = new Map<string, RecordEntry>();
  private readonly parser = new PrivateKeyParser();
  constructor(private readonly emit: (snapshot: SessionSnapshot) => void) {}
  snapshots(): SessionSnapshot[] { return [...this.entries.values()].map(entry => ({ ...entry.snapshot })); }
  auxiliary(serverId:string,generation:number,role:AuxiliaryRole):AuxiliaryLease {
    const entry=this.entries.get(serverId);
    const check=() => {
      if (!entry || this.entries.get(serverId) !== entry || entry.snapshot.generation !== generation || entry.snapshot.status !== 'connected') throw new Error('CONNECTION_LOST');
      if (entry.snapshot.os !== 'supported' && !(entry.snapshot.os === 'unknown' && entry.snapshot.osConfirmed)) throw new Error(entry.snapshot.os === 'unknown' ? 'OS_UNKNOWN' : 'OS_UNSUPPORTED');
    };
    check();if (!entry) throw new Error('CONNECTION_LOST');
    entry.auxiliary ??=new AuxiliarySockets(() => ({input:entry.input,agent:entry.agent,check}));return entry.auxiliary.open(role);
  }
  readClient(serverId:string,generation:number):Client {
    const entry=this.entries.get(serverId);
    if (!entry || entry.snapshot.generation !== generation || entry.snapshot.status !== 'connected' || entry.snapshot.sftp !== 'available') throw new Error('CONNECTION_LOST');return entry.client;
  }
  control(serverId: string, generation: number, write=false): ControlAccess {
    const entry = this.entries.get(serverId);
    if (!entry || entry.snapshot.generation !== generation || entry.snapshot.status !== 'connected' || !entry.sftp) throw new Error('SESSION_UNAVAILABLE');
    if (write && entry.snapshot.os !== 'supported' && !entry.snapshot.osConfirmed) throw new Error(entry.snapshot.os === 'unknown' ? 'OS_UNKNOWN' : 'OS_UNSUPPORTED');
    return { sftp: entry.sftp, check: () => {
      if (this.entries.get(serverId) !== entry || entry.snapshot.generation !== generation || entry.snapshot.status !== 'connected' || !entry.sftp) throw new Error('CONNECTION_LOST');
    }, quarantine: () => {
      this.changed(entry, { status: 'failed', errorCode: 'IO_TIMEOUT' }); entry.client.destroy(); this.release(entry);
    } };
  }
  private changed(entry: RecordEntry, values: Partial<SessionSnapshot>): void {
    if (this.entries.get(entry.snapshot.serverId) !== entry) return;
    Object.assign(entry.snapshot, values); this.emit({ ...entry.snapshot });
  }
  async connect(serverId: string, generation: number, input: ConnectInput): Promise<ConnectOutcome> {
    if (this.entries.has(serverId) && !['failed', 'disconnected', 'awaiting_host_trust'].includes(this.entries.get(serverId)!.snapshot.status)) throw new Error('SESSION_BUSY');
    const active = [...this.entries.values()].filter(entry => entry.snapshot.serverId !== serverId && !['disconnected', 'failed'].includes(entry.snapshot.status));
    if (active.length >= 3) throw new Error('SESSION_LIMIT');
    this.disconnect(serverId);
    for (const [id, existing] of this.entries) {
      if (this.entries.size < 10) break;
      if (id !== serverId && ['failed', 'disconnected'].includes(existing.snapshot.status)) this.entries.delete(id);
    }
    const client = new Client();
    const verifier = new HostKeyVerifier(input.trustedHostKey === null ? null : Buffer.from(input.trustedHostKey, 'base64'));
    const entry: RecordEntry = { snapshot: { serverId, generation, status: 'connecting', os: 'unknown', osConfirmed: false, sftp: 'unknown', initialPath: null, errorCode: null }, client, sftp: null, input, agent: null,auxiliary:null };
    this.entries.set(serverId, entry); this.changed(entry, {});
    let method: Parameters<typeof oneShotAuthentication>[0];
    try {
      if (input.authentication === 'key') {
        if (!input.keyBytes) throw new Error('KEY_INVALID');
        const parsed = await this.parser.parse(Buffer.from(input.keyBytes), input.passphrase);
        if (this.entries.get(serverId) !== entry || entry.snapshot.status !== 'connecting') throw new Error('CONNECTION_LOST');
        entry.agent = new SingleKeyAgent(createPrivateKey(parsed.privatePEM), parsed.publicSSH);
        input.keyBytes?.fill(0);delete input.keyBytes;delete input.passphrase;
        method = { type: 'agent', username: input.username, agent: entry.agent };
      } else {
        if (input.password === undefined) throw new Error('INPUT_INVALID');
        method = { type: 'password', username: input.username, password: input.password };
      }
    } catch (error) { this.changed(entry, { status: 'failed', errorCode: error instanceof Error ? error.message : 'KEY_INVALID' }); this.release(entry); throw error; }
    return new Promise<ConnectOutcome>((resolve, reject) => {
      let settled = false;
      const finish = (error: string | null, value?: ConnectOutcome) => {
        if (settled) return; settled = true;
        if (error || !value) reject(new Error(error ?? 'CONNECTION_LOST')); else resolve(value);
      };
      client.on('handshake', () => { if (entry.snapshot.status === 'connecting') this.changed(entry, { status: 'authenticating' }); });
      client.on('ready', () => {
        this.changed(entry, { status: 'connected', errorCode: null });
        void this.inspect(entry).then(() => finish(null, { status: 'connected', snapshot: { ...entry.snapshot } })).catch(() => {
          this.changed(entry, { status: 'failed', errorCode: 'IO_TIMEOUT' }); client.destroy(); finish('IO_TIMEOUT');
        });
      });
      client.on('error', (error: Error & { level?: string }) => {
        const observed = verifier.observation();
        if (observed && input.trustedHostKey === null) {
          this.changed(entry, { status: 'awaiting_host_trust', errorCode: null });
          this.release(entry);
          finish(null, { status: 'awaiting_host_trust', publicKey: observed.publicKey.toString('base64'), fingerprint: observed.fingerprint }); return;
        }
        const changed = observed && input.trustedHostKey !== null && !observed.publicKey.equals(Buffer.from(input.trustedHostKey, 'base64'));
        const errorCode = changed ? 'HOST_KEY_CHANGED' : error.level === 'client-authentication' ? 'AUTH_FAILED' : error.level === 'client-timeout' ? 'CONNECT_TIMEOUT' : 'CONNECTION_LOST';
        this.changed(entry, { status: 'failed', errorCode }); this.release(entry); finish(errorCode);
      });
      client.on('close', () => {
        this.release(entry);
        if (!['failed', 'disconnected', 'awaiting_host_trust'].includes(entry.snapshot.status)) this.changed(entry, { status: 'disconnected', errorCode: 'CONNECTION_LOST' });
        finish('CONNECTION_LOST');
      });
      try { client.connect({ host: input.host, port: input.port, username: input.username, hostVerifier: verifier.verify, authHandler: oneShotAuthentication(method), algorithms, readyTimeout: 20000, keepaliveInterval: 15000, keepaliveCountMax: 3 }); }
      catch { this.changed(entry, { status: 'failed', errorCode: 'INPUT_INVALID' }); this.release(entry); finish('INPUT_INVALID'); }
    });
  }
  private async timed<T>(action: (done: (error: Error | undefined | null, value: T) => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('IO_TIMEOUT')), 15000);
      action((error, value) => { clearTimeout(timer); if (error) reject(error); else resolve(value); });
    });
  }
  private async inspect(entry: RecordEntry): Promise<void> {
    let sftp: SFTPWrapper;
    try { sftp = await this.timed(done => entry.client.sftp(done)); }
    catch (error) { if (error instanceof Error && error.message === 'IO_TIMEOUT') throw error; this.changed(entry, { sftp: 'unavailable' }); return; }
    if (this.entries.get(entry.snapshot.serverId) !== entry || entry.snapshot.status !== 'connected') { sftp.end(); return; }
    entry.sftp = sftp; this.changed(entry, { sftp: 'available' });
    const path = await this.timed<string>(done => sftp.realpath('.', done)); this.changed(entry, { initialPath: path });
    let handle: Buffer | undefined;
    try {
      handle = await this.timed<Buffer>(done => sftp.open('/etc/os-release', 'r', done));
      const bytes = Buffer.alloc(16385); let offset = 0;
      while (offset < bytes.length) {
        const count = await new Promise<number>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('IO_TIMEOUT')), 15000);
          sftp.read(handle!, bytes, offset, bytes.length - offset, offset, (error, read) => { clearTimeout(timer); if (error) reject(error); else resolve(read); });
        });
        if (count === 0) break; offset += count;
      }
      this.changed(entry, { os: identifyOS(bytes.subarray(0, offset)) });
    } catch (error) { if (error instanceof Error && error.message === 'IO_TIMEOUT') throw error; this.changed(entry, { os: 'unknown' }); }
    finally { if (handle) await this.timed<void>(done => sftp.close(handle!, error => done(error, undefined))); }
  }
  confirmOS(serverId: string, generation: number): void {
    const entry = this.entries.get(serverId);
    if (!entry || entry.snapshot.generation !== generation || entry.snapshot.status !== 'connected' || entry.snapshot.os !== 'unknown') throw new Error('INPUT_INVALID');
    this.changed(entry, { osConfirmed: true });
  }
  disconnect(serverId: string, expectedGeneration?: number): void {
    const entry = this.entries.get(serverId); if (!entry) return;
    if (expectedGeneration !== undefined && entry.snapshot.generation !== expectedGeneration) throw new Error('INPUT_INVALID');
    this.changed(entry, { status: 'disconnecting' }); entry.client.destroy(); this.release(entry); this.changed(entry, { status: 'disconnected', errorCode: null });
  }
  private release(entry: RecordEntry): void {
    entry.auxiliary?.closeAll();
    entry.agent?.dispose(); entry.agent = null; entry.sftp = null;
    if (entry.input.keyBytes) entry.input.keyBytes.fill(0);
    delete entry.input.password; delete entry.input.passphrase; delete entry.input.keyBytes;
  }
  closeAll(): void { for (const id of this.entries.keys()) this.disconnect(id); }
}
