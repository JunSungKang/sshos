import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { connectOutcomeSchema, hostChallengeSchema, sessionCredentialsSchema, type ConnectInput, type HostChallenge, type SessionCredentials, type SessionSnapshot, type SessionView } from '../shared/session-contracts';
import type { Profile } from '../shared/models';
import { StateRepository, endpointFor } from './persistence/state-repository';
import { SecretVault } from './persistence/secrets';
import { readPrivateKeyFile } from './read-private-key';
import { EngineGateway } from './engine-gateway';

interface PendingTrust { challenge: HostChallenge; profile: Profile; input: ConnectInput; publicKey: string; saveSecret: boolean; deadline: number; timer: ReturnType<typeof setTimeout> }
export class ConnectionController {
  private readonly sessions = new Map<string, SessionSnapshot>();
  private readonly generations = new Map<string, number>();
  private readonly pending = new Map<string, PendingTrust>();
  private readonly tokens = new Map<string, { serverId: string; generation: number }>();
  constructor(private readonly state: () => StateRepository | null, private readonly gateway: EngineGateway, private readonly secrets: SecretVault) {}
  isBusy = (id: string): boolean => {
    const session = this.sessions.get(id); return session !== undefined && !['failed', 'disconnected', 'idle'].includes(session.status);
  };
  observe(snapshot: SessionSnapshot): void {
    if (this.generations.get(snapshot.serverId) !== snapshot.generation) return;
    this.sessions.set(snapshot.serverId, snapshot);
    for (const [token, value] of this.tokens) if (value.serverId === snapshot.serverId && (value.generation !== snapshot.generation || snapshot.status !== 'connected')) this.tokens.delete(token);
    if (snapshot.status === 'connected' && ![...this.tokens.values()].some(value => value.serverId === snapshot.serverId && value.generation === snapshot.generation)) this.tokens.set(randomUUID(), { serverId: snapshot.serverId, generation: snapshot.generation });
  }
  sessionCapability(token: string): { serverId: string; generation: number } {
    const value = this.tokens.get(token);
    if (!value || this.sessions.get(value.serverId)?.status !== 'connected' || this.generations.get(value.serverId) !== value.generation) throw new Error('SESSION_UNAVAILABLE');
    return { ...value };
  }
  views(): SessionView[] {
    const profiles = this.state()?.snapshot().profiles ?? [];
    return [...this.sessions.values()].flatMap(session => {
      const profile = profiles.find(profile => profile.id === session.serverId);
      return profile ? [{ ...session, serverName: profile.name, host: profile.host, port: profile.port, username: profile.username, sessionToken: [...this.tokens].find(([, value]) => value.serverId === session.serverId && value.generation === session.generation)?.[0] ?? null }] : [];
    });
  }
  challenges(): HostChallenge[] { return [...this.pending.values()].map(row => ({ ...row.challenge })); }
  private repository(): StateRepository {
    const repo = this.state(); if (!repo || repo.store.faulted) throw new Error('STORAGE_FAILED'); return repo;
  }
  private nextGeneration(id: string): number {
    const generation = (this.generations.get(id) ?? 0) + 1; this.generations.set(id, generation); return generation;
  }
  async connect(id: string, credentials: SessionCredentials): Promise<void> {
    if (this.isBusy(id)) throw new Error('SESSION_BUSY');
    if (this.views().filter(view => this.isBusy(view.serverId)).length >= 3) throw new Error('SESSION_LIMIT');
    const repository = this.repository(); const state = repository.snapshot();
    const profile = state.profiles.find(row => row.id === id); if (!profile) throw new Error('PROFILE_NOT_FOUND');
    const generation = this.nextGeneration(id);
    const knownIds = new Set(state.profiles.map(profile => profile.id));
    for (const oldId of this.sessions.keys()) if (!knownIds.has(oldId) && !this.isBusy(oldId)) { this.sessions.delete(oldId); this.generations.delete(oldId); }
    this.sessions.set(id, { serverId: id, generation, status: 'connecting', os: 'unknown', osConfirmed: false, sftp: 'unknown', initialPath: null, errorCode: null });
    const trust = state.hostTrust.find(row => row.endpoint === endpointFor(profile) && row.trusted);
    const input: ConnectInput = { host: profile.host, port: profile.port, username: profile.username, authentication: profile.authentication, trustedHostKey: trust?.publicKey ?? null };
    try {
      if (profile.authentication === 'key') {
        if (!profile.keyPath) throw new Error('KEY_INVALID');
        const rawKey = await readPrivateKeyFile(profile.keyPath); input.keyBytes = Uint8Array.from(rawKey); rawKey.fill(0);
        if (credentials.passphrase !== undefined) input.passphrase = credentials.passphrase;
      } else if (credentials.password !== undefined) input.password = credentials.password;
      if (profile.secretId && ((profile.authentication === 'password' && input.password === undefined) || (profile.authentication === 'key' && input.passphrase === undefined))) {
        const saved = state.encryptedSecrets.find(row => row.id === profile.secretId && row.profileId === id && row.endpoint === endpointFor(profile) && row.username === profile.username);
        if (!saved) throw new Error('SECRET_UNAVAILABLE');
        const value = await this.secrets.decrypt(saved.ciphertext, async ciphertext => {
          await repository.store.update(current => {
            if (!current) throw new Error('STORAGE_FAILED');
            return { ...current, encryptedSecrets: current.encryptedSecrets.map(secret => secret.id === saved.id ? { ...secret, ciphertext } : secret) };
          });
        });
        if (profile.authentication === 'password') input.password = value; else input.passphrase = value;
      }
      if (this.generations.get(id) !== generation || !this.isBusy(id)) throw new Error('CONNECTION_LOST');
      await this.dispatch(profile, generation, input, credentials.saveSecret);
    } catch (error) {
      this.clearInput(input);
      const previous = this.sessions.get(id);
      if (previous?.generation === generation) this.sessions.set(id, { ...previous, status: 'failed', errorCode: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'KEY_INVALID' });
      throw error;
    }
  }
  private async dispatch(profile: Profile, generation: number, input: ConnectInput, saveSecret: boolean): Promise<void> {
    const outcome = connectOutcomeSchema.parse(await this.gateway.request({ action: 'session:connect', serverId: profile.id, generation, payload: input }));
    if (this.generations.get(profile.id) !== generation) { this.clearInput(input); return; }
    if (outcome.status === 'connected') {
      this.observe(outcome.snapshot);
      if (saveSecret) {
        const value = profile.authentication === 'password' ? input.password : input.passphrase;
          if (value !== undefined) {
            try { await this.saveSecret(profile, value); }
            catch (error) { await this.gateway.request({ action: 'session:disconnect', serverId: profile.id, generation }); throw error; }
          }
      }
      this.clearInput(input); return;
    }
    const challenge: HostChallenge = hostChallengeSchema.parse({ challengeId: randomUUID(), serverId: profile.id, generation, endpoint: endpointFor(profile), fingerprint: outcome.fingerprint, expiresAt: new Date(Date.now() + 120000).toISOString() });
    const deadline = performance.now() + 120000;
    const timer = setTimeout(() => { this.reject(challenge.challengeId); }, 120000);
    this.pending.set(challenge.challengeId, { challenge, profile, input, publicKey: outcome.publicKey, saveSecret, deadline, timer });
  }
  private async saveSecret(profile: Profile, value: string): Promise<void> {
    const ciphertext = await this.secrets.encrypt(value); const repo = this.repository(); const id = profile.secretId ?? randomUUID();
    await repo.store.update(state => {
      if (!state) throw new Error('STORAGE_FAILED');
      return { ...state, profiles: state.profiles.map(row => row.id === profile.id ? { ...row, secretId: id } : row), encryptedSecrets: [...state.encryptedSecrets.filter(row => row.profileId !== profile.id), { id, profileId: profile.id, endpoint: endpointFor(profile), username: profile.username, ciphertext }] };
    });
  }
  async approve(challengeId: string): Promise<void> {
    const pending = this.pending.get(challengeId);
    if (!pending || performance.now() > pending.deadline || this.generations.get(pending.profile.id) !== pending.challenge.generation) { this.reject(challengeId); throw new Error('HOST_TRUST_REQUIRED'); }
    this.pending.delete(challengeId); clearTimeout(pending.timer);
    try {
      await this.repository().trust(pending.challenge.endpoint, Buffer.from(pending.publicKey, 'base64'), pending.challenge.fingerprint);
      const generation = this.nextGeneration(pending.profile.id);
      pending.input.trustedHostKey = pending.publicKey;
      const old = this.sessions.get(pending.profile.id)!; this.sessions.set(pending.profile.id, { ...old, generation, status: 'connecting' });
      await this.dispatch(pending.profile, generation, pending.input, pending.saveSecret);
    } catch (error) {
      this.clearInput(pending.input);
      const old = this.sessions.get(pending.profile.id);
      if (old) this.sessions.set(old.serverId, { ...old, status: 'failed', errorCode: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INTERNAL_ERROR' });
      if (old) void this.gateway.request({ action: 'session:disconnect', serverId: old.serverId, generation: old.generation }).catch(() => {});
      throw error;
    }
  }
  reject(challengeId: string): void {
    const pending = this.pending.get(challengeId); if (!pending) return;
    this.pending.delete(challengeId); clearTimeout(pending.timer); this.clearInput(pending.input);
    const old = this.sessions.get(pending.profile.id);
    if (old?.generation === pending.challenge.generation) this.sessions.set(old.serverId, { ...old, status: 'disconnected' });
    void this.gateway.request({ action: 'session:disconnect', serverId: pending.profile.id, generation: pending.challenge.generation }).catch(() => {});
  }
  async disconnect(id: string): Promise<void> {
    for (const [challengeId, pending] of this.pending) if (pending.profile.id === id) this.reject(challengeId);
    const old = this.sessions.get(id); if (!old) return;
    await this.gateway.request({ action: 'session:disconnect', serverId: id, generation: old.generation });
    this.sessions.set(id, { ...old, status: 'disconnected', errorCode: null });
  }
  async confirmOS(id: string, generation: number): Promise<void> { await this.gateway.request({ action: 'session:confirmOS', serverId: id, generation }); }
  async handle(action: string, payload: unknown): Promise<unknown> {
    if (action === 'session:list') { if (payload !== undefined) throw new Error('INPUT_INVALID'); return { sessions: this.views(), challenges: this.challenges() }; }
    if (action === 'session:connect') { const parsed = z.object({ id: z.uuid(), credentials: sessionCredentialsSchema }).strict().parse(payload); await this.connect(parsed.id, parsed.credentials); return; }
    if (action === 'session:disconnect') { await this.disconnect(z.uuid().parse(payload)); return; }
    if (action === 'trust:approve') { await this.approve(z.uuid().parse(payload)); return; }
    if (action === 'trust:reject') { this.reject(z.uuid().parse(payload)); return; }
    if (action === 'session:confirmOS') { const parsed = z.object({ id: z.uuid(), generation: z.int().min(1) }).strict().parse(payload); await this.confirmOS(parsed.id, parsed.generation); return; }
    throw new Error('INPUT_INVALID');
  }
  engineStopped(): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); this.clearInput(pending.input); } this.pending.clear();
    for (const [id, old] of this.sessions) this.sessions.set(id, { ...old, status: 'disconnected', errorCode: 'ENGINE_STOPPED' });
    this.tokens.clear();
  }
  private clearInput(input: ConnectInput): void { input.keyBytes?.fill(0); delete input.keyBytes; delete input.password; delete input.passphrase; }
}
