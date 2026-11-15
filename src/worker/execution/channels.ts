import { closeDiscardedChannel } from '../connection/channel-close';
import type { Client,ClientChannel } from 'ssh2';
import type { AuxiliaryLease } from '../connection/auxiliary-sockets';
import type { SessionManager } from '../connection/session-manager';
import { ExecutionSlots } from './slots';
export type ChannelTicket={ready:Promise<ClientChannel>;closed:Promise<void>;readonly requestSent:boolean;readonly cleanupPending:boolean;readonly transportLost:boolean;readonly channelCloseObserved:boolean;close():void};
type Entry={transportLost:boolean;channelCloseObserved:boolean;detachSocket:()=>void;id:string;serverId:string;generation:number;lease:AuxiliaryLease;channel:ClientChannel|null;sent:boolean;closing:boolean;failed:boolean;cleanupPending:boolean;settled:boolean;finished:boolean;timer:ReturnType<typeof setTimeout>|null;resolve:(channel:ClientChannel)=>void;reject:(error:Error)=>void;resolveClosed:()=>void};
/** A failed/late channel request retains its reservation until a proven close. */
export class ExecutionChannels {
  private readonly slots=new ExecutionSlots();private readonly entries=new Map<string,Entry>();
  constructor(private readonly sessions:Pick<SessionManager,'auxiliary'>,private readonly changed:(id:string,cleanupPending:boolean)=>void=()=>{}) {}
  open(id:string,serverId:string,generation:number,request:{kind:'gui_exec';command:string}|{kind:'pty'},beforeRequest:()=>Promise<void>,onAccepted:(channel:ClientChannel)=>void=()=>{}):ChannelTicket {
    this.slots.reserve(id,serverId,generation);let lease:AuxiliaryLease;
    try {lease=this.sessions.auxiliary(serverId,generation,'execution');}catch(error){this.slots.closed(id);throw error;}
    let resolve!:(channel:ClientChannel)=>void,reject!:(error:Error)=>void,resolveClosed!:()=>void;
    const ready=new Promise<ClientChannel>((yes,no)=>{resolve=yes;reject=no;}),closed=new Promise<void>(done=>{resolveClosed=done;});void ready.catch(()=>{});
    const entry:Entry={transportLost:false,channelCloseObserved:false,detachSocket:()=>{},id,serverId,generation,lease,channel:null,sent:false,closing:false,failed:false,cleanupPending:false,settled:false,finished:false,timer:null,resolve,reject,resolveClosed};this.entries.set(id,entry);
    void lease.closed.then(()=>{if(!entry.channelCloseObserved)entry.transportLost=true;this.fail(entry,'CONNECTION_LOST');this.finish(entry);});
    void (async()=>{
      const client=await lease.ready;if(entry.finished)return;const lost=()=>{if(!entry.channelCloseObserved)entry.transportLost=true;};client.once?.('close',lost);entry.detachSocket=()=>client.removeListener?.('close',lost);if(entry.closing){this.fail(entry,'EXEC_CANCELLED_NOT_SENT');this.finish(entry);return;}
      await beforeRequest();if(entry.finished)return;if(entry.closing){this.fail(entry,'EXEC_CANCELLED_NOT_SENT');this.finish(entry);return;}
      if(this.sessions.auxiliary(serverId,generation,'execution') !== lease || lease.closing)throw new Error('CONNECTION_LOST');
      entry.sent=true;entry.timer=setTimeout(()=>{this.fail(entry,'EXEC_RESULT_UNKNOWN');entry.failed=true;this.pendingCleanup(entry);this.maybeCloseIdle(lease);},10000);
      const callback=(error:Error|undefined,channel:ClientChannel)=>{
        if(entry.timer)clearTimeout(entry.timer);entry.timer=null;
        if(error || !channel){this.fail(entry,request.kind === 'gui_exec' ? 'EXEC_REJECTED':'PTY_UNAVAILABLE');entry.failed=true;this.pendingCleanup(entry);this.maybeCloseIdle(lease);return;}
        entry.channel=channel;channel.once('close',()=>{if(!entry.transportLost)entry.channelCloseObserved=true;this.finish(entry);});channel.on('error',()=>{});
        if(entry.finished || entry.settled || entry.closing){closeDiscardedChannel(channel);return;}
        try{onAccepted(channel);}catch{this.fail(entry,'INTERNAL_ERROR');entry.closing=true;closeDiscardedChannel(channel);return;}entry.settled=true;entry.resolve(channel);
      };
      try {if(request.kind === 'gui_exec')client.exec(request.command,callback);else client.shell({term:'xterm-256color',cols:80,rows:24,width:0,height:0},callback);}
      catch {this.fail(entry,'EXEC_RESULT_UNKNOWN');entry.failed=true;this.pendingCleanup(entry);this.maybeCloseIdle(lease);}
    })().catch(error=>{this.fail(entry,error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message) ? error.message:'CONNECTION_LOST');if(!entry.sent)this.finish(entry);else {entry.failed=true;this.pendingCleanup(entry);this.maybeCloseIdle(lease);}});
    return {ready,closed,get requestSent(){return entry.sent;},get cleanupPending(){return entry.cleanupPending;},get transportLost(){return entry.transportLost;},get channelCloseObserved(){return entry.channelCloseObserved;},close:()=>{if(entry.finished || entry.closing)return;entry.closing=true;if(entry.channel){closeDiscardedChannel(entry.channel);this.pendingCleanup(entry);}else if(entry.sent){this.pendingCleanup(entry);entry.failed=true;this.maybeCloseIdle(lease);} }};
  }
  private pendingCleanup(entry:Entry):void {entry.cleanupPending=true;try{this.changed(entry.id,true);}catch{}}
  private fail(entry:Entry,code:string):void {if(entry.settled)return;entry.settled=true;if(entry.timer)clearTimeout(entry.timer);entry.timer=null;entry.reject(new Error(code));}
  private finish(entry:Entry):void {if(entry.finished)return;entry.finished=true;entry.detachSocket();if(entry.timer)clearTimeout(entry.timer);entry.timer=null;this.entries.delete(entry.id);this.slots.closed(entry.id);entry.cleanupPending=false;entry.resolveClosed();try{this.changed(entry.id,false);}catch{}this.maybeCloseIdle(entry.lease);}
  private maybeCloseIdle(lease:AuxiliaryLease):void {
    const entries=[...this.entries.values()].filter(row=>row.lease === lease);if(entries.every(row=>row.failed && !row.channel))lease.close();
  }
  count(serverId?:string):number {return this.slots.count(serverId);}
}
