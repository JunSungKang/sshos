import type { ExecutionRecoveryUncertainty } from '../../shared/storage-recovery';
import { z } from 'zod';
import type { ClientChannel } from 'ssh2';
import { executionReceiptSchema,executionTerminal,type ExecutionReceipt } from '../../shared/executions';
import { terminalRuntimeSchema,terminalSizeSchema,type TerminalRuntime,type TerminalFreeze } from '../../shared/terminals';
import type { WorkerReceiptWriter } from '../receipt-writer';
import { ExecutionChannels,type ChannelTicket } from '../execution/channels';
import { ExecutionOutputRing } from '../execution/output-ring';
import { PTYStream } from './stream';
import { TerminalInputBoundary } from './input';
type Job={inputClosers:Set<()=>void>;eventAt:number;eventTimer:ReturnType<typeof setTimeout>|null;row:ExecutionReceipt;channel:ClientChannel|null;ticket:ChannelTicket|null;stream:PTYStream;input:TerminalInputBoundary;active:boolean;recordError:boolean;pending:number;cleanupPending:boolean;inputUncertain:boolean;closedByUser:boolean;channelError:boolean;tail:Promise<void>};
export class TerminalSessions {
 private readonly jobs=new Map<string,Job>();private readonly ring=new ExecutionOutputRing(1024**2,6*1024**2);
 constructor(private readonly epoch:string,private readonly channels:ExecutionChannels,private readonly writer:Pick<WorkerReceiptWriter,'persist'|'faulted'>,private readonly emit:(runtime:TerminalRuntime)=>void) {}
 get hasActive():boolean {return [...this.jobs.values()].some(job=>job.active || job.pending>0 || job.cleanupPending);}
 async settled():Promise<void> {await Promise.all([...this.jobs.values()].map(job=>job.tail));}
 async reconcileStorage(uncertain:ExecutionRecoveryUncertainty[]):Promise<void> {
  const byId=new Map(uncertain.map(row=>[row.taskId,row.fromPhase]));
  await Promise.all([...this.jobs.values()].filter(job=>job.recordError || byId.has(job.row.taskId)).map(async job=>{const change:Partial<ExecutionReceipt>=byId.has(job.row.taskId) ? {phase:'result_unknown',recoveryUncertain:true,recoveredFromPhase:byId.get(job.row.taskId)!,acknowledgedAt:null,errorCode:'EXEC_RESULT_UNKNOWN'}:{};await this.persist(job,change);job.recordError=false;this.publish(job);}));
 }
 private runtime(job:Job):TerminalRuntime {return terminalRuntimeSchema.parse({execution:{receipt:job.row,recordError:job.recordError,recordPending:job.pending>0,active:job.active,cleanupPending:job.cleanupPending},uiReady:job.stream.ready,inputUncertain:job.inputUncertain,inputInFlight:job.input.pendingBytes,nextInputSequence:job.input.nextSequence});}
 private publish(job:Job,immediate=true):void {if(this.jobs.get(job.row.taskId) !== job)return;const now=performance.now();if(!immediate && now-job.eventAt<250){job.eventTimer ??=setTimeout(()=>{job.eventTimer=null;this.publish(job);},250-(now-job.eventAt));return;}if(job.eventTimer){clearTimeout(job.eventTimer);job.eventTimer=null;}job.eventAt=now;try{this.emit(this.runtime(job));}catch{}}
 private require(serverId:string,generation:number,id:string):Job {const job=this.jobs.get(id);if(!job || job.row.serverId !== serverId || job.row.generation !== generation)throw new Error('TOKEN_EXPIRED');return job;}
 private persist(job:Job,change:Partial<ExecutionReceipt>):Promise<void> {job.row=executionReceiptSchema.parse({...job.row,...change,updatedAt:new Date().toISOString()});const row=structuredClone(job.row);job.pending++;this.publish(job);const operation=job.tail.then(()=>this.writer.persist(row));job.tail=operation.catch(()=>{job.recordError=true;}).finally(()=>{job.pending--;this.publish(job);});return operation;}
 private save(job:Job,change:Partial<ExecutionReceipt>):void {if(this.jobs.get(job.row.taskId) !== job)return;void this.persist(job,change).catch(()=>{});}
 start(input:ExecutionReceipt):TerminalRuntime {
  if(this.writer.faulted)throw new Error('STORAGE_FAILED');const row=executionReceiptSchema.parse(input);if(row.kind !== 'pty' || row.backendEpoch !== this.epoch || row.phase !== 'prepared' || row.channelAccepted || row.channelClosed || row.exitObserved || row.exitCode !== null || row.exitSignal !== null || row.errorCode !== null || row.recoveredFromPhase !== null || row.stopRequestedAt !== null || row.acknowledgedAt !== null || row.recoveryUncertain || this.jobs.has(row.taskId) || this.jobs.size>=1000)throw new Error('INPUT_INVALID');
  let job!:Job;const stream=new PTYStream(row.taskId,this.ring,()=>{job.channel?.pause();job.channel?.stderr.pause();},()=>{job.channel?.resume();job.channel?.stderr.resume();});job={inputClosers:new Set(),eventAt:0,eventTimer:null,row,channel:null,ticket:null,stream,input:new TerminalInputBoundary(),active:true,recordError:false,pending:0,cleanupPending:false,inputUncertain:false,closedByUser:false,channelError:false,tail:Promise.resolve()};this.jobs.set(row.taskId,job);
  try {const ticket=this.channels.open(row.taskId,row.serverId,row.generation,{kind:'pty'},()=>this.persist(job,{phase:'dispatching',lastConfirmedPhase:'dispatch_intent'}),channel=>this.accepted(job,channel));job.ticket=ticket;
   void ticket.ready.catch(error=>{job.cleanupPending=ticket.cleanupPending;if(!executionTerminal(job.row.phase))this.save(job,{phase:ticket.requestSent ? error instanceof Error && error.message === 'PTY_UNAVAILABLE' ? 'rejected':'result_unknown':'cancelled_not_sent',errorCode:error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message) ? error.message:'CONNECTION_LOST'});});
   void ticket.closed.then(()=>{job.active=false;job.cleanupPending=false;for(const close of [...job.inputClosers])close();job.stream.close();if(!job.row.channelClosed)this.save(job,{channelClosed:true,...(!executionTerminal(job.row.phase) ? {phase:ticket.requestSent ? 'result_unknown':'cancelled_not_sent',errorCode:ticket.requestSent ? 'EXEC_RESULT_UNKNOWN':job.row.errorCode} : {})});this.publish(job);});this.publish(job);return this.runtime(job);
  }catch(error){this.jobs.delete(row.taskId);stream.forget();throw error;}
 }
 private accepted(job:Job,channel:ClientChannel):void {
  job.channel=channel;channel.pause();channel.stderr.pause();channel.on('data',(bytes:Buffer)=>{if(this.jobs.get(job.row.taskId) === job)job.stream.append(bytes);});channel.stderr.on('data',(bytes:Buffer)=>{if(this.jobs.get(job.row.taskId) === job)job.stream.append(bytes);});channel.on('error',()=>{job.channelError=true;});
  channel.on('exit',(code:number|null,signal?:string)=>{const valid=code !== null && Number.isSafeInteger(code) && code>=0 && code<=0xffffffff,validSignal=typeof signal === 'string' && /^[A-Z0-9_-]{1,32}$/u.test(signal);if(valid || validSignal)this.save(job,{exitObserved:true,exitCode:valid ? code:null,exitSignal:validSignal ? signal:null,lastConfirmedPhase:'exit_observed'});});
  channel.once('close',()=>{const known=job.row.exitObserved && !job.channelError && !job.closedByUser;this.save(job,{channelClosed:true,phase:executionTerminal(job.row.phase) ? job.row.phase:known ? 'exited':'result_unknown',errorCode:known ? null:'EXEC_RESULT_UNKNOWN',lastConfirmedPhase:known ? 'exit_and_channel_close':'channel_closed_without_confirmed_exit'});});
  this.save(job,{phase:executionTerminal(job.row.phase) ? job.row.phase:'running',channelAccepted:true,lastConfirmedPhase:'channel_accepted'});if(job.stream.ready){channel.resume();channel.stderr.resume();}
 }
 freeze(serverId:string,generation:number,id:string,token:string,clear=false):TerminalFreeze {z.uuid().parse(token);const job=this.require(serverId,generation,id);if(clear)job.stream.clearDisplayHistory();const frozen=job.stream.freeze(token);this.publish(job);return {...frozen,nextInputSequence:job.input.nextSequence};}
 acknowledge(serverId:string,generation:number,id:string,token:string,offset:number):void {const job=this.require(serverId,generation,id);if(job.inputUncertain && job.input.pendingBytes)throw new Error('REQUEST_BUSY');job.stream.acknowledgeRestore(token,offset);job.inputUncertain=false;this.publish(job);}
 read(serverId:string,generation:number,id:string,cursor:number) {return this.require(serverId,generation,id).stream.read(cursor);}
 pause(serverId:string,generation:number,id:string):void {const job=this.require(serverId,generation,id);job.stream.interrupt();this.publish(job);}
 async input(serverId:string,generation:number,id:string,sequence:number,bytes:Uint8Array,source:'key'|'paste'):Promise<void> {const job=this.require(serverId,generation,id);if(!job.active || !job.channel || job.row.channelClosed || !job.stream.ready || job.inputUncertain)throw new Error('RESTORE_REQUIRED');const done=job.input.reserve(sequence,bytes,source),copy=Buffer.from(bytes);this.publish(job,false);
  let released=false;const channel=job.channel;let timer:ReturnType<typeof setTimeout>|null=null;let onClose:()=>void=()=>{};
  const release=()=>{if(released)return;released=true;if(timer)clearTimeout(timer);channel?.off('close',onClose);job.inputClosers.delete(onClose);done();copy.fill(0);this.publish(job,false);};
  try {await new Promise<void>((resolve,reject)=>{let settled=false;const fail=()=>{if(settled)return;settled=true;reject(new Error('INPUT_RESULT_UNKNOWN'));};onClose=()=>{fail();release();};channel!.once('close',onClose);job.inputClosers.add(onClose);timer=setTimeout(fail,10000);
    try {channel!.write(copy,error=>{if(!settled){settled=true;if(error)reject(new Error('INPUT_RESULT_UNKNOWN'));else resolve();}release();});}
    catch {fail();if(!job.active || job.row.channelClosed)release();}
  });}
  catch(error){job.inputUncertain=true;job.stream.interrupt();this.publish(job);throw error;}

 }
 resize(serverId:string,generation:number,id:string,input:{cols:number;rows:number}):void {const job=this.require(serverId,generation,id),size=terminalSizeSchema.parse(input);if(!job.active || !job.channel || job.row.channelClosed)throw new Error('TOKEN_EXPIRED');job.channel.setWindow(size.rows,size.cols,0,0);}
 close(serverId:string,generation:number,id:string):void {const job=this.require(serverId,generation,id);if(!job.active)return;job.closedByUser=true;job.cleanupPending=true;job.stream.interrupt();this.save(job,{phase:job.ticket?.requestSent ? 'result_unknown':'cancelled_not_sent',errorCode:job.ticket?.requestSent ? 'EXEC_RESULT_UNKNOWN':null});job.ticket?.close();}
 snapshot(serverId:string,generation:number,offset=0):{rows:TerminalRuntime[];nextOffset:number|null} {const values=[...this.jobs.values()].filter(job=>job.row.serverId === serverId && job.row.generation === generation),rows:TerminalRuntime[]=[];let size=0;for(const job of values.slice(offset,offset+100)){const row=this.runtime(job),bytes=Buffer.byteLength(JSON.stringify(row));if(size+bytes>240*1024)break;size+=bytes;rows.push(row);}return {rows,nextOffset:offset+rows.length<values.length ? offset+rows.length:null};}
 async forget(serverId:string,generation:number,id:string):Promise<void> {const job=this.require(serverId,generation,id);if(job.active || job.pending || job.input.pendingBytes)throw new Error('REQUEST_BUSY');await job.tail;if(job.eventTimer)clearTimeout(job.eventTimer);job.stream.forget();this.jobs.delete(id);}
}
