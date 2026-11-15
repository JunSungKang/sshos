import { errorCodeOf } from '../../shared/errors';
import type { ExecutionRecoveryUncertainty } from '../../shared/storage-recovery';
import type { ClientChannel } from 'ssh2';
import { executionCommand,executionReceiptSchema,executionSpecSchema,executionTerminal,type ExecutionReceipt,type ExecutionSpec } from '../../shared/executions';
import { initialStatSchema,type InitialStat } from '../../shared/mutations';
import type { SessionManager } from '../connection/session-manager';
import type { WorkerReceiptWriter } from '../receipt-writer';
import { ExecutionChannels,type ChannelTicket } from './channels';
import { ExecutionInspector } from './inspect';
import { ExecutionOutputRing,type OutputBatch } from './output-ring';
export type ExecutionRuntime={receipt:ExecutionReceipt;recordError:boolean;recordPending:boolean;active:boolean;cleanupPending:boolean};
type Job={sessionEnded:boolean;row:ExecutionReceipt;ticket:ChannelTicket|null;channel:ClientChannel|null;active:boolean;cleanupPending:boolean;recordError:boolean;pending:number;tail:Promise<void>;closeRequested:boolean;channelError:boolean;stopTimer:ReturnType<typeof setTimeout>|null;outputTimer:ReturnType<typeof setTimeout>|null;outputAt:number};
const errorCode=errorCodeOf;
export class GUIExecutions {
  private readonly jobs=new Map<string,Job>();readonly output=new ExecutionOutputRing();readonly channels:ExecutionChannels;readonly inspector:ExecutionInspector;
  constructor(private readonly epoch:string,private readonly sessions:Pick<SessionManager,'control'|'auxiliary'|'withMetadata'>,private readonly writer:Pick<WorkerReceiptWriter,'persist'|'faulted'>,private readonly emit:(row:ExecutionRuntime)=>void) {
    this.channels=new ExecutionChannels(sessions,(id,pending)=>{const job=this.jobs.get(id);if(job){job.cleanupPending=pending;this.publish(job);}});this.inspector=new ExecutionInspector((serverId,generation)=>sessions.control(serverId,generation,true));
  }
 get hasActive():boolean {return [...this.jobs.values()].some(job=>job.active || job.pending>0 || job.cleanupPending);}
 async settled():Promise<void> {await Promise.all([...this.jobs.values()].map(job=>job.tail));}
 async reconcileStorage(uncertain:ExecutionRecoveryUncertainty[]):Promise<void> {
  const byId=new Map(uncertain.map(row=>[row.taskId,row.fromPhase]));
  await Promise.all([...this.jobs.values()].filter(job=>job.recordError || byId.has(job.row.taskId)).map(async job=>{const change:Partial<ExecutionReceipt>=byId.has(job.row.taskId) ? {phase:'result_unknown',recoveryUncertain:true,recoveredFromPhase:byId.get(job.row.taskId)!,acknowledgedAt:null,errorCode:'EXEC_RESULT_UNKNOWN'}:{};await this.persist(job,change);job.recordError=false;this.publish(job);}));
 }
  private publish(job:Job):void {try{this.emit(this.runtime(job));}catch{}}
  private runtime(job:Job):ExecutionRuntime{return {receipt:structuredClone(job.row),recordError:job.recordError,recordPending:job.pending>0,active:job.active,cleanupPending:job.cleanupPending};}
  private persist(job:Job,change:Partial<ExecutionReceipt>):Promise<void> {
    job.row=executionReceiptSchema.parse({...job.row,...change,updatedAt:new Date().toISOString()});const row=structuredClone(job.row);job.pending++;this.publish(job);
    const operation=job.tail.then(()=>this.writer.persist(row));job.tail=operation.catch(()=>{job.recordError=true;}).finally(()=>{job.pending--;this.publish(job);});return operation;
  }
  private save(job:Job,change:Partial<ExecutionReceipt>):void {if(this.jobs.get(job.row.taskId) !== job)return;void this.persist(job,change).catch(()=>{});}
  private require(serverId:string,generation:number,id:string):Job {const job=this.jobs.get(id);if(!job || job.row.serverId !== serverId || job.row.generation !== generation)throw new Error('TOKEN_EXPIRED');return job;}
  inspect(serverId:string,generation:number,spec:ExecutionSpec):Promise<InitialStat> {return this.sessions.withMetadata(serverId,generation,()=>this.inspector.inspect(serverId,generation,spec));}
  start(input:ExecutionReceipt,rawSpec:ExecutionSpec,rawExpected:InitialStat):ExecutionRuntime {
    if(this.writer.faulted)throw new Error('STORAGE_FAILED');const row=executionReceiptSchema.parse(input),spec=executionSpecSchema.parse(rawSpec),expected=initialStatSchema.parse(rawExpected);
    if(row.kind !== 'gui_exec' || row.phase !== 'prepared' || row.backendEpoch !== this.epoch || row.source !== spec.path || row.cwd !== spec.cwd || row.channelAccepted || row.channelClosed || row.exitObserved || row.exitCode !== null || row.exitSignal !== null || row.stopRequestedAt !== null || row.acknowledgedAt !== null || row.recoveryUncertain || this.jobs.has(row.taskId) || this.jobs.size>=1000)throw new Error('INPUT_INVALID');
    const job:Job={sessionEnded:false,row,ticket:null,channel:null,active:true,cleanupPending:false,recordError:false,pending:0,tail:Promise.resolve(),closeRequested:false,channelError:false,stopTimer:null,outputTimer:null,outputAt:0};this.jobs.set(row.taskId,job);this.output.register(row.taskId);
    try {
      const ticket=this.channels.open(row.taskId,row.serverId,row.generation,{kind:'gui_exec',command:executionCommand(spec)},async()=>{
        const current=await this.inspect(row.serverId,row.generation,spec);if(JSON.stringify(current) !== JSON.stringify(expected))throw new Error('SOURCE_CHANGED');if(job.closeRequested)throw new Error('EXEC_CANCELLED_NOT_SENT');await this.persist(job,{phase:'dispatching',lastConfirmedPhase:'dispatch_intent'});
      },channel=>this.accepted(job,channel));job.ticket=ticket;
      void ticket.ready.catch(error=>{const code=errorCode(error);if(!executionTerminal(job.row.phase))this.save(job,{phase:ticket.requestSent ? code === 'EXEC_REJECTED' ? 'rejected':'result_unknown':'cancelled_not_sent',errorCode:code,lastConfirmedPhase:ticket.requestSent ? 'request_sent':'not_sent'});});
      void ticket.closed.then(()=>{job.active=false;job.cleanupPending=false;if(job.stopTimer)clearTimeout(job.stopTimer);if(job.outputTimer)clearTimeout(job.outputTimer);job.outputTimer=null;job.channel?.resume();job.channel?.stderr.resume();if(!job.row.channelClosed)this.save(job,{channelClosed:ticket.channelCloseObserved,...(!executionTerminal(job.row.phase) ? {phase:ticket.requestSent ? 'result_unknown':'cancelled_not_sent',errorCode:ticket.requestSent ? 'EXEC_RESULT_UNKNOWN':job.row.errorCode} : {})});this.output.terminal(job.row.taskId);this.publish(job);});
      this.publish(job);return this.runtime(job);
    }catch(error){this.jobs.delete(row.taskId);this.output.forget(row.taskId);throw error;}
  }
  private accepted(job:Job,channel:ClientChannel):void {
    job.channel=channel;
    const output=(stream:'stdout'|'stderr',bytes:Buffer)=>{if(job.sessionEnded || this.jobs.get(job.row.taskId) !== job)return;this.output.append(job.row.taskId,stream,bytes);const now=performance.now();job.outputAt=Math.max(now,job.outputAt)+bytes.length*1000/(1024**2);const delay=job.outputAt-now;if(delay>1){channel.pause();channel.stderr.pause();if(job.outputTimer)clearTimeout(job.outputTimer);job.outputTimer=setTimeout(()=>{job.outputTimer=null;channel.resume();channel.stderr.resume();},delay);}};
    channel.on('data',(bytes:Buffer)=>output('stdout',bytes));channel.stderr.on('data',(bytes:Buffer)=>output('stderr',bytes));
    channel.on('error',()=>{job.channelError=true;});
    channel.on('exit',(code:number|null,signal?:string)=>{const validCode=Number.isSafeInteger(code) && code !== null && code>=0 && code<=0xffffffff,validSignal=typeof signal === 'string' && /^[A-Z0-9_-]{1,32}$/u.test(signal);if(!validCode && !validSignal)return;if(job.stopTimer)clearTimeout(job.stopTimer);this.save(job,{exitObserved:true,exitCode:validCode ? code:null,exitSignal:validSignal ? signal:null,lastConfirmedPhase:'exit_observed'});});
    channel.once('close',()=>{if(job.stopTimer)clearTimeout(job.stopTimer);const known=job.row.exitObserved && !job.channelError && !job.closeRequested && !job.ticket?.transportLost,terminal=executionTerminal(job.row.phase);this.save(job,{channelClosed:job.row.channelClosed || !job.ticket?.transportLost,phase:terminal ? job.row.phase : known ? 'exited':'result_unknown',errorCode:terminal ? job.row.errorCode : known ? null:'EXEC_RESULT_UNKNOWN',lastConfirmedPhase:known ? 'exit_and_channel_close':'channel_closed_without_confirmed_exit'});});
    this.save(job,{phase:executionTerminal(job.row.phase) ? job.row.phase:'running',channelAccepted:true,lastConfirmedPhase:'channel_accepted'});
  }
  snapshot(serverId:string,generation:number):ExecutionRuntime[] {return [...this.jobs.values()].filter(job=>job.row.serverId === serverId && job.row.generation === generation).map(job=>this.runtime(job));}
  page(serverId:string,generation:number,offset:number):{rows:ExecutionRuntime[];nextOffset:number|null} {const values=this.snapshot(serverId,generation);const rows:ExecutionRuntime[]=[];let size=0;for(const row of values.slice(offset,offset+100)){const length=Buffer.byteLength(JSON.stringify(row));if(size+length>240*1024)break;size+=length;rows.push(row);}return {rows,nextOffset:offset+rows.length<values.length ? offset+rows.length:null};}
  read(serverId:string,generation:number,id:string,cursor:number):OutputBatch {this.require(serverId,generation,id);return this.output.read(id,cursor);}
  stop(serverId:string,generation:number,id:string):void {
    const job=this.require(serverId,generation,id);if(!job.channel || job.row.channelClosed || executionTerminal(job.row.phase))throw new Error('TOKEN_EXPIRED');if(job.row.stopRequestedAt)return;
    this.save(job,{phase:'stop_requested',stopRequestedAt:new Date().toISOString()});try{job.channel.signal('TERM');}catch{this.save(job,{phase:'stop_unconfirmed',errorCode:'STOP_UNCONFIRMED'});}
    job.stopTimer=setTimeout(()=>{job.stopTimer=null;if(!job.row.exitObserved && !executionTerminal(job.row.phase))this.save(job,{phase:'stop_unconfirmed',errorCode:'STOP_UNCONFIRMED'});},5000);
  }
  closeChannel(serverId:string,generation:number,id:string):void {const job=this.require(serverId,generation,id);if(!job.active)return;job.closeRequested=true;this.save(job,{phase:job.ticket?.requestSent ? 'result_unknown':'cancelled_not_sent',errorCode:job.ticket?.requestSent ? 'EXEC_RESULT_UNKNOWN':null});job.ticket?.close();}
  async forget(serverId:string,generation:number,id:string):Promise<void> {const job=this.require(serverId,generation,id);if(job.active || job.pending)throw new Error('REQUEST_BUSY');await job.tail;this.output.forget(id);this.jobs.delete(id);}
  sessionChanged(serverId:string,generation:number,connected:boolean):void {for(const job of this.jobs.values())if(job.row.serverId === serverId && (!connected || job.row.generation !== generation)){job.sessionEnded=true;this.output.clear(job.row.taskId);}}
}
