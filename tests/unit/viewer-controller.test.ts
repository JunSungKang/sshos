import { describe, expect, it } from 'vitest';
import { ViewerController } from '../../src/main/viewers';
import { DesktopController } from '../../src/main/desktop';
import type { FileController } from '../../src/main/files';
import type { ConnectionController } from '../../src/main/connections';
import type { EngineGateway } from '../../src/main/engine-gateway';
import type { ViewerDescriptor } from '../../src/shared/viewers/reader';
import type { WindowModel } from '../../src/shared/windows';
function fixture() {
  const a={serverId:crypto.randomUUID(),generation:1,sessionToken:crypto.randomUUID()},b={serverId:crypto.randomUUID(),generation:2,sessionToken:crypto.randomUUID()};let connected=true;
  const connections={sessionCapability:(token:string) => {const value=[a,b].find(row => row.sessionToken === token);if (!value || !connected) throw new Error('TOKEN_EXPIRED');return {serverId:value.serverId,generation:value.generation};},sessionIdentity:(serverId:string,generation:number) => ({generation,endpointSnapshot:{name:serverId === a.serverId ? 'serverA' : 'serverB',host:'fixture.invalid',port:22,username:'fixture',endpoint:'fixture.invalid:22'},hostKeyFingerprint:'SHA256:fixture'})} as unknown as ConnectionController;
  const desktop=new DesktopController(connections);
  const fileA=desktop.handle('desktop:registerWindow',{kind:'files',resourceToken:a.sessionToken}) as WindowModel,fileB=desktop.handle('desktop:registerWindow',{kind:'files',resourceToken:b.sessionToken}) as WindowModel;
  const entryA=crypto.randomUUID(),entryB=crypto.randomUUID(),other=crypto.randomUUID();
  const entries=new Map([[entryA,{path:'/home',rawName:'config.txt',type:'file',browser:{...a,windowId:fileA.windowId}}],[entryB,{path:'/home',rawName:'config.txt',type:'file',browser:{...b,windowId:fileB.windowId}}],[other,{path:'/home',rawName:'other.txt',type:'file',browser:{...a,windowId:fileA.windowId}}]]);
  const files={resolveEntry:(token:string) => {const row=entries.get(token);if (!row) throw new Error('TOKEN_EXPIRED');desktop.requireWindow(row.browser.windowId,'files');return row;}} as unknown as FileController;
  const trace:{action:string;serverId:string;generation:number;viewerId?:string;readGeneration?:number;path?:string}[]=[];const specifications=new Map<string,{path:string}>();
  let delayed=false,deliver:((frame:unknown)=>void)|null=null;
  const gateway={epoch:crypto.randomUUID(),request:async (request:{action:string;serverId:string;generation:number;viewerId:string;readGeneration:number;sequence:number;path:string}) => {
    trace.push(request);
    if (request.action === 'viewer:open') specifications.set(request.viewerId,{path:request.path});
    if (request.action === 'viewer:next') {
      if (delayed) return new Promise(resolve => {deliver=resolve;});
      const metadata={path:specifications.get(request.viewerId)!.path,size:1,mtime:1,readAt:request.sequence === 0 ? null : new Date().toISOString()};
      return {viewerId:request.viewerId,readGeneration:request.readGeneration,sequence:request.sequence,...(request.sequence === 0 ? {status:'chunk',bytes:Uint8Array.from([65]),metadata} : {status:'end',metadata})};
    }
    return undefined;
  }} as unknown as EngineGateway;
  const controller=new ViewerController(files,connections,desktop,gateway);
  const open=async (entryToken=entryA,kind:'text'|'image'='text') => {const window=await controller.handle('viewer:open',{entryToken,kind}) as WindowModel;return {window,descriptor:await controller.handle('viewer:get',window.windowId) as ViewerDescriptor};};
  return {controller,desktop,gateway,trace,a,b,entryA,entryB,other,fileA,open,disconnect:() => {connected=false;},delay:() => {delayed=true;},deliver:(frame:unknown) => {if (!deliver) throw new Error('No pending frame');deliver(frame);}};
}
describe('main-owned viewer capabilities',() => {
  it('deduplicates only matching server, generation, canonical path and kind',async () => {
    const f=fixture();const first=await f.open();const repeated=await f.open();const second=await f.open(f.entryB);const image=await f.open(f.entryA,'image');
    expect(repeated.window.windowId).toBe(first.window.windowId);expect(second.window.windowId).not.toBe(first.window.windowId);expect(image.window.windowId).not.toBe(first.window.windowId);expect(first.window.serverId).toBe(f.a.serverId);expect(second.window.sessionGeneration).toBe(2);
    expect(f.trace.filter(row => row.action === 'viewer:open')).toHaveLength(3);
  });
  it('refuses session tokens as viewer or entry capabilities and does not reassign a token kind',async () => {
    const f=fixture();const value=await f.open();
    expect(() => f.desktop.handle('desktop:registerWindow',{kind:'image',resourceToken:value.descriptor.viewerToken})).toThrow('TOKEN_EXPIRED');
    expect(() => f.desktop.handle('desktop:registerWindow',{kind:'text',resourceToken:f.a.sessionToken})).toThrow('TOKEN_EXPIRED');
    await expect(f.controller.handle('viewer:open',{entryToken:f.a.sessionToken,kind:'text'})).rejects.toThrow('TOKEN_EXPIRED');await expect(f.controller.handle('viewer:get',f.fileA.windowId)).rejects.toThrow('TOKEN_EXPIRED');
  });
  it('keeps a standalone viewer after explorer close and removes only owned probes',async () => {
    const f=fixture();const value=await f.open();const probe=await f.controller.handle('viewer:probe',f.entryA) as {probeToken:string};await f.controller.closeWindow(f.fileA.windowId);f.desktop.handle('desktop:closeWindow',f.fileA.windowId);
    expect((await f.controller.handle('viewer:get',value.window.windowId) as ViewerDescriptor).viewerToken).toBe(value.descriptor.viewerToken);
    await expect(f.controller.handle('viewer:next',{token:probe.probeToken,readGeneration:1,sequence:0})).rejects.toThrow('TOKEN_EXPIRED');const reread=await f.controller.handle('viewer:reread',value.descriptor.viewerToken) as ViewerDescriptor;expect(reread.readGeneration).toBe(2);
  });
  it('discards a late old read response after explicit reread and keeps the new generation pending',async () => {
    const f=fixture();const value=await f.open();f.delay();const waiting=f.controller.handle('viewer:next',{token:value.descriptor.viewerToken,readGeneration:1,sequence:0});const rejected=expect(waiting).rejects.toThrow('REQUEST_CANCELLED');
    const reread=await f.controller.handle('viewer:reread',value.descriptor.viewerToken) as ViewerDescriptor;
    f.deliver({status:'chunk',viewerId:value.descriptor.viewerId,readGeneration:1,sequence:0,bytes:Uint8Array.from([65]),metadata:{path:'/home/config.txt',size:1,mtime:1,readAt:null}});await rejected;
    const current=await f.controller.handle('viewer:get',value.window.windowId) as ViewerDescriptor;expect(current.readGeneration).toBe(reread.readGeneration);expect(current.nextSequence).toBe(0);expect(current.readState).toBe('pending');
  });
  it('enforces four viewers without evicting existing windows and binds backend epoch',async () => {
    const f=fixture();const first=await f.open();await f.open(f.entryA,'image');await f.open(f.entryB);await f.open(f.entryB,'image');await expect(f.open(f.other)).rejects.toThrow('WINDOW_LIMIT');
    (f.gateway as unknown as {epoch:string}).epoch=crypto.randomUUID();await expect(f.controller.handle('viewer:next',{token:first.descriptor.viewerToken,readGeneration:1,sequence:0})).rejects.toThrow('TOKEN_EXPIRED');
    expect((f.desktop.handle('desktop:getWindowSnapshot',undefined) as WindowModel[]).filter(row => ['text','image'].includes(row.kind))).toHaveLength(4);
  });
  it('preserves cached metadata while refusing reread after disconnect or renderer interruption',async () => {
    const f=fixture();const value=await f.open();f.controller.interruptRenderer();expect((await f.controller.handle('viewer:get',value.window.windowId) as ViewerDescriptor).readState).toBe('interrupted');f.disconnect();await expect(f.controller.handle('viewer:reread',value.descriptor.viewerToken)).rejects.toThrow('TOKEN_EXPIRED');
  });
});
