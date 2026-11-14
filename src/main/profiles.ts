import { dialog, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { profileDraftSchema, type Profile, type ProfileDraft, type ProfileView } from '../shared/models';
import { StateRepository } from './persistence/state-repository';

export class ProfileController {
  private readonly selectedKeys = new Map<string, { path: string; expires: number }>();
  private dialogOpen = false;
  constructor(private readonly repository: StateRepository, private readonly window: () => BrowserWindow | null, private readonly busy: (id: string) => boolean) {}
  private view(profile: Profile): ProfileView {
    const { keyPath, secretId, ...publicProfile } = profile;
    return { ...publicProfile, keyFilename: keyPath ? basename(keyPath) : null, hasSavedSecret: secretId !== undefined };
  }
  list(): ProfileView[] { return this.repository.snapshot().profiles.map(profile => this.view(profile)); }
  private materialize(draft: ProfileDraft, previous?: Profile) {
    const { keyToken, ...value } = draft;
    if (value.authentication === 'password') return value;
    const now = performance.now();
    for (const [id, entry] of this.selectedKeys) if (entry.expires < now) this.selectedKeys.delete(id);
    const selected = keyToken === undefined ? undefined : this.selectedKeys.get(keyToken);
    if (keyToken !== undefined && !selected) throw new Error('KEY_INVALID');
    const path = selected?.path ?? (previous?.authentication === 'key' ? previous.keyPath : undefined);
    if (!path) throw new Error('KEY_INVALID');
    return { ...value, keyPath: path };
  }
  async handle(action: string, payload: unknown): Promise<unknown> {
    if (action === 'profile:list') { if (payload !== undefined) throw new Error('INPUT_INVALID'); return this.list(); }
    if (action === 'profile:create') return this.view(await this.repository.create(this.materialize(profileDraftSchema.parse(payload))));
    if (action === 'profile:update') {
      const parsed = z.object({ id: z.uuid(), input: profileDraftSchema }).strict().parse(payload);
      const old = this.repository.snapshot().profiles.find(p => p.id === parsed.id); if (!old) throw new Error('PROFILE_NOT_FOUND');
      return this.view(await this.repository.update(parsed.id, this.materialize(parsed.input, old), this.busy));
    }
    if (action === 'profile:delete') { await this.repository.remove(z.uuid().parse(payload), this.busy); return undefined; }
    if (action === 'profile:pickKey') {
      if (payload !== undefined || this.dialogOpen) throw new Error('INPUT_INVALID');
      const win = this.window(); if (!win || win.isDestroyed()) throw new Error('INPUT_INVALID');
      this.dialogOpen = true;
      try {
        const result = await dialog.showOpenDialog(win, { title: 'SSH 개인키 선택', properties: ['openFile'] });
        const path = result.filePaths[0];
        if (result.canceled || !path) return null;
        if (path.endsWith('.pub') || this.selectedKeys.size >= 20) throw new Error('KEY_INVALID');
        const token = randomUUID(); this.selectedKeys.set(token, { path, expires: performance.now() + 120000 });
        return { token, filename: basename(path) };
      } finally { this.dialogOpen = false; }
    }
    throw new Error('INPUT_INVALID');
  }
}
