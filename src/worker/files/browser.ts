import { randomUUID } from 'node:crypto';
import type { SFTPWrapper, Stats, FileEntryWithStats } from 'ssh2';
import { remotePathSchema, validName, displayName, compareNames, type FileEntry, type FilePage } from '../../shared/files';

export interface ControlAccess {
  sftp: SFTPWrapper;
  check(): void;
  quarantine(): void;
}
export async function controlCall<T>(control: ControlAccess, call: (done: (error: Error | undefined | null, value: T) => void) => void, duration = 15000): Promise<T> {
  control.check();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (settled) return; settled = true; control.quarantine(); reject(new Error('IO_TIMEOUT')); }, duration);
    try { call((error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      try {
        control.check();
        if (error) { const code = (error as Error & { code?: number }).code; throw Object.assign(new Error(code === 3 ? 'PERMISSION_DENIED' : 'INTERNAL_ERROR'), { code }); }
        resolve(value);
      } catch (failure) { reject(failure); }
    }); } catch (error) { settled = true; clearTimeout(timer); reject(error); }
  });
}
export function fileType(stat: Stats): FileEntry['type'] {
  return stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : stat.isFIFO() || stat.isSocket() || stat.isBlockDevice() || stat.isCharacterDevice() ? 'special' : 'unknown';
}
export async function verifyDirectory(control: ControlAccess, path: string): Promise<void> {
  remotePathSchema.parse(path);
  const stat = await controlCall<Stats>(control, done => control.sftp.lstat(path, done));
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('PATH_UNSUPPORTED');
  const canonical = await controlCall<string>(control, done => control.sftp.realpath(path, done));
  if (canonical !== path) throw new Error('PATH_CHANGED');
}
type Snapshot = { serverId: string; generation: number; id: string; path: string; listedAt: string; partial: boolean; rows: FileEntry[] };
export class FileBrowser {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly reading = new Set<string>();
  private readonly cancelled = new Set<string>();
  constructor(private readonly control: (serverId: string, generation: number) => ControlAccess) {}
  close(browserId: string): void { this.snapshots.delete(browserId); if (this.reading.has(browserId)) this.cancelled.add(browserId); }
  async list(serverId: string, generation: number, browserId: string, path: string): Promise<FilePage> {
    if (this.reading.has(browserId)) throw new Error('REQUEST_BUSY');
    if (!this.snapshots.has(browserId) && this.snapshots.size + this.reading.size >= 9) throw new Error('WINDOW_LIMIT');
    const control = this.control(serverId, generation);
    this.reading.add(browserId); this.cancelled.delete(browserId);
    let handle: Buffer | undefined;
    const deadline = setTimeout(() => control.quarantine(), 60000);
    try {
      await verifyDirectory(control, path);
      handle = await controlCall<Buffer>(control, done => control.sftp.opendir(path, done));
      const rows: FileEntry[] = []; let bytes = 0; let partial = false; let stop = false;
      while (!stop) {
        if (this.cancelled.has(browserId)) throw new Error('REQUEST_CANCELLED');
        let batch: FileEntryWithStats[];
        try { batch = await controlCall<FileEntryWithStats[]>(control, done => control.sftp.readdir(handle!, done)); }
        catch (error) { if ((error as { code?: number }).code === 1) break; throw error; }
        if (batch.length === 0) break;
        for (const entry of batch) {
          if (entry.filename === '.' || entry.filename === '..') continue;
          const operable = validName(entry.filename); const type = fileType(entry.attrs);
          const safeInt = (value: number) => Number.isSafeInteger(value) && value >= 0 ? value : null;
          const row: FileEntry = { rawName: operable ? entry.filename : '', name: displayName(entry.filename), type, operable: operable && ['file','directory'].includes(type), size: safeInt(entry.attrs.size), mtime: safeInt(entry.attrs.mtime), mode: safeInt(entry.attrs.mode) };
          const size = Buffer.byteLength(JSON.stringify(row));
          if (rows.length >= 10000 || bytes + size > 10 * 1024 * 1024) { partial = true; stop = true; break; }
          rows.push(row); bytes += size;
        }
      }
      await controlCall<void>(control, done => control.sftp.close(handle!, error => done(error, undefined))); handle = undefined;
      rows.sort((a,b) => Number(b.type === 'directory') - Number(a.type === 'directory') || compareNames(a.rawName || a.name, b.rawName || b.name));
      if (this.cancelled.has(browserId)) throw new Error('REQUEST_CANCELLED');
      this.snapshots.set(browserId, { id: randomUUID(), serverId, generation, path, listedAt: new Date().toISOString(), partial, rows });
      return this.page(serverId, generation, browserId, 0);
    } finally {
      clearTimeout(deadline);
      if (handle) { try { await controlCall<void>(control, done => control.sftp.close(handle!, error => done(error, undefined))); } catch { /* Quarantine handles unresponsive control. */ } }
      this.reading.delete(browserId); this.cancelled.delete(browserId);
    }
  }
  page(serverId: string, generation: number, browserId: string, offset: number, snapshotId?: string): FilePage {
    this.control(serverId, generation).check();
    const snapshot = this.snapshots.get(browserId);
    if (!snapshot || snapshot.serverId !== serverId || snapshot.generation !== generation || (snapshotId !== undefined && snapshot.id !== snapshotId) || offset > snapshot.rows.length) throw new Error('TOKEN_EXPIRED');
    const entries: FileEntry[] = []; let bytes = 0;
    for (const row of snapshot.rows.slice(offset, offset + 256)) { const size = Buffer.byteLength(JSON.stringify(row)); if (bytes + size > 192 * 1024) break; entries.push(row); bytes += size; }
    const next = offset + entries.length;
    return { snapshotId: snapshot.id, path: snapshot.path, listedAt: snapshot.listedAt, partial: snapshot.partial, total: snapshot.rows.length, offset, nextOffset: next < snapshot.rows.length ? next : null, entries };
  }
}
