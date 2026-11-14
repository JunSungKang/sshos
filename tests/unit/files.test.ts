import { describe, expect, it, vi } from 'vitest';
import type { SFTPWrapper, Stats } from 'ssh2';
import { FileBrowser, controlCall } from '../../src/worker/files/browser';
import { validName, remotePathSchema } from '../../src/shared/files';

const stat = (kind: string): Stats => ({ mode: kind === 'directory' ? 0o40700 : kind === 'file' ? 0o100600 : 0o120777, size: 1, atime:0, mtime:1, uid:0,gid:0, isDirectory:() => kind === 'directory', isFile:() => kind === 'file', isSymbolicLink:() => kind === 'symlink', isFIFO:() => false, isSocket:() => false, isBlockDevice:() => false, isCharacterDevice:() => false });
function fixture(names: [string,string][]) {
  let offset = 0; let closed = 0; let stopped = false;
  const sftp = {
    lstat: (_path: string, done: Function) => done(null,stat('directory')),
    realpath: (path: string, done: Function) => done(null,path),
    opendir: (_path: string, done: Function) => { offset=0; done(null,Buffer.from('handle')); },
    readdir: (_handle: Buffer, done: Function) => { const batch = names.slice(offset,offset+128).map(([filename,kind]) => ({filename,attrs:stat(kind)})); offset+=batch.length; if (batch.length) done(null,batch); else done(Object.assign(new Error('EOF'),{code:1})); },
    close: (_handle: Buffer, done: Function) => { closed++; done(null); }
  } as unknown as SFTPWrapper;
  return { control:{sftp,check:() => { if (stopped) throw new Error('CONNECTION_LOST'); },quarantine:() => {stopped=true;}}, get closed(){return closed;} };
}
describe('SFTP bounded enumeration and path policy', () => {
  it('keeps exact Unicode names and rejects unsafe or lossy names', () => {
    for (const name of ['한글','é','e\u0301','emoji😀','<script>.txt']) expect(validName(name)).toBe(true);
    for (const name of ['','..','.','a/b','a\0b','x\ufffd','x\u202e','a'.repeat(256),'\ud800']) expect(validName(name)).toBe(false);
    expect(remotePathSchema.safeParse('/home/../etc').success).toBe(false);
    expect(remotePathSchema.safeParse('/home/fixture').success).toBe(true);
  });
  it('sorts folders first by code point, disables links and escapes control names', async () => {
    const f = fixture([['z','file'],['link','symlink'],['b','directory'],['a','directory'],['\ue000','file'],['😀','file'],['x\nfile','file'],['.','directory']]);
    const browser = new FileBrowser(() => f.control); const page = await browser.list('server',1,'browser','/home/fixture');
    expect(page.entries.slice(0,2).map(row => row.name)).toEqual(['a','b']);
    expect(page.entries.find(row => row.name === 'link')?.operable).toBe(false);
    expect(page.entries.find(row => row.name.includes('\\u{a}'))?.rawName).toBe('');
    expect(page.entries.findIndex(row => row.name === '\ue000')).toBeLessThan(page.entries.findIndex(row => row.name === '😀'));
    expect(f.closed).toBe(1);
  });
  it('marks capped directories partial, closes the handle and pages at most256 entries', async () => {
    const f=fixture(Array.from({length:10001},(_,i) => [`file${i.toString().padStart(5,'0')}`,'file']));
    const browser = new FileBrowser(() => f.control); const first = await browser.list('server',1,'browser','/');
    expect(first.total).toBe(10000); expect(first.partial).toBe(true); expect(first.entries).toHaveLength(256); expect(f.closed).toBe(1);
    const second = browser.page('server',1,'browser',first.nextOffset!,first.snapshotId); expect(second.offset).toBe(256);
    expect(() => browser.page('server',2,'browser',0,first.snapshotId)).toThrow('TOKEN_EXPIRED');
    expect(() => browser.page('server',1,'browser',0,crypto.randomUUID())).toThrow('TOKEN_EXPIRED');
    browser.close('browser'); expect(() => browser.page('server',1,'browser',0)).toThrow('TOKEN_EXPIRED');
  });
  it('quarantines once on timeout and discards the late callback', async () => {
    vi.useFakeTimers(); const quarantine = vi.fn(); let callback: (error: null,value: string) => void = () => {};
    const waiting = controlCall({sftp:{} as SFTPWrapper,check:() => {},quarantine},done => { callback=done; },15);
    const rejected=expect(waiting).rejects.toThrow('IO_TIMEOUT'); await vi.advanceTimersByTimeAsync(16); await rejected; callback(null,'late'); expect(quarantine).toHaveBeenCalledTimes(1); vi.useRealTimers();
  });
});
