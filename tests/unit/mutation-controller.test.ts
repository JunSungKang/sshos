import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MutationController } from '../../src/main/mutations';
import { ReceiptRepository } from '../../src/main/persistence/receipts';
import type { FileController } from '../../src/main/files';
import type { ConnectionController } from '../../src/main/connections';
import type { EngineGateway } from '../../src/main/engine-gateway';
import type { MutationPreview } from '../../src/shared/mutations';
const owned:string[]=[];
afterEach(async () => {vi.restoreAllMocks();for (const path of owned.splice(0)) await rm(path,{recursive:true});});
async function fixture(failPhase?:string) {
  const base=resolve('.local/tmp');await mkdir(base,{recursive:true});const directory=await mkdtemp(resolve(base,'controller-'));owned.push(directory);const repo=await ReceiptRepository.open(directory);
  const serverId=crypto.randomUUID(),sessionToken=crypto.randomUUID(),targetToken=crypto.randomUUID();const trace:string[]=[];
  const files={resolveDirectory:(token:string) => {if (token !== targetToken) throw new Error('TOKEN_EXPIRED');return {path:'/home',browser:{serverId,generation:2,sessionToken}};}} as unknown as FileController;
  const identity={generation:2,endpointSnapshot:{name:'fixture',host:'example.invalid',port:22,username:'fixture',endpoint:'example.invalid:22'},hostKeyFingerprint:'SHA256:fixture'};
  const connections={sessionCapability:(token:string) => {if (token !== sessionToken) throw new Error('TOKEN_EXPIRED');return {serverId,generation:2};},views:() => [{serverId,generation:2,sftp:'available',os:'supported',osConfirmed:false}],sessionIdentity:() => identity} as unknown as ConnectionController;
  const originalSave=repo.save.bind(repo);
  vi.spyOn(repo,'save').mockImplementation(async row => {trace.push('save:'+row.phase);if (row.phase === failPhase) throw new Error('STORAGE_FAILED');await originalSave(row);});
  const gateway={epoch:crypto.randomUUID(),request:async (request:{action:string;serverId:string;generation:number}) => {
    expect(request.serverId).toBe(serverId);expect(request.generation).toBe(2);trace.push(request.action);
    if (request.action === 'mutation:inspect') return null;
    if (request.action === 'mutation:prepare') {expect(repo.snapshots()[0]?.phase).toBe('prepared');return true;}
    if (request.action === 'mutation:step') {expect(repo.snapshots()[0]?.phase).toBe('dispatched');return {phase:'completed',destinationCreated:true,sourceRemovalConfirmed:false,lastConfirmedPhase:'mkdir_ack',errorCode:null};}
    return undefined;
  }} as unknown as EngineGateway;
  const controller=new MutationController(files,connections,gateway,() => repo,() => true);
  return {controller,repo,targetToken,trace};
}
it('persists intent before every mutation dispatch and consumes confirmation once',async () => {
  const f=await fixture();const preview=await f.controller.handle('file:previewMutation',{operation:'mkdir',targetToken:f.targetToken,name:'new'}) as MutationPreview;
  expect(f.trace).toEqual(['mutation:inspect']);const id=await f.controller.handle('file:startMutation',preview.confirmationToken);await f.controller.settled();
  expect(f.trace.indexOf('save:dispatched')).toBeLessThan(f.trace.indexOf('mutation:step'));expect(f.repo.snapshots()[0]?.phase).toBe('completed');expect(f.repo.snapshots()[0]?.taskId).toBe(id);
  await expect(f.controller.handle('file:startMutation',preview.confirmationToken)).rejects.toThrow('TOKEN_EXPIRED');
});
it('never dispatches when saving intent fails',async () => {
  const f=await fixture('dispatched');const preview=await f.controller.handle('file:previewMutation',{operation:'mkdir',targetToken:f.targetToken,name:'new'}) as MutationPreview;
  await f.controller.handle('file:startMutation',preview.confirmationToken);await f.controller.settled();expect(f.trace).not.toContain('mutation:step');expect(f.controller.snapshots()[0]?.phase).toBe('failed');
});
it('preserves observed destination creation when receipt save fails after ACK',async () => {
  const f=await fixture('completed');const preview=await f.controller.handle('file:previewMutation',{operation:'mkdir',targetToken:f.targetToken,name:'new'}) as MutationPreview;
  await f.controller.handle('file:startMutation',preview.confirmationToken);await f.controller.settled();const row=f.controller.snapshots()[0];expect(row?.phase).toBe('result_unknown');expect(row?.destinationCreated).toBe(true);expect(row?.errorCode).toBe('STORAGE_FAILED');
});
it('rejects expired confirmation without any change request',async () => {
  const f=await fixture();const clock=vi.spyOn(performance,'now').mockReturnValue(0);
  const preview=await f.controller.handle('file:previewMutation',{operation:'mkdir',targetToken:f.targetToken,name:'new'}) as MutationPreview;clock.mockReturnValue(60001);
  await expect(f.controller.handle('file:startMutation',preview.confirmationToken)).rejects.toThrow('TOKEN_EXPIRED');expect(f.trace).toEqual(['mutation:inspect']);
});
it('keeps task pages below the IPC byte limit even with maximum-length paths',async () => {
  const f=await fixture();
  const path='/'+Array.from({length:15},() => 'a'.repeat(255)).join('/')+'/end';
  const now=new Date().toISOString();
  const rows=Array.from({length:100},() => ({taskId:crypto.randomUUID(),kind:'file_mutation',operation:'rename',phase:'completed',endpointSnapshot:{name:'fixture'},source:path,destination:path+'2',errorCode:null,acknowledgedAt:null,updatedAt:now,createdAt:now}));
  vi.spyOn(f.repo,'snapshots').mockReturnValue(rows as unknown as ReturnType<ReceiptRepository['snapshots']>);
  const page=await f.controller.handle('task:list',0) as {rows:unknown[];nextOffset:number|null};
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(256*1024);expect(page.rows.length).toBeLessThan(100);expect(page.nextOffset).toBe(page.rows.length);
});
