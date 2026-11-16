import {randomUUID} from 'node:crypto';
import {posix} from 'node:path';
import {textSaveInputSchema,editPreparedSchema,editResultSchema,encodeEditedText} from '../shared/viewers/editor';
import type {MutationReceipt} from '../shared/mutations';
import type {ViewerController} from './viewers';
import type {ConnectionController} from './connections';
import type {EngineGateway} from './engine-gateway';
import type {ReceiptRepository} from './persistence/receipts';
import {errorCodeOf} from '../shared/errors';
type Memory=MutationReceipt&{recordError?:boolean};
export class TextEditorController {
 private readonly pending=new Map<string,Promise<void>>();
 private readonly windows=new Set<string>();
 private readonly current=new Map<string,Memory>();
 constructor(private readonly viewers:ViewerController,private readonly connections:ConnectionController,private readonly gateway:EngineGateway,private readonly storage:()=>ReceiptRepository|null,private readonly healthy:()=>boolean){}
 get hasActive(){return this.pending.size>0;}
 isActive(id:string){return this.pending.has(id);}
 windowBusy(id:string){return this.windows.has(id);}
 overlays(){return [...this.current.values()];}
 async releaseRecord(row:MutationReceipt){if(row.operation==='edit')await this.gateway.request({action:'editor:finish',serverId:row.serverId,generation:row.generation,taskId:row.taskId,keepRestriction:false});}
 async settled(){await Promise.allSettled([...this.pending.values()]);}
 private repository(){const value=this.storage();if(!value || value.faulted || !this.healthy())throw new Error('STORAGE_FAILED');return value;}
 private validate(token:string,readGeneration:number){
  const target=this.viewers.editTarget(token,readGeneration),cap=this.connections.sessionCapability(target.sessionToken);
  if(cap.serverId!==target.serverId || cap.generation!==target.generation || target.epoch!==this.gateway.epoch)throw new Error('TOKEN_EXPIRED');
  const session=this.connections.views().find(row=>row.serverId===target.serverId && row.generation===target.generation);
  if(!session || session.sftp!=='available')throw new Error('SFTP_UNAVAILABLE');
  if(session.os!=='supported' && !session.osConfirmed)throw new Error(session.os==='unknown'?'OS_UNKNOWN':'OS_UNSUPPORTED');
  this.repository();return target;
 }
 async save(raw:unknown):Promise<void>{
  const input=textSaveInputSchema.parse(raw),bytes=encodeEditedText(input.text,{hasBOM:false,lineEnding:'lf'});
  const target=this.validate(input.token,input.readGeneration);if(this.windows.has(target.windowId!))throw new Error('REQUEST_BUSY');
  const taskId=randomUUID();this.windows.add(target.windowId!);
  const operation=this.run(taskId,input.token,input.readGeneration,bytes).finally(()=>{bytes.fill(0);this.pending.delete(taskId);this.windows.delete(target.windowId!);});
  this.pending.set(taskId,operation);return operation;
 }
 private async run(taskId:string,token:string,readGeneration:number,bytes:Uint8Array<ArrayBuffer>):Promise<void>{
  const target=this.validate(token,readGeneration),claims=[{path:target.parent,mode:'keep' as const},{path:target.path,mode:'write' as const}];
  let receipt:MutationReceipt|null=null,dispatched=false,registered=false;
  try{
   this.repository().checkNew(target.serverId,claims);
   const tempPath=posix.join(target.parent,`.sshos-edit-${taskId}.tmp`);
   const prepared=editPreparedSchema.parse(await this.gateway.request({action:'editor:prepare',serverId:target.serverId,generation:target.generation,taskId,viewerId:target.viewerId,readGeneration,tempPath}));
   this.validate(token,readGeneration);this.repository().checkNew(target.serverId,claims);
   const identity=this.connections.sessionIdentity(target.serverId,target.generation),now=new Date().toISOString();
   receipt={kind:'file_mutation',operation:'edit',taskId,serverId:target.serverId,generation:target.generation,backendEpoch:this.gateway.epoch,endpointSnapshot:identity.endpointSnapshot,hostKeyFingerprint:identity.hostKeyFingerprint,source:target.path,destination:target.path,parent:target.parent,tempPath,sourceInitialStat:prepared.stat,phase:'prepared',stage:'prepared',lastConfirmedPhase:'prepared',destinationCreated:false,sourceRemovalConfirmed:false,errorCode:null,recoveryUncertain:false,recoveredFromPhase:null,acknowledgedAt:null,createdAt:now,updatedAt:now};
   await this.repository().save(receipt);registered=true;this.current.set(taskId,receipt);this.validate(token,readGeneration);dispatched=true;
   const result=editResultSchema.parse(await this.gateway.request({action:'editor:save',serverId:target.serverId,generation:target.generation,receipt,bytes}));
   if(result.receipt.taskId!==taskId || result.receipt.serverId!==target.serverId || result.receipt.generation!==target.generation || result.receipt.backendEpoch!==this.gateway.epoch)throw new Error('INPUT_INVALID');
   receipt=result.receipt;this.current.set(taskId,{...receipt,...(result.recordError?{recordError:true}:{})});
   if(result.recordError)throw new Error('STORAGE_FAILED');if(receipt.phase!=='completed')throw new Error(receipt.errorCode ?? 'RESULT_UNKNOWN');
  }catch(error){
   if(receipt && registered && receipt.phase==='prepared'){
    receipt={...receipt,phase:dispatched?'result_unknown':'failed',errorCode:dispatched?'RESULT_UNKNOWN':errorCodeOf(error),updatedAt:new Date().toISOString()};
    try{await this.repository().save(receipt);this.current.set(taskId,receipt);}catch{this.current.set(taskId,{...receipt,recordError:true});}
   }else if(!registered)receipt=null;
   throw error;
  }finally{
   const keep=Boolean(receipt && (['partial','result_unknown'].includes(receipt.phase) || this.current.get(taskId)?.recordError));
   await this.gateway.request({action:'editor:finish',serverId:target.serverId,generation:target.generation,taskId,keepRestriction:keep}).catch(()=>{});
   if(!this.current.get(taskId)?.recordError)this.current.delete(taskId);
  }
 }
 async reconcileStorage(repo:ReceiptRepository){await this.settled();for(const row of this.current.values()){if(!row.recordError)continue;const disk=repo.get(row.taskId);if(!disk || disk.kind!=='file_mutation' || disk.operation!=='edit' || disk.source!==row.source || disk.tempPath!==row.tempPath || disk.backendEpoch!==row.backendEpoch || disk.serverId!==row.serverId || disk.generation!==row.generation)throw new Error('STORAGE_FAILED');const {recordError:_error,...value}=row;if(['completed','failed','partial','result_unknown'].includes(disk.phase)){if(disk.phase!==value.phase && !(disk.phase==='completed' && disk.lastConfirmedPhase==='text_saved'))throw new Error('STORAGE_FAILED');}else await repo.save(value);if(disk.phase==='completed' || disk.phase==='failed')await this.releaseRecord(disk);this.current.delete(row.taskId);}}
}
