import { afterEach,describe,expect,it,vi } from 'vitest';
import { mkdir,mkdtemp,rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TransferController } from '../../src/main/transfers';
import { ReceiptRepository } from '../../src/main/persistence/receipts';
import type { TransferPreviews,ConfirmedTransfer } from '../../src/main/transfer-previews';
import type { TransferSelections } from '../../src/main/transfer-selections';
import type { ConnectionController } from '../../src/main/connections';
import type { EngineGateway } from '../../src/main/engine-gateway';
import type { TransferRuntime,StagedTransfer } from '../../src/shared/transfer-protocol';
import { transferReceipt } from '../fixtures/transfers';
const owned:string[]=[];afterEach(async () => {vi.restoreAllMocks();for (const root of owned.splice(0)) await rm(root,{recursive:true});});
async function fixture(count=2) {
  await mkdir(resolve('.local/tmp'),{recursive:true});const root=await mkdtemp(resolve('.local/tmp/main-transfers-'));owned.push(root);const repo=await ReceiptRepository.open(root),epoch=crypto.randomUUID(),serverId=crypto.randomUUID(),sessionToken=crypto.randomUUID();
  const specs:StagedTransfer[]=Array.from({length:count},()=> {const row=transferReceipt();row.serverId=serverId;row.backendEpoch=epoch;row.destination+='-'+row.taskId;return {row,localDirectory:{path:row.localParent,identity:'1:2'}};});
  const batch:ConfirmedTransfer={serverId,generation:1,sessionToken,epoch,specs,selectionTokens:[crypto.randomUUID()]};let valid=true,stageFailure=false,gate:Promise<void>|null=null;let tokenUsed=false;
  const previews={consume:() => {if (tokenUsed) throw new Error('TOKEN_EXPIRED');tokenUsed=true;return structuredClone(batch);},invalidate:vi.fn()} as unknown as TransferPreviews;
  const selections={release:vi.fn(),invalidate:vi.fn()} as unknown as TransferSelections;
  const connections={sessionCapability:() => {if (!valid) throw new Error('TOKEN_EXPIRED');return {serverId,generation:1};}} as unknown as ConnectionController;
  const requests:{action:string}[]=[];let snapshot:TransferRuntime[]=[];let sequence=10;
  const gateway={epoch,request:vi.fn(async (request:{action:string;index?:number}) => {requests.push(request);if (request.action === 'transfer:stage' && request.index === 1 && stageFailure) throw new Error('CONNECTION_LOST');if (request.action === 'transfer:commit') {expect(specs.every(spec => repo.get(spec.row.taskId)?.phase === 'queued')).toBe(true);if (gate) await gate;return specs.map(spec=>spec.row.taskId);}if (request.action === 'transfer:snapshot') return {rows:snapshot,sequence,nextOffset:null};return undefined;})} as unknown as EngineGateway;
  const controller=new TransferController(previews,selections,connections,gateway,()=>repo,()=>true,async ()=>{});
  const runtime=(index:number,phase:TransferRuntime['phase']='transferring'):TransferRuntime => {const row=specs[index]!.row;return {taskId:row.taskId,serverId,generation:1,phase,totalBytes:row.totalBytes,transferredBytes:1,verifiedBytes:0,bytesPerSecond:12,cleanupState:'needed',tempCreated:true,destinationCreated:false,lastConfirmedPhase:'temp_created',errorCode:null,updatedAt:new Date().toISOString(),recordError:false,active:true,slotOccupied:true,cleanupPending:false};};
  return {controller,repo,specs,batch,requests,runtime,selections,start:()=>controller.handle('transfer:start',crypto.randomUUID()),failStage:()=>{stageFailure=true;},invalidate:()=>{valid=false;},setGate:(value:Promise<void>)=>{gate=value;},setSnapshot:(rows:TransferRuntime[],seq:number)=>{snapshot=rows;sequence=seq;}};
}
describe('main-owned transfer acceptance',()=> {
  it('reserves the whole batch, durably saves every row and stages all rows before one commit',async ()=> {
    const f=await fixture();expect(await f.start()).toEqual(f.specs.map(spec=>spec.row.taskId));expect(f.requests.map(row=>row.action)).toEqual(['transfer:reserve','transfer:stage','transfer:stage','transfer:commit']);expect(f.controller.shelf()).toMatchObject({queued:2,registering:0});expect(f.selections.release).toHaveBeenCalledWith(f.batch.selectionTokens);await expect(f.start()).rejects.toThrow('TOKEN_EXPIRED');
  });
  it('never commits a partially staged batch and interrupts already saved intents',async ()=> {
    const f=await fixture();f.failStage();await expect(f.start()).rejects.toThrow('CONNECTION_LOST');expect(f.requests.map(row=>row.action)).not.toContain('transfer:commit');expect(f.requests.at(-1)?.action).toBe('transfer:release');expect(f.repo.snapshots().every(row=>row.phase==='interrupted')).toBe(true);expect(f.controller.overlays()).toEqual([]);
  });
  it('refuses dispatch after durable storage failure and marks visible registration failure',async ()=> {
    const f=await fixture();const save=f.repo.save.bind(f.repo);let writes=0;vi.spyOn(f.repo,'save').mockImplementation(async row => {if (++writes>=2) {f.repo.markFault();throw new Error('STORAGE_FAILED');}await save(row);});await expect(f.start()).rejects.toThrow('STORAGE_FAILED');expect(f.requests.map(row=>row.action)).not.toContain('transfer:commit');expect(f.controller.overlays()[0]).toMatchObject({phase:'interrupted',recordError:true});
  });
  it('keeps accepted jobs across renderer invalidation and prevents cancellation during registration',async ()=> {
    const f=await fixture(1);let release!:()=>void;f.setGate(new Promise<void>(done=>{release=done;}));const starting=f.start();await vi.waitFor(()=>expect(f.requests.at(-1)?.action).toBe('transfer:commit'));const id=f.specs[0]!.row.taskId;await expect(f.controller.handle('transfer:cancel',id)).rejects.toThrow('REQUEST_BUSY');f.controller.invalidateRenderer();release();await starting;await f.controller.handle('transfer:cancel',id);expect(f.requests.at(-1)?.action).toBe('transfer:cancel');
  });
  it('ignores unregistered/stale events and refuses an old resync snapshot to rewind newer progress',async ()=> {
    const f=await fixture(1);await f.start();const old=f.runtime(0),newer={...old,transferredBytes:2};f.setSnapshot([old],10);f.controller.observe(old,true,9);f.controller.observe(newer,false,11);await vi.waitFor(()=>expect(f.requests.at(-1)?.action).toBe('transfer:snapshot'));await Promise.resolve();expect(f.controller.overlays()[0]?.transferredBytes).toBe(2);f.controller.observe({...newer,taskId:crypto.randomUUID()},false,12);expect(f.controller.shelf().active).toHaveLength(1);
  });
  it('uses a consistent worker snapshot and durable terminal receipt when a completion event was lost',async ()=> {
    const f=await fixture(1);await f.start();const row=f.specs[0]!.row;f.controller.observe(f.runtime(0),false,1);await f.repo.save({...row,phase:'completed',destinationCreated:true,transferredBytes:3,verifiedBytes:3,streamSha256:'a'.repeat(64),cleanupState:'confirmed'});f.setSnapshot([],10);f.controller.observe({...f.runtime(0),taskId:crypto.randomUUID()},true,9);await vi.waitFor(()=>expect(f.controller.overlays()).toEqual([]));expect(f.controller.shelf().active).toEqual([]);
  });
  it('recovers an engine loss from the durable finalizing intent without inventing success',async ()=> {
    const f=await fixture(1);await f.start();const spec=f.specs[0]!,row={...spec.row,phase:'finalizing' as const,stage:'finalize_intent',dispatchAllowed:true,tempCreated:true,cleanupState:'needed' as const};await f.repo.save(row);f.controller.observe({...f.runtime(0),'phase':'finalizing'},false,1);await f.controller.engineStopped();expect(f.repo.get(row.taskId)).toMatchObject({phase:'result_unknown',recoveredFromPhase:'finalizing',destinationCreated:false});expect(f.controller.shelf()).toMatchObject({active:[],unresolved:1});
  });
});
