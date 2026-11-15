import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SFTPWrapper, Stats } from 'ssh2';
import { FileMutations } from '../../src/worker/files/mutations';
import { PathLocks, claimsConflict } from '../../src/worker/files/path-locks';
import type { MutationSpec,MutationObservation } from '../../src/shared/mutations';

function fixture() {
  const nodes=new Map<string,{type:'file'|'directory';size:number;mtime:number}>([['/home',{type:'directory',size:0,mtime:1}],['/home/source',{type:'file',size:3,mtime:1}]]);
  const calls:string[]=[]; let removeFails=false; let unsupported=false;let removeHangs=false;let delayed:string|null=null;let late:Function|null=null;const observations:Omit<MutationObservation,'backendEpoch'>[]=[];
  const attrs=(value:{type:'file'|'directory';size:number;mtime:number}):Stats => ({...value,mode:value.type === 'file' ? 0o100600 : 0o40700,uid:0,gid:0,atime:0,isFile:() => value.type === 'file',isDirectory:() => value.type === 'directory',isSymbolicLink:() => false,isFIFO:() => false,isSocket:() => false,isBlockDevice:() => false,isCharacterDevice:() => false});
  const sftp={
    realpath:(path:string,done:Function) => done(null,path),
    lstat:(path:string,done:Function) => {const value=nodes.get(path);if (value) done(null,attrs(value));else done(Object.assign(new Error('untrusted remote text'),{code:2}));},
    mkdir:(path:string,_options:unknown,done:Function) => {calls.push('mkdir');if (nodes.has(path)) done(Object.assign(new Error('exists'),{code:4}));else {nodes.set(path,{type:'directory',size:0,mtime:1});if(delayed==='mkdir')late=done;else done(null);}},
    ext_openssh_hardlink:(source:string,destination:string,done:Function) => {if (unsupported) throw new Error('Server does not support this extended request');calls.push('link');if (nodes.has(destination)) done(Object.assign(new Error('exists'),{code:4}));else {nodes.set(destination,{...nodes.get(source)!});if(delayed==='link')late=done;else done(null);}},
    unlink:(path:string,done:Function) => {calls.push('unlink');if (removeFails) done(Object.assign(new Error('denied'),{code:3}));else {nodes.delete(path);if (removeHangs || delayed==='unlink')late=done;else done(null);}},
    rmdir:(path:string,done:Function) => {calls.push('rmdir');if ([...nodes.keys()].some(key => key.startsWith(path+'/'))) done(Object.assign(new Error('not empty'),{code:4}));else {nodes.delete(path);if(delayed==='rmdir')late=done;else done(null);}}
  } as unknown as SFTPWrapper;
  const locks=new PathLocks(); const service=new FileMutations(() => ({sftp,check:() => {},quarantine:() => {}}),locks,value=>observations.push(value));
  return {nodes,calls,service,locks,observations,delay:(kind:string)=>{delayed=kind;},deliver:()=>{late?.(null);},setRemoveFailure:() => {removeFails=true;},setUnsupported:() => {unsupported=true;},setRemoveHangs:() => {removeHangs=true;}};
}
afterEach(() => vi.useRealTimers());
const rename:MutationSpec={operation:'rename',parent:'/home',source:'/home/source',destination:'/home/dest',type:'file'};
describe('non-overwriting file mutations',() => {
  it('requires a separate source removal step after link acknowledgement',async () => {
    const f=fixture();const stat=await f.service.inspect('server',1,rename);await f.service.prepare('server',1,'task',rename,stat);
    const first=await f.service.step('server',1,'task','first');expect(first.phase).toBe('first_ack');expect(f.nodes.has('/home/source')).toBe(true);expect(f.calls).toEqual(['link']);
    const second=await f.service.step('server',1,'task','remove_source');expect(second.phase).toBe('completed');expect(second.sourceRemovalConfirmed).toBe(true);expect(f.nodes.has('/home/dest')).toBe(true);expect(f.nodes.has('/home/source')).toBe(false);
  });
  it('preserves both names on source removal failure and restricts paths until acknowledged',async () => {
    const f=fixture();await f.service.prepare('server',1,'task',rename,await f.service.inspect('server',1,rename));await f.service.step('server',1,'task','first');f.setRemoveFailure();
    const result=await f.service.step('server',1,'task','remove_source');expect(result.phase).toBe('partial');expect(result.errorCode).toBe('PARTIAL_RENAME');expect(f.nodes.has('/home/source')).toBe(true);expect(f.nodes.has('/home/dest')).toBe(true);
    f.service.finish('task',true);expect(f.locks.acquire('other','server',[{path:'/home',mode:'write'}])).toBe(false);f.service.finish('task',false);expect(f.locks.acquire('other','server',[{path:'/home',mode:'write'}])).toBe(true);
  });
  it('rejects collisions and unsupported hardlink without removing or renaming source',async () => {
    const f=fixture();f.nodes.set('/home/dest',{type:'file',size:99,mtime:1});await expect(f.service.inspect('server',1,rename)).rejects.toThrow('NAME_CONFLICT');expect(f.calls).toEqual([]);
    f.nodes.delete('/home/dest');await f.service.prepare('server',1,'task',rename,await f.service.inspect('server',1,rename));f.setUnsupported();
    const result=await f.service.step('server',1,'task','first');expect(result.phase).toBe('failed');expect(result.errorCode).toBe('HARDLINK_UNSUPPORTED');expect(f.calls).toEqual([]);expect(f.nodes.has('/home/source')).toBe(true);
  });
  it('rechecks metadata before dispatch and never recursively deletes',async () => {
    const f=fixture();const spec:MutationSpec={operation:'delete',parent:'/home',source:'/home/source',destination:null,type:'file'};
    await f.service.prepare('server',1,'task',spec,await f.service.inspect('server',1,spec));f.nodes.get('/home/source')!.mtime=2;
    expect((await f.service.step('server',1,'task','first')).errorCode).toBe('SOURCE_CHANGED');expect(f.calls).toEqual([]);
    f.nodes.set('/home/folder',{type:'directory',size:0,mtime:1});f.nodes.set('/home/folder/child',{type:'file',size:1,mtime:1});const folder:MutationSpec={operation:'delete',parent:'/home',source:'/home/folder',destination:null,type:'directory'};
    await f.service.prepare('server',1,'folder',folder,await f.service.inspect('server',1,folder));expect((await f.service.step('server',1,'folder','first')).phase).toBe('failed');expect(f.calls).toEqual(['rmdir']);expect(f.nodes.has('/home/folder/child')).toBe(true);
  });
  it('allows independent children but locks aliases of active source/destination and ancestors',() => {
    expect(claimsConflict([{path:'/a/x',mode:'write'},{path:'/a',mode:'keep'}],[{path:'/a/y',mode:'write'},{path:'/a',mode:'keep'}])).toBe(false);
    expect(claimsConflict([{path:'/a',mode:'write'}],[{path:'/a/x',mode:'keep'}])).toBe(true);
    expect(claimsConflict([{path:'/a/x',mode:'write'}],[{path:'/a/x',mode:'keep'}])).toBe(true);
  });
  it('keeps missing unlink ACK unknown even when the fixture physically removed source',async () => {
    const f=fixture();await f.service.prepare('server',1,'task',rename,await f.service.inspect('server',1,rename));await f.service.step('server',1,'task','first');f.setRemoveHangs();
    vi.useFakeTimers();const waiting=f.service.step('server',1,'task','remove_source');await vi.advanceTimersByTimeAsync(15001);const result=await waiting;
    expect(f.nodes.has('/home/source')).toBe(false);expect(result.phase).toBe('result_unknown');expect(result.sourceRemovalConfirmed).toBe(false);expect(result.destinationCreated).toBe(true);
  });
});

