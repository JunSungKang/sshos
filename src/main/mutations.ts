import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';
import { validName } from '../shared/files';
import { initialStatSchema, mutationResultSchema, type MutationPreview, type MutationReceipt, type MutationSpec, type InitialStat, type RecordActionPreview } from '../shared/mutations';
import { mutationClaims } from '../worker/files/mutations';
import type { ConnectionController } from './connections';
import type { FileController } from './files';
import type { EngineGateway } from './engine-gateway';
import type { ReceiptRepository } from './persistence/receipts';

type Preview = {spec:MutationSpec;stat:InitialStat|null;serverId:string;generation:number;sessionToken:string;deadline:number;view:MutationPreview};
export class MutationController {
  private readonly previews=new Map<string,Preview>();
  private readonly running=new Set<string>();
  private readonly current=new Map<string,MutationReceipt & {recordError?:boolean}>();
  private readonly recordActions=new Map<string,{id:string;action:'acknowledge'|'forget';updatedAt:string|null;deadline:number}>();
  constructor(private readonly files:FileController,private readonly connections:ConnectionController,private readonly gateway:EngineGateway,private readonly storage:() => ReceiptRepository|null,private readonly stateHealthy:() => boolean) {}
  async settled():Promise<void> { while (this.running.size) await new Promise(resolve => setTimeout(resolve,50)); }
  private repository():ReceiptRepository { const repo=this.storage(); if (!repo || repo.faulted || !this.stateHealthy()) throw new Error('STORAGE_FAILED'); return repo; }
  private validateSession(serverId:string,generation:number,sessionToken:string):void {
    const capability=this.connections.sessionCapability(sessionToken); if (capability.serverId !== serverId || capability.generation !== generation) throw new Error('TOKEN_EXPIRED');
    const session=this.connections.views().find(row => row.serverId === serverId && row.generation === generation);
    if (!session || session.sftp !== 'available') throw new Error('SFTP_UNAVAILABLE');
    if (session.os !== 'supported' && !session.osConfirmed) throw new Error(session.os === 'unknown' ? 'OS_UNKNOWN' : 'OS_UNSUPPORTED');
  }
  private async preview(payload:unknown):Promise<MutationPreview> {
    const input=z.object({operation:z.enum(['mkdir','rename','delete']),targetToken:z.uuid(),name:z.string().max(1024).optional()}).strict().parse(payload);
    if (input.operation !== 'delete' && (!input.name || !validName(input.name))) throw new Error('PATH_UNSUPPORTED');
    const entry=input.operation === 'mkdir' ? null : this.files.resolveEntry(input.targetToken);
    const target=entry ?? this.files.resolveDirectory(input.targetToken);
    const spec:MutationSpec={operation:input.operation,parent:target.path,source:entry ? posix.join(entry.path,entry.rawName) : null,destination:input.operation === 'delete' ? null : posix.join(target.path,input.name!),type:entry?.type ?? null};
    const {serverId,generation,sessionToken}=target.browser;
    this.validateSession(serverId,generation,sessionToken); this.repository().checkNew(serverId,mutationClaims(spec));
    const stat=initialStatSchema.nullable().parse(await this.gateway.request({action:'mutation:inspect',serverId,generation,spec}));
    this.validateSession(serverId,generation,sessionToken);
    const identity=this.connections.sessionIdentity(serverId,generation);
    for (const [id,value] of this.previews) if (value.deadline<performance.now()) this.previews.delete(id);
    if (this.previews.size>=20) throw new Error('REQUEST_BUSY');
    const token=randomUUID(); const view:MutationPreview={confirmationToken:token,operation:spec.operation,serverName:identity.endpointSnapshot.name,endpoint:identity.endpointSnapshot.endpoint,username:identity.endpointSnapshot.username,source:spec.source,destination:spec.destination,expiresAt:new Date(Date.now()+60000).toISOString()};
    this.previews.set(token,{spec,stat,serverId,generation,sessionToken,deadline:performance.now()+60000,view}); return view;
  }
  private async start(token:string):Promise<string> {
    const preview=this.previews.get(token); this.previews.delete(token);
    if (!preview || preview.deadline<performance.now()) throw new Error('TOKEN_EXPIRED');
    if (this.running.size>=100) throw new Error('TASK_LIMIT');
    this.validateSession(preview.serverId,preview.generation,preview.sessionToken);
    const repo=this.repository(); repo.checkNew(preview.serverId,mutationClaims(preview.spec));
    const identity=this.connections.sessionIdentity(preview.serverId,preview.generation); const taskId=randomUUID(); const now=new Date().toISOString();
    const receipt:MutationReceipt={kind:'file_mutation',taskId,serverId:preview.serverId,generation:preview.generation,backendEpoch:this.gateway.epoch,endpointSnapshot:identity.endpointSnapshot,hostKeyFingerprint:identity.hostKeyFingerprint,...preview.spec,sourceInitialStat:preview.stat,phase:'prepared',stage:'prepared',lastConfirmedPhase:'prepared',destinationCreated:false,sourceRemovalConfirmed:false,errorCode:null,recoveryUncertain:false,recoveredFromPhase:null,acknowledgedAt:null,createdAt:now,updatedAt:now};
    // type is preview-only; it is not an undeclared persisted field.
    const {type:_type,...strictReceipt}=receipt as MutationReceipt & {type?:unknown};
    this.running.add(taskId);
    try { await repo.save(strictReceipt); } catch (error) {this.running.delete(taskId);throw error;}
    this.current.set(taskId,strictReceipt);
    void this.run(strictReceipt,preview); return taskId;
  }
  private async run(initial:MutationReceipt,preview:Preview):Promise<void> {
    let receipt=initial; let dispatched=false; let acquired=false;
    const save=async (change:Partial<MutationReceipt>) => { receipt={...receipt,...change,updatedAt:new Date().toISOString()}; this.current.set(receipt.taskId,receipt); await this.repository().save(receipt); };
    try {
      while (!acquired) {
        this.validateSession(preview.serverId,preview.generation,preview.sessionToken);
        this.repository().checkNew(preview.serverId,mutationClaims(preview.spec));
        acquired=z.boolean().parse(await this.gateway.request({action:'mutation:prepare',serverId:preview.serverId,generation:preview.generation,taskId:receipt.taskId,spec:preview.spec,expected:preview.stat}));
        if (!acquired) await new Promise(resolve => setTimeout(resolve,250));
      }
      await save({phase:'dispatched',stage:'operation_intent'}); dispatched=true;
      let result=mutationResultSchema.parse(await this.gateway.request({action:'mutation:step',serverId:preview.serverId,generation:preview.generation,taskId:receipt.taskId,stage:'first'}));
      if (result.phase === 'first_ack') {
        await save({stage:'link_ack',lastConfirmedPhase:'link_ack',destinationCreated:true});
        await save({stage:'source_remove_intent'});
        result=mutationResultSchema.parse(await this.gateway.request({action:'mutation:step',serverId:preview.serverId,generation:preview.generation,taskId:receipt.taskId,stage:'remove_source'}));
      }
      if (result.phase === 'first_ack') throw new Error('INTERNAL_ERROR');
      await save({...result,phase:result.phase,stage:result.phase});
    } catch (error) {
      const code=error instanceof Error && /^[A-Z_]+$/u.test(error.message) ? error.message : 'INTERNAL_ERROR';
      receipt={...receipt,phase:dispatched ? 'result_unknown' : 'failed',errorCode:code === 'STORAGE_FAILED' ? code : dispatched ? 'RESULT_UNKNOWN' : code,updatedAt:new Date().toISOString()};
      this.current.set(receipt.taskId,{...receipt,...(code === 'STORAGE_FAILED' ? {recordError:true} : {})});
      try { await this.repository().save(receipt); } catch { this.current.set(receipt.taskId,{...receipt,recordError:true}); }
    } finally {
      this.running.delete(receipt.taskId);
      if (acquired) await this.gateway.request({action:'mutation:finish',serverId:preview.serverId,generation:preview.generation,taskId:receipt.taskId,keepRestriction:['result_unknown','partial'].includes(receipt.phase)}).catch(() => {});
      if (!this.current.get(receipt.taskId)?.recordError) this.current.delete(receipt.taskId);
    }
  }
  snapshots() { const values=new Map(this.storage()?.snapshots().map(row => [row.taskId,row])); for (const [id,row] of this.current) values.set(id,row); return [...values.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
  async handle(action:string,payload:unknown):Promise<unknown> {
    if (action === 'file:previewMutation') return this.preview(payload);
    if (action === 'file:startMutation') return this.start(z.uuid().parse(payload));
    if (action === 'task:list') {
      const offset=z.int().min(0).max(10000).parse(payload);
      const values=[...this.snapshots().map(row => ({row})),...(this.storage()?.damagedIds() ?? []).map(damagedId => ({damagedId}))];
      const rows=[];const damagedIds:string[]=[];let count=0;let bytes=0;
      for (const value of values.slice(offset,offset+100)) {
        if ('damagedId' in value) {damagedIds.push(value.damagedId);count++;bytes+=40;continue;}
        const row=value.row;const summary={taskId:row.taskId,kind:row.kind,operation:row.operation,serverName:row.endpointSnapshot.name,phase:row.phase,source:row.source,destination:row.destination,errorCode:row.errorCode,acknowledgedAt:row.acknowledgedAt,updatedAt:row.updatedAt,recordError:'recordError' in row && row.recordError === true};
        const size=Buffer.byteLength(JSON.stringify(summary));if (bytes+size>240*1024) break;rows.push(summary);bytes+=size;count++;
      }
      return {rows,damagedIds,nextOffset:offset+count<values.length ? offset+count : null};
    }
    if (action === 'task:inspect') { const id=z.uuid().parse(payload); const row=this.snapshots().find(row => row.taskId === id); if (!row) throw new Error('INPUT_INVALID'); return row; }
    if (action === 'task:previewRecordAction') {
      const input=z.object({id:z.uuid(),action:z.enum(['acknowledge','forget'])}).strict().parse(payload); const row=this.snapshots().find(row => row.taskId === input.id);
      if (this.running.has(input.id) || (!row && !this.storage()?.damagedIds().includes(input.id))) throw new Error('INPUT_INVALID');
      if (input.action === 'acknowledge' && (!row || !['result_unknown','partial'].includes(row.phase) || row.acknowledgedAt)) throw new Error('INPUT_INVALID');
      if (input.action === 'forget' && row && (!['completed','failed','result_unknown','partial'].includes(row.phase) || (['result_unknown','partial'].includes(row.phase) && !row.acknowledgedAt))) throw new Error('INPUT_INVALID');
      for (const [token,value] of this.recordActions) if (value.deadline<performance.now()) this.recordActions.delete(token);
      if (this.recordActions.size>=20) throw new Error('REQUEST_BUSY'); const token=randomUUID();
      this.recordActions.set(token,{...input,updatedAt:row?.updatedAt ?? null,deadline:performance.now()+60000});
      return {confirmationToken:token,taskId:input.id,action:input.action,source:row?.source ?? null,destination:row?.destination ?? null,phase:row?.phase ?? 'damaged'} satisfies RecordActionPreview;
    }
    if (action === 'task:applyRecordAction') {
      const token=z.uuid().parse(payload); const input=this.recordActions.get(token); this.recordActions.delete(token);
      if (!input || input.deadline<performance.now()) throw new Error('TOKEN_EXPIRED'); const row=this.snapshots().find(row => row.taskId === input.id);
      if ((row?.updatedAt ?? null) !== input.updatedAt || this.running.has(input.id)) throw new Error('TOKEN_EXPIRED');
      const repo=this.repository();
      if (input.action === 'forget') await repo.forget(input.id);
      else { await repo.acknowledge(input.id); if (row) await this.gateway.request({action:'mutation:finish',serverId:row.serverId,generation:row.generation,taskId:input.id,keepRestriction:false}).catch(() => {}); }
      this.current.delete(input.id); return;
    }
    throw new Error('INPUT_INVALID');
  }
}
