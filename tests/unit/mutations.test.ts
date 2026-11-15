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
  return {nodes,calls,service,locks,observations,sftp,delay:(kind:string)=>{delayed=kind;},deliver:()=>{late?.(null);},setRemoveFailure:() => {removeFails=true;},setUnsupported:() => {unsupported=true;},setRemoveHangs:() => {removeHangs=true;}};
}
afterEach(() => vi.useRealTimers());
const rename:MutationSpec={operation:'rename',parent:'/home',source:'/home/source',destination:'/home/dest',type:'file'};
describe('non-overwriting file mutations',() => {
  it('refuses inconsistent operations, cross-parent paths, identical names and metadata-only links',async()=>{const f=fixture();for(const spec of [{...rename,type:'directory' as const},{...rename,destination:null},{...rename,source:null},{...rename,operation:'mkdir' as const},{...rename,operation:'delete' as const}])await expect(f.service.inspect('server',1,spec)).rejects.toThrow('INPUT_INVALID');await expect(f.service.inspect('server',1,{...rename,destination:'/elsewhere/new'})).rejects.toThrow('PATH_UNSUPPORTED');await expect(f.service.inspect('server',1,{...rename,destination:rename.source})).rejects.toThrow('NAME_CONFLICT');const original=f.sftp.lstat.bind(f.sftp);f.sftp.lstat=(path,done)=>original(path,(error,attrs)=>done(error,attrs?{...attrs,isSymbolicLink:()=>path==='/home/source'}:attrs));await expect(f.service.inspect('server',1,rename)).rejects.toThrow('PATH_UNSUPPORTED');});
  it('releases acquired locks when preparation sees a source change and refuses duplicates/busy locks',async()=>{const f=fixture(),stat=await f.service.inspect('server',1,rename);await expect(f.service.prepare('server',1,'bad',rename,{...stat!,mtime:99})).rejects.toThrow('SOURCE_CHANGED');expect(await f.service.prepare('server',1,'one',rename,stat)).toBe(true);await expect(f.service.prepare('server',1,'one',rename,stat)).rejects.toThrow('REQUEST_BUSY');expect(await f.service.prepare('server',1,'two',rename,stat)).toBe(false);await expect(f.service.step('server',2,'one','first')).rejects.toThrow('TOKEN_EXPIRED');await expect(f.service.step('server',1,'one','remove_source')).rejects.toThrow('REQUEST_BUSY');f.service.finish('one',false);});
  it('retains a busy mutation until the actual callback and refuses a second dispatch or premature finish',async()=>{const f=fixture(),stat=await f.service.inspect('server',1,rename);await f.service.prepare('server',1,'one',rename,stat);f.delay('link');const pending=f.service.step('server',1,'one','first');await vi.waitFor(()=>expect(f.calls).toEqual(['link']));expect(()=>f.service.finish('one',false)).toThrow('REQUEST_BUSY');await expect(f.service.step('server',1,'one','first')).rejects.toThrow('REQUEST_BUSY');f.deliver();expect(await pending).toMatchObject({phase:'first_ack'});f.service.finish('one',false);});
  it('maps explicit hardlink status8 separately from an unknown synchronous dispatch failure',async()=>{for(const code of [8,null]){const f=fixture(),stat=await f.service.inspect('server',1,rename);await f.service.prepare('server',1,'one',rename,stat);f.sftp.ext_openssh_hardlink=(_source,_destination,done)=>{if(code===null)throw new Error('SENTINEL_REMOTE_TEXT');done(Object.assign(new Error('AUTH_FAILED'),{code}));};expect(await f.service.step('server',1,'one','first')).toMatchObject({phase:code===8?'failed':'result_unknown',errorCode:code===8?'HARDLINK_UNSUPPORTED':'RESULT_UNKNOWN'});f.service.finish('one',false);}});
  it('verifies mkdir type after ACK and preserves unknown when the created path was replaced',async()=>{const f=fixture(),spec:MutationSpec={operation:'mkdir',parent:'/home',source:null,destination:'/home/new',type:null};await f.service.prepare('server',1,'one',spec,null);f.sftp.mkdir=(path,_options,done)=>{f.nodes.set(path,{type:'file',size:1,mtime:1});done(undefined);};expect(await f.service.step('server',1,'one','first')).toMatchObject({phase:'result_unknown',destinationCreated:true,errorCode:'RESULT_UNKNOWN'});f.service.finish('one',false);});
  it('bounds prepared tasks at100 without displacing any existing mutation',async()=>{const f=fixture();for(let i=0;i<100;i++)expect(await f.service.prepare('server',1,'task'+i,{operation:'mkdir',parent:'/home',source:null,destination:'/home/new'+i,type:null},null)).toBe(true);await expect(f.service.prepare('server',1,'overflow',{operation:'mkdir',parent:'/home',source:null,destination:'/home/overflow',type:null},null)).rejects.toThrow('TASK_LIMIT');for(let i=0;i<100;i++)f.service.finish('task'+i,false);});
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
