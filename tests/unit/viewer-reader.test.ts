import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client, SFTPWrapper, Stats } from 'ssh2';
import { ViewerReader } from '../../src/worker/viewers/reader';
import type { ViewerFrame, ViewerReadKind } from '../../src/shared/viewers/reader';
import { TEXT_LIMIT } from '../../src/shared/viewers/text';
function fixture(data:Buffer,options:{short?:number;declaredSize?:number}={}) {
  let mtime=1,reads=0,cancels=0,hang=false;let closed!:()=>void;const closure=new Promise<void>(resolve => {closed=resolve;});
  const stats=():Stats => ({size:options.declaredSize ?? data.length,mtime,mode:0o100600,uid:0,gid:0,atime:0,isFile:() => true,isDirectory:() => false,isSymbolicLink:() => false,isFIFO:() => false,isSocket:() => false,isBlockDevice:() => false,isCharacterDevice:() => false});
  const sftp={
    lstat:(path:string,done:Function) => done(null,path === '/home' ? {...stats(),isFile:() => false,isDirectory:() => true} : stats()),
    realpath:(path:string,done:Function) => done(null,path),open:(_path:string,_flags:string,done:Function) => done(null,Buffer.from('handle')),
    fstat:(_handle:Buffer,done:Function) => done(null,stats()),close:(_handle:Buffer,done:Function) => done(null),
    read:(_handle:Buffer,bytes:Buffer,offset:number,length:number,position:number,done:Function) => {reads++;if (hang) return;const count=Math.max(0,Math.min(length,options.short ?? length,data.length-position));data.copy(bytes,offset,position,position+count);done(null,count);}
  } as unknown as SFTPWrapper;
  const service=new ViewerReader(() => ({} as Client),() => ({ready:Promise.resolve(sftp),closed:closure,cancel:() => {cancels++;closed();}}));
  const serverId=crypto.randomUUID(),viewerId=crypto.randomUUID();const open=(kind:ViewerReadKind='text') => service.open({serverId,generation:1,viewerId,readGeneration:1,path:'/home/file',parent:'/home',kind});
  const next=(sequence:number) => service.next(serverId,1,viewerId,1,sequence);
  const ready=async ():Promise<ViewerFrame> => {for (let i=0;i<100;i++) {const frame=await next(0);if (frame.status !== 'waiting') return frame;await Promise.resolve();}throw new Error('Fixture failed to prepare');};
  return {service,serverId,viewerId,open,next,ready,get reads(){return reads;},get cancels(){return cancels;},change:() => {mtime++;},hang:() => {hang=true;},cancel:() => service.cancel(viewerId,1)};
}
afterEach(() => vi.useRealTimers());
describe('bounded viewer read and consumer ACK',() => {
  it('does not read bytes before demand and replays a sequence without advancing',async () => {
    const f=fixture(Buffer.alloc(150000,65));f.open();
    for (let i=0;i<30;i++) await Promise.resolve();expect(f.reads).toBe(0);
    const first=await f.ready();expect(first.status).toBe('chunk');if (first.status !== 'chunk') throw new Error('Missing chunk');expect(first.bytes.length).toBe(65536);
    const calls=f.reads;expect(await f.next(0)).toBe(first);expect(f.reads).toBe(calls);await f.next(1);expect(f.reads).toBeGreaterThan(calls);f.cancel();
  });
  it('handles short reads, verifies fstat and EOF, then closes only its channel',async () => {
    const data=Buffer.from('one\ntwo\n'.repeat(31));const f=fixture(data,{short:7});f.open();const chunks:Uint8Array[]=[];let frame=await f.ready(),sequence=0;
    while (frame.status !== 'end') {if (frame.status === 'chunk') {chunks.push(frame.bytes);sequence++;}frame=await f.next(sequence);}
    expect(Buffer.concat(chunks)).toEqual(data);expect(frame.metadata.readAt).not.toBeNull();expect(f.cancels).toBe(1);f.cancel();
  });
  it('reads at most4096 bytes for classification while preserving the full file size metadata',async () => {
    const f=fixture(Buffer.alloc(5000,66));f.open('probe');const first=await f.ready();expect(first.status).toBe('chunk');if (first.status !== 'chunk') throw new Error('Missing sample');expect(first.bytes.length).toBe(4096);expect(first.metadata.size).toBe(5000);expect((await f.next(1)).status).toBe('end');f.cancel();
  });
  it('refuses observed source changes at final validation',async () => {
    const f=fixture(Buffer.alloc(100000,65));f.open();await f.ready();f.change();await expect(f.next(1)).rejects.toThrow('SOURCE_CHANGED');expect(f.cancels).toBe(1);f.cancel();
  });
  it('enforces actual byte limits independently of declared source metadata',async () => {
    const f=fixture(Buffer.alloc(TEXT_LIMIT+1,65),{declaredSize:1});f.open();let frame=await f.ready(),sequence=0;
    while (frame.status === 'chunk' && sequence<31) {sequence++;frame=await f.next(sequence);}
    await expect(f.next(sequence+1)).rejects.toThrow('VIEW_LIMIT');f.cancel();
  });
  it('binds generations and cancels pending reads without ending a shared SSH client',async () => {
    const f=fixture(Buffer.alloc(100000,65));f.open();await f.ready();await expect(f.service.next(f.serverId,2,f.viewerId,1,1)).rejects.toThrow('TOKEN_EXPIRED');
    f.cancel();await expect(f.next(1)).rejects.toThrow('TOKEN_EXPIRED');expect(f.cancels).toBe(1);
  });
  it('ends only its read channel on request timeout and propagates connection loss immediately',async () => {
    vi.useFakeTimers();const f=fixture(Buffer.alloc(100000,65));f.open();await f.ready();f.hang();const waiting=f.next(1);const rejected=expect(waiting).rejects.toThrow('IO_TIMEOUT');await vi.advanceTimersByTimeAsync(15001);await rejected;expect(f.cancels).toBe(1);f.cancel();
    const disconnected=fixture(Buffer.alloc(100000,65));disconnected.open();await disconnected.ready();disconnected.service.sessionChanged(disconnected.serverId,1,false);await expect(disconnected.next(1)).rejects.toThrow('CONNECTION_LOST');disconnected.cancel();
  });
});
