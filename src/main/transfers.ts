import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { z } from 'zod';
import { transferRuntimeSchema,type StagedTransfer,type TransferRuntime } from '../shared/transfer-protocol';
import { recoverTransfer,transferTerminal,type TransferReceipt } from '../shared/transfers';
import { receiptUnresolved } from '../shared/receipts';
import type { TransferShelf,TransferShelfRow } from '../shared/transfer-ui';
import { transferClaims } from '../worker/transfers/claims';
import type { TransferPreviews,ConfirmedTransfer } from './transfer-previews';
import type { TransferSelections } from './transfer-selections';
import type { EngineGateway } from './engine-gateway';
import type { ConnectionController } from './connections';
import type { ReceiptRepository } from './persistence/receipts';
type Job={spec:StagedTransfer;runtime:TransferRuntime|null;sequence:number;registering:boolean;commitSent:boolean};
const snapshots=z.object({sequence:z.int().nonnegative(),rows:z.array(transferRuntimeSchema).max(100),nextOffset:z.int().min(0).max(10000).nullable()}).strict();
export class TransferController {
  private readonly jobs=new Map<string,Job>();
  private readonly registrations=new Set<Promise<unknown>>();
  private readonly resyncing=new Set<string>();
  private countRevision=-1;private countRepository:ReceiptRepository|null=null;private unresolved=0;private failed=0;
  constructor(private readonly previews:TransferPreviews,private readonly selections:TransferSelections,private readonly connections:ConnectionController,private readonly gateway:EngineGateway,private readonly storage:()=>ReceiptRepository|null,private readonly stateHealthy:()=>boolean,private readonly receiptSettled:()=>Promise<void>) {}
  private repository():ReceiptRepository {const repo=this.storage();if (!repo || repo.faulted || !this.stateHealthy()) throw new Error('STORAGE_FAILED');return repo;}
  private current(batch:ConfirmedTransfer):void {if (this.gateway.epoch !== batch.epoch) throw new Error('ENGINE_STOPPED');const cap=this.connections.sessionCapability(batch.sessionToken);if (cap.serverId !== batch.serverId || cap.generation !== batch.generation) throw new Error('TOKEN_EXPIRED');}
  invalidateRenderer():void {this.previews.invalidate();this.selections.invalidate();}
  isActive(id:string):boolean {const job=this.jobs.get(id);return Boolean(job && (job.registering || job.runtime?.active || job.runtime?.cleanupPending || !transferTerminal(job.runtime?.phase ?? 'queued')));}
  private merged(job:Job):TransferReceipt & {recordError?:boolean} {
    const saved=this.storage()?.get(job.spec.row.taskId),base=saved?.kind === 'file_transfer' ? saved : job.spec.row,runtime=job.runtime;
    if (!runtime) return base;
    return {...base,phase:runtime.phase,transferredBytes:runtime.transferredBytes,verifiedBytes:runtime.verifiedBytes,tempCreated:runtime.tempCreated,destinationCreated:runtime.destinationCreated,cleanupState:runtime.cleanupState,lastConfirmedPhase:runtime.lastConfirmedPhase,errorCode:runtime.errorCode,updatedAt:runtime.updatedAt,recordError:runtime.recordError};
  }
  hasFinalizing(serverId?:string,generation?:number):boolean {return [...this.jobs.values()].some(job=>(!serverId || job.spec.row.serverId===serverId && job.spec.row.generation===generation) && ['finalize_intent_pending','finalizing'].includes(job.runtime?.phase ?? job.spec.row.phase));}
  async cancelForShutdown(serverId?:string,generation?:number):Promise<void> {
    const rows=[...this.jobs.values()].filter(job=>!serverId || job.spec.row.serverId===serverId && job.spec.row.generation===generation),epoch=this.gateway.epoch,deadline=performance.now()+10000;let index=0;
    await Promise.all(Array.from({length:Math.min(4,rows.length)},async()=>{while(index<rows.length && performance.now()<deadline && this.gateway.epoch===epoch){const job=rows[index++]!;while(this.taskState(job.spec.row.taskId).cancelable && performance.now()<deadline && this.gateway.epoch===epoch){try{await this.gateway.request({action:'transfer:cancel',serverId:job.spec.row.serverId,generation:job.spec.row.generation,taskId:job.spec.row.taskId});break;}catch(error){if(!(error instanceof Error)||error.message!=='REQUEST_BUSY')break;await new Promise(done=>setTimeout(done,20));}}}}));
  }
  taskState(id:string) {const job=this.jobs.get(id),phase=job?.runtime?.phase ?? job?.spec.row.phase;return {active:this.isActive(id),registering:job?.registering ?? false,cancelable:Boolean(job && this.isActive(id) && !job.registering && !['finalize_intent_pending','finalizing','cancel_requested'].includes(phase!)),bytesPerSecond:job?.runtime?.bytesPerSecond ?? null,cleanupPending:job?.runtime?.cleanupPending ?? false};}
  overlays():(TransferReceipt & {recordError?:boolean})[] {return [...this.jobs.values()].map(job => this.merged(job));}
  observe(runtime:TransferRuntime,gap:boolean,sequence:number):void {
    if (gap) {const groups=new Map([...this.jobs.values()].map(job => [`${job.spec.row.serverId}:${job.spec.row.generation}`,job.spec.row]));for (const row of groups.values()) void this.resync(row.serverId,row.generation);}
    const job=this.jobs.get(runtime.taskId);if (!job || runtime.serverId !== job.spec.row.serverId || runtime.generation !== job.spec.row.generation || sequence<=job.sequence) return;
    job.runtime=structuredClone(runtime);job.sequence=sequence;
    if (!job.registering && !runtime.active && !runtime.cleanupPending && transferTerminal(runtime.phase) && !runtime.recordError) this.jobs.delete(runtime.taskId);
  }
  private async resync(serverId:string,generation:number):Promise<void> {
    const key=`${serverId}:${generation}`;if (this.resyncing.has(key)) return;this.resyncing.add(key);
    try {
      const epoch=this.gateway.epoch;
      for (let attempt=0;attempt<3;attempt++) {
        let offset:number|null=0,version:number|null=null,stable=true,pages=0;const seen=new Set<string>();
        while (offset !== null && pages++<100) {const page=snapshots.parse(await this.gateway.request({action:'transfer:snapshot',serverId,generation,offset}));if(this.gateway.epoch!==epoch)return;if (version !== null && version !== page.sequence) stable=false;version=page.sequence;for (const row of page.rows) {seen.add(row.taskId);this.observe(row,false,page.sequence);}if(page.nextOffset!==null && page.nextOffset<=offset)throw new Error('INPUT_INVALID');offset=page.nextOffset;}
        if(offset!==null)return; // Never infer absence from an incomplete bounded snapshot.
        if (!stable) continue;
        for (const [id,job] of this.jobs) if (job.spec.row.serverId === serverId && job.spec.row.generation === generation && job.commitSent && !job.registering && job.sequence<=(version ?? 0) && !seen.has(id)) {
          const saved=this.storage()?.get(id);if (saved?.kind === 'file_transfer' && transferTerminal(saved.phase)) this.jobs.delete(id);
        }
        break;
      }
    } catch { /* Persisted receipts remain available if the worker cannot answer. */ }finally {this.resyncing.delete(key);}
  }
  private async register(batch:ConfirmedTransfer):Promise<string[]> {
    const repo=this.repository(),reservationToken=randomUUID();let reserved=false,commitSent=false;const saved:StagedTransfer[]=[];
    const check=() => {this.current(batch);this.repository();for (const spec of batch.specs) {const claims=transferClaims(spec.row);repo.checkNew(batch.serverId,claims.remote,claims.local);}};
    try {
      check();await this.gateway.request({action:'transfer:reserve',serverId:batch.serverId,generation:batch.generation,reservationToken,count:batch.specs.length});reserved=true;check();
      // No worker commit is sent until every queued intent is durable and every row is staged.
      for (const spec of batch.specs) {check();await repo.save(spec.row);saved.push(spec);this.jobs.set(spec.row.taskId,{spec,runtime:null,sequence:0,registering:true,commitSent:false});}
      for (const [index,spec] of batch.specs.entries()) {check();await this.gateway.request({action:'transfer:stage',serverId:batch.serverId,generation:batch.generation,reservationToken,index,spec});}
      check();commitSent=true;for (const spec of saved) this.jobs.get(spec.row.taskId)!.commitSent=true;
      const result=z.array(z.uuid()).length(batch.specs.length).parse(await this.gateway.request({action:'transfer:commit',serverId:batch.serverId,generation:batch.generation,reservationToken}));
      if (result.some((id,index) => id !== batch.specs[index]!.row.taskId)) throw new Error('INTERNAL_ERROR');
      for (const id of result) {const job=this.jobs.get(id);if (job) {job.registering=false;if (job.runtime && !job.runtime.active && transferTerminal(job.runtime.phase) && !job.runtime.recordError && !job.runtime.cleanupPending) this.jobs.delete(id);}}
      return result;
    } catch (error) {
      if (reserved && !commitSent) await this.gateway.request({action:'transfer:release',serverId:batch.serverId,generation:batch.generation,reservationToken}).catch(() => {});
      if (commitSent) {for (const spec of saved) {const job=this.jobs.get(spec.row.taskId);if (job) job.registering=false;}await this.resync(batch.serverId,batch.generation);}
      else for (const spec of saved) {
        const row={...spec.row,phase:'interrupted' as const,stage:'interrupted',errorCode:'CONNECTION_LOST',updatedAt:new Date().toISOString()};
        try {await repo.save(row);this.jobs.delete(row.taskId);}catch {const job=this.jobs.get(row.taskId);if (job) {job.registering=false;job.runtime=this.failedRuntime(row,true);}}
      }
      throw error;
    } finally {this.selections.release(batch.selectionTokens);}
  }
  private failedRuntime(row:TransferReceipt,recordError:boolean):TransferRuntime {return {taskId:row.taskId,serverId:row.serverId,generation:row.generation,phase:row.phase,totalBytes:row.totalBytes,transferredBytes:row.transferredBytes,verifiedBytes:row.verifiedBytes,bytesPerSecond:null,cleanupState:row.cleanupState,tempCreated:row.tempCreated,destinationCreated:row.destinationCreated,lastConfirmedPhase:row.lastConfirmedPhase,errorCode:row.errorCode,updatedAt:row.updatedAt,recordError,active:false,slotOccupied:false,cleanupPending:false};}
  async engineStopped():Promise<void> {
    await this.settled();await this.receiptSettled();await this.storage()?.settled();
    for (const [id,job] of this.jobs) {
      const {recordError,...row}=this.merged(job),recovered={...recoverTransfer(row,false),updatedAt:new Date().toISOString()};job.registering=false;job.runtime=this.failedRuntime(recovered,recordError === true);
      try {await this.repository().save(recovered);this.jobs.delete(id);}catch {job.runtime.recordError=true;}
    }
  }
  get isRegistering():boolean {return this.registrations.size>0;}
  async settled():Promise<void> {await Promise.allSettled([...this.registrations]);}
  async acknowledge(row:TransferReceipt):Promise<void> {if (this.isActive(row.taskId)) throw new Error('REQUEST_BUSY');if(row.backendEpoch===this.gateway.epoch)await this.gateway.request({action:'transfer:acknowledge',serverId:row.serverId,generation:row.generation,taskId:row.taskId}).catch(error => {if (!(error instanceof Error) || error.message !== 'ENGINE_STOPPED') throw error;});this.jobs.delete(row.taskId);}
  shelf():TransferShelf {
    const repo=this.storage();if (repo && (repo !== this.countRepository || repo.revision !== this.countRevision)) {this.countRepository=repo;this.countRevision=repo.revision;const rows=repo.snapshots();this.unresolved=rows.filter(receiptUnresolved).length;this.failed=rows.filter(row => row.kind === 'file_transfer' && ['failed','interrupted','result_unknown'].includes(row.phase)).length;}
    const rows=[...this.jobs.values()],active:TransferShelfRow[]=[];let queued=0,registering=0;
    for (const job of rows) {const row=this.merged(job);if (job.registering) registering++;else if (row.phase === 'queued') queued++;if (job.runtime?.slotOccupied) active.push({taskId:row.taskId,name:basename(row.direction === 'upload' ? row.destination : row.source),serverName:row.endpointSnapshot.name,direction:row.direction,phase:row.phase,totalBytes:row.totalBytes,transferredBytes:row.transferredBytes,verifiedBytes:row.verifiedBytes,bytesPerSecond:job.runtime.bytesPerSecond,cancelable:!job.registering && !['finalize_intent_pending','finalizing','cancel_requested'].includes(row.phase) && !transferTerminal(row.phase),registering:job.registering,cleanupPending:job.runtime.cleanupPending});}
    return {active:active.slice(0,2),queued,registering,unresolved:this.unresolved,failed:this.failed};
  }
  async handle(action:string,payload:unknown):Promise<unknown> {
    if (action === 'transfer:pickUploadFiles' || action === 'transfer:pickDownloadDirectory') {if (payload !== undefined) throw new Error('INPUT_INVALID');this.repository();return action === 'transfer:pickUploadFiles' ? this.selections.pickUploadFiles() : this.selections.pickDownloadDirectory();}
    if (action === 'transfer:previewUpload') return this.previews.upload(payload);if (action === 'transfer:previewDownload') return this.previews.download(payload);
    if (action === 'transfer:getPreview') {const input=z.object({id:z.uuid(),offset:z.int().min(0).max(100)}).strict().parse(payload);return this.previews.get(input.id,input.offset);}
    if (action === 'transfer:updatePreview') {const input=z.object({id:z.uuid(),index:z.int().min(0).max(99),change:z.object({name:z.string().max(1024).optional(),selected:z.boolean().optional()}).strict()}).strict().parse(payload);return this.previews.update(input.id,input.index,{...(input.change.name === undefined ? {} : {name:input.change.name}),...(input.change.selected === undefined ? {} : {selected:input.change.selected})});}
    if (action === 'transfer:releasePreview') {this.previews.release(z.uuid().parse(payload));return;}
    if (action === 'transfer:start') {const batch=this.previews.consume(z.uuid().parse(payload));const operation=this.register(batch);this.registrations.add(operation);try {return await operation;}finally {this.registrations.delete(operation);}}
    if (action === 'transfer:cancel') {const id=z.uuid().parse(payload),job=this.jobs.get(id);if (!job || !this.isActive(id)) throw new Error('TOKEN_EXPIRED');if (job.registering) throw new Error('REQUEST_BUSY');return this.gateway.request({action:'transfer:cancel',serverId:job.spec.row.serverId,generation:job.spec.row.generation,taskId:id});}
    if (action === 'transfer:shelf') {if (payload !== undefined) throw new Error('INPUT_INVALID');return this.shelf();}
    throw new Error('INPUT_INVALID');
  }
}