it('records every late mutation ACK only as a bound observation after timeout/finish, without promoting its returned unknown result',async()=>{vi.useFakeTimers();for(const operation of ['mkdir','rename','delete','rmdir','remove_source']){const f=fixture();const spec:MutationSpec=operation==='mkdir' ? {operation:'mkdir',parent:'/home',source:null,destination:'/home/new',type:null}:operation==='delete' || operation==='rmdir' ? {operation:'delete',parent:'/home',source:operation==='rmdir' ? '/home/folder':'/home/source',destination:null,type:operation==='rmdir' ? 'directory':'file'}:rename;if(operation==='rmdir')f.nodes.set('/home/folder',{type:'directory',size:0,mtime:1});await f.service.prepare('server',1,'task',spec,await f.service.inspect('server',1,spec));if(operation==='remove_source')await f.service.step('server',1,'task','first');f.delay(operation==='mkdir' ? 'mkdir':operation==='rename' ? 'link':operation==='rmdir' ? 'rmdir':'unlink');const waiting=f.service.step('server',1,'task',operation==='remove_source' ? 'remove_source':'first');await vi.advanceTimersByTimeAsync(15001);const result=await waiting;expect(result.phase).toBe('result_unknown');expect(f.observations).toEqual([]);f.service.finish('task',true);f.deliver();f.deliver();expect(f.observations).toEqual([{serverId:'server',generation:1,taskId:'task',operation:spec.operation,source:spec.source,destination:spec.destination,observation:{stage:operation==='mkdir' ? 'mkdir_ack':operation==='rename' ? 'link_ack':operation==='remove_source' ? 'source_removed':'delete_ack',at:expect.any(String)}}]);expect(result.phase).toBe('result_unknown');expect(f.locks.acquire('other','server',[{path:'/home',mode:'write'}])).toBe(false);}});
