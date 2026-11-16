import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';
import { filePageSchema, remotePathSchema, validName, type DirectoryPage, type EntryView, type FilePage } from '../shared/files';
import type { ConnectionController } from './connections';
import type { DesktopController } from './desktop';
import type { EngineGateway } from './engine-gateway';

type Browser = { windowId: string; browserId: string; serverId: string; generation: number; sessionToken: string; activePage: string | null; cached: Map<number, FilePage> };
type Directory = { browser: Browser; path: string };
export type EntryCapability = Directory & { rawName: string; type: 'file' | 'directory'; listedAt: string };
export class FileController {
  private readonly browsers = new Map<string, Browser>();
  private readonly initialDirectories=new Map<string,string>();
  private readonly directories = new Map<string, Directory>();
  private readonly entries = new Map<string, EntryCapability>();
  private readonly pages = new Map<string, Directory & { snapshotId: string; nextOffset: number | null; busy: boolean }>();
  constructor(private readonly desktop: DesktopController, private readonly connections: ConnectionController, private readonly gateway: EngineGateway) {}
  private fileWindow(id:string){const row=this.desktop.findWindow(id);if(!row || !['files','home'].includes(row.kind))throw new Error('TOKEN_EXPIRED');return row;}
  private check(browser: Browser, requireConnection = true): void {
    const window = this.fileWindow(browser.windowId);
    if (window.serverId !== browser.serverId || window.sessionGeneration !== browser.generation) throw new Error('TOKEN_EXPIRED');
    if (requireConnection) { const session = this.connections.sessionCapability(browser.sessionToken); if (session.serverId !== browser.serverId || session.generation !== browser.generation) throw new Error('TOKEN_EXPIRED'); }
  }
  private directory(browser: Browser, path: string): string {
    remotePathSchema.parse(path);
    const old = [...this.directories].find(([,value]) => value.browser === browser && value.path === path); if (old) return old[0];
    if ([...this.directories.values()].filter(value => value.browser === browser).length >= 20000) {
      const first = [...this.directories].find(([,value]) => value.browser === browser); if (first) this.directories.delete(first[0]);
    }
    const token = randomUUID(); this.directories.set(token, { browser, path }); return token;
  }
  resolveEntry(token: string): EntryCapability {
    const entry = this.entries.get(token); if (!entry) throw new Error('TOKEN_EXPIRED'); this.check(entry.browser); return entry;
  }
  resolveDirectory(token:string):Directory { const value=this.directories.get(token); if (!value) throw new Error('TOKEN_EXPIRED'); this.check(value.browser); return value; }
  private async list(directory: Directory): Promise<DirectoryPage> {
    const { browser, path } = directory; this.check(browser);
    const response = filePageSchema.parse(await this.gateway.request({ action: 'file:list', serverId: browser.serverId, generation: browser.generation, browserId: browser.browserId, path }));
    this.check(browser);
    browser.cached.clear(); browser.cached.set(0, response);if(this.fileWindow(browser.windowId).kind==='files')this.initialDirectories.set(browser.windowId,response.path);
    return this.publish(browser, response);
  }
  private publish(browser: Browser, response: FilePage): DirectoryPage {
    for (const [token, value] of this.entries) if (value.browser === browser) this.entries.delete(token);
    for (const [token, value] of this.pages) if (value.browser === browser) this.pages.delete(token);
    const pageToken = randomUUID(); browser.activePage = pageToken; this.pages.set(pageToken, { browser, path: response.path, snapshotId: response.snapshotId, nextOffset: response.nextOffset, busy: false });
    return this.convert(browser, response, pageToken);
  }
  private convert(browser: Browser, response: z.infer<typeof filePageSchema>, pageToken: string): DirectoryPage {
    const entries: EntryView[] = response.entries.map(({ rawName, ...row }) => {
      let entryToken: string | null = null;
      if (row.operable && validName(rawName) && ['file','directory'].includes(row.type)) {
        entryToken = randomUUID(); this.entries.set(entryToken, { browser, path: response.path, rawName, type: row.type as 'file' | 'directory', listedAt: response.listedAt });
      }
      return { ...row, entryToken, directoryToken: entryToken && row.type === 'directory' ? this.directory(browser, posix.join(response.path, rawName)) : null };
    });
    const { snapshotId: _snapshot, ...rest } = response;
    return { ...rest, entries, pageToken, directoryToken: this.directory(browser, response.path), parentToken: response.path === '/' ? null : this.directory(browser, posix.dirname(response.path)) };
  }
  async closeWindow(id: string): Promise<void> {
    const browser = this.browsers.get(id); if (!browser) return;
    this.browsers.delete(id);this.initialDirectories.delete(id);
    for (const map of [this.directories, this.entries, this.pages]) for (const [token, value] of map) if (value.browser === browser) map.delete(token);
    await this.gateway.request({ action: 'file:close', browserId: browser.browserId, serverId: browser.serverId, generation: browser.generation });
  }
  async handle(action: string, payload: unknown): Promise<unknown> {
    if(action==='file:openFolder'){
      const directory=this.resolveDirectory(z.uuid().parse(payload));
      for(const [id,path] of this.initialDirectories){const row=this.desktop.findWindow(id);if(path===directory.path && row?.serverId===directory.browser.serverId && row.sessionGeneration===directory.browser.generation)return row;}
      const row=this.desktop.handle('desktop:registerWindow',{kind:'files',resourceToken:directory.browser.sessionToken}) as import('../shared/windows').WindowModel;
      this.initialDirectories.set(row.windowId,directory.path);return row;
    }
    if (action === 'file:open') {
      const input=typeof payload==='string'?{id:z.uuid().parse(payload),start:false}:z.object({id:z.uuid(),start:z.literal(true)}).strict().parse(payload);const id=input.id; const window = this.fileWindow(id);
      const existing = this.browsers.get(id); const cached = existing?.cached.get(0);
      if (existing && cached) { this.check(existing, false); return this.publish(existing, cached); }
      const session = this.connections.views().find(row => row.serverId === window.serverId && row.generation === window.sessionGeneration);
      if (!session?.sessionToken || !session.initialPath || session.sftp !== 'available') throw new Error('SFTP_UNAVAILABLE');
      let browser = this.browsers.get(id);
      if (!browser) { browser = { windowId: id, browserId: window.resourceId!, serverId: session.serverId, generation: session.generation, sessionToken: session.sessionToken, activePage: null, cached: new Map() }; this.browsers.set(id, browser); }
      const path=this.initialDirectories.get(id) ?? (window.kind==='home' && !input.start ? session.homePath:session.initialPath);if(!path)throw new Error('PATH_UNSUPPORTED');return this.list({ browser, path });
    }
    if (action === 'file:list') { const value = this.directories.get(z.uuid().parse(payload)); if (!value) throw new Error('TOKEN_EXPIRED'); return this.list(value); }
    if (action === 'file:enter') {
      const entry = this.resolveEntry(z.uuid().parse(payload)); if (entry.type !== 'directory') throw new Error('PATH_UNSUPPORTED');
      return this.list({ browser: entry.browser, path: posix.join(entry.path, entry.rawName) });
    }
    if (action === 'file:page') {
      const input = z.object({ token: z.uuid(), offset: z.int().min(0).max(10000) }).strict().parse(payload);
      const page = this.pages.get(input.token); if (!page || page.browser.activePage !== input.token || page.nextOffset !== input.offset) throw new Error('TOKEN_EXPIRED'); this.check(page.browser, false);
      if (page.busy) throw new Error('REQUEST_BUSY'); page.busy = true;
      try {
        const response = page.browser.cached.get(input.offset) ?? filePageSchema.parse(await this.gateway.request({ action: 'file:page', serverId: page.browser.serverId, generation: page.browser.generation, browserId: page.browser.browserId, snapshotId: page.snapshotId, offset: input.offset }));
        this.check(page.browser, false); if (page.browser.activePage !== input.token) throw new Error('TOKEN_EXPIRED');
        page.browser.cached.set(input.offset, response); page.nextOffset = response.nextOffset; return this.convert(page.browser, response, input.token);
      } finally { page.busy = false; }
    }
    throw new Error('INPUT_INVALID');
  }
}
