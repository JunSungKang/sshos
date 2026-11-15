import { errorCodeOf } from '../../shared/errors';
import { posix } from 'node:path';
import type { Client, Stats } from 'ssh2';
import { remotePathSchema } from '../../shared/files';
import { type ViewerReadKind, type ViewerFrame, type ViewerMetadata } from '../../shared/viewers/reader';
import { IMAGE_LIMIT } from '../../shared/viewers/image-header';
import { TEXT_LIMIT } from '../../shared/viewers/text';
import { controlCall, verifyDirectory, type ControlAccess } from '../files/browser';
import { openReadChannel, type ReadChannel } from './sftp-channel';
import { ViewerReadPool } from './read-pool';

type ReadSpec={viewerId:string;readGeneration:number;serverId:string;generation:number;path:string;parent:string;kind:ViewerReadKind};
type RecordEntry=ReadSpec & {
  state:'queued'|'opening'|'reading'|'completed'|'failed'|'cancelled';errorCode:string|null;metadata:ViewerMetadata|null;
  channel:ReadChannel|null;control:ControlAccess|null;handle:Buffer|null;lease:{release():void}|null;
  timer:ReturnType<typeof setTimeout>|null;abortListeners:Set<(error:Error)=>void>;
  busy:boolean;lastSequence:number;lastFrame:ViewerFrame|null;offset:number;
};
const fixedError=errorCodeOf;
export class ViewerReader {
  private readonly entries=new Map<string,RecordEntry>();
  private readonly pool=new ViewerReadPool();
  constructor(private readonly connectedClient:(serverId:string,generation:number)=>Client,private readonly channelFactory:(client:Client)=>ReadChannel=openReadChannel) {}
  open(spec:ReadSpec):void {
    remotePathSchema.parse(spec.path);remotePathSchema.parse(spec.parent);if (posix.dirname(spec.path) !== spec.parent) throw new Error('PATH_UNSUPPORTED');
    const previous=this.entries.get(spec.viewerId);
    if (previous && (previous.serverId !== spec.serverId || previous.generation !== spec.generation || previous.readGeneration>=spec.readGeneration)) throw new Error('TOKEN_EXPIRED');
    if (!previous && this.entries.size>=10) throw new Error('VIEW_LIMIT');if (previous) this.cancel(spec.viewerId,previous.readGeneration);
    const entry:RecordEntry={...spec,state:'queued',errorCode:null,metadata:null,channel:null,control:null,handle:null,lease:null,timer:null,abortListeners:new Set(),busy:false,lastSequence:-1,lastFrame:null,offset:0};
    this.entries.set(spec.viewerId,entry);void this.prepare(entry).catch(error => this.fail(entry,fixedError(error)));
  }
  private identity(entry:RecordEntry,sequence:number) {return {viewerId:entry.viewerId,readGeneration:entry.readGeneration,sequence};}
  private check(entry:RecordEntry):void {
    if (this.entries.get(entry.viewerId) !== entry || ['failed','cancelled','completed'].includes(entry.state)) throw new Error(entry.errorCode ?? 'REQUEST_CANCELLED');
    this.connectedClient(entry.serverId,entry.generation);
  }
  private observed<T>(entry:RecordEntry,operation:Promise<T>):Promise<T> {
    return new Promise<T>((resolve,reject) => {
      const cancelled=(error:Error) => {entry.abortListeners.delete(cancelled);reject(error);};entry.abortListeners.add(cancelled);
      void operation.then(value => {entry.abortListeners.delete(cancelled);try {this.check(entry);resolve(value);} catch (error) {reject(error);}},error => {entry.abortListeners.delete(cancelled);reject(error);});
      try {this.check(entry);} catch (error) {cancelled(error instanceof Error ? error : new Error('REQUEST_CANCELLED'));}
    });
  }
  private abort(entry:RecordEntry,code:string):void {for (const listener of entry.abortListeners) listener(new Error(code));entry.abortListeners.clear();}
  private clearDeadline(entry:RecordEntry):void {if (entry.timer) {clearTimeout(entry.timer);entry.timer=null;}}
  private fail(entry:RecordEntry,code:string):void {
    if (['failed','cancelled','completed'].includes(entry.state)) return;
    entry.state='failed';entry.errorCode=code;entry.lastFrame=null;this.clearDeadline(entry);this.abort(entry,code);this.pool.cancel(this.key(entry));entry.channel?.cancel();
  }
  private key(entry:RecordEntry):string {return `${entry.viewerId}:${entry.readGeneration}`;}
  private async prepare(entry:RecordEntry):Promise<void> {
    const lease=await this.pool.acquire(this.key(entry),entry.serverId);entry.lease=lease;
    try {this.check(entry);} catch (error) {lease.release();throw error;}
    entry.state='opening';entry.timer=setTimeout(() => this.fail(entry,'IO_TIMEOUT'),30000);
    try {
      entry.channel=this.channelFactory(this.connectedClient(entry.serverId,entry.generation));
      void entry.channel.closed.then(() => {lease.release();entry.lease=null;});
      const sftp=await this.observed(entry,entry.channel.ready);
      const control:ControlAccess={sftp,check:() => this.check(entry),quarantine:() => this.fail(entry,'IO_TIMEOUT')};entry.control=control;
      await this.observed(entry,verifyDirectory(control,entry.parent));
      const before=await this.observed(entry,controlCall<Stats>(control,done => sftp.lstat(entry.path,done)));
      if (!before.isFile() || before.isSymbolicLink()) throw new Error('PATH_UNSUPPORTED');
      const handle=await this.observed(entry,controlCall<Buffer>(control,done => sftp.open(entry.path,'r',done)));entry.handle=handle;
      const stat=await this.observed(entry,controlCall<Stats>(control,done => sftp.fstat(handle,done)));
      if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size<0 || !Number.isSafeInteger(stat.mtime) || stat.mtime<0) throw new Error('PATH_UNSUPPORTED');
      const limit=entry.kind === 'text' ? TEXT_LIMIT : IMAGE_LIMIT;
      if (entry.kind !== 'probe' && stat.size>limit) throw new Error('VIEW_LIMIT');
      entry.metadata={path:entry.path,size:stat.size,mtime:stat.mtime,readAt:null};entry.state='reading';
    } catch (error) {if (!entry.channel) {lease.release();entry.lease=null;}throw error;}
  }
  private entry(serverId:string,generation:number,viewerId:string,readGeneration:number):RecordEntry {
    const entry=this.entries.get(viewerId);
    if (!entry || entry.serverId !== serverId || entry.generation !== generation || entry.readGeneration !== readGeneration) throw new Error('TOKEN_EXPIRED');return entry;
  }
  async next(serverId:string,generation:number,viewerId:string,readGeneration:number,sequence:number):Promise<ViewerFrame> {
    const entry=this.entry(serverId,generation,viewerId,readGeneration);if (entry.errorCode) throw new Error(entry.errorCode);
    if (entry.state === 'queued' || entry.state === 'opening') return {...this.identity(entry,sequence),status:'waiting',phase:entry.state === 'queued' ? 'queued' : 'reading'};
    if (entry.lastSequence === sequence && entry.lastFrame) return entry.lastFrame;
    if (entry.busy) throw new Error('REQUEST_BUSY');if (sequence !== entry.lastSequence+1) throw new Error('INPUT_INVALID');
    // Requesting the next sequence is the renderer's consumption ACK for the
    // previous chunk. Keep at most one64KiB chunk for idempotent replay.
    entry.lastFrame=null;
    if (entry.state === 'completed') {const frame:ViewerFrame={...this.identity(entry,sequence),status:'end',metadata:entry.metadata!};entry.lastSequence=sequence;entry.lastFrame=frame;return frame;}
    this.check(entry);entry.busy=true;
    try {
      const frame=await this.produce(entry,sequence);entry.lastSequence=sequence;entry.lastFrame=frame;return frame;
    } catch (error) {this.fail(entry,fixedError(error));throw new Error(entry.errorCode ?? fixedError(error));}
    finally {entry.busy=false;}
  }
  private async produce(entry:RecordEntry,sequence:number):Promise<ViewerFrame> {
    const control=entry.control!,sftp=control.sftp,metadata=entry.metadata!,handle=entry.handle!;
    const limit=entry.kind === 'probe' ? 4096 : entry.kind === 'text' ? TEXT_LIMIT : IMAGE_LIMIT;
    const bytes=Buffer.alloc(65536);const sourceOffset=entry.offset;
    const wanted=Math.min(bytes.length,limit-sourceOffset+(entry.kind === 'probe' ? 0 : 1));
    const firstLength=Math.min(32768,wanted),secondLength=wanted-firstLength;
    const range=async (bufferOffset:number,length:number):Promise<number> => {
      let read=0;
      while (read<length) {
        this.check(entry);const remaining=length-read;
        const count=await this.observed(entry,controlCall<number>(control,done => sftp.read(handle,bytes,bufferOffset+read,remaining,sourceOffset+bufferOffset+read,(error,count) => done(error,count))));
        if (!Number.isSafeInteger(count) || count<0 || count>remaining) throw new Error('INTERNAL_ERROR');if (count === 0) break;read+=count;
      }
      return read;
    };
    // Two disjoint32KiB ranges fit one replay chunk. Pipeline within that chunk
    // while waiting for the renderer ACK before reading another chunk.
    const [first,second]=await this.observed(entry,Promise.all([range(0,firstLength),range(firstLength,secondLength)]));
    if (first<firstLength && second>0) throw new Error('SOURCE_CHANGED');
    const filled=first+second;entry.offset+=filled;if (entry.offset>limit) throw new Error('VIEW_LIMIT');
    const eof=first<firstLength || second<secondLength || entry.kind === 'probe' && entry.offset === limit;
    if (eof) {
      const final=await this.observed(entry,controlCall<Stats>(control,done => sftp.fstat(handle,done)));
      if (!final.isFile() || final.size !== metadata.size || final.mtime !== metadata.mtime || entry.offset !== Math.min(metadata.size,entry.kind === 'probe' ? 4096 : metadata.size)) throw new Error('SOURCE_CHANGED');
      await this.observed(entry,controlCall<void>(control,done => sftp.close(handle,error => done(error,undefined))));entry.handle=null;
      entry.metadata={...metadata,readAt:new Date().toISOString()};entry.state='completed';this.clearDeadline(entry);entry.channel?.cancel();
    }
    const identity=this.identity(entry,sequence);
    return filled ? {...identity,status:'chunk',metadata:entry.metadata!,bytes:new Uint8Array(bytes.buffer,bytes.byteOffset,filled)} : {...identity,status:'end',metadata:entry.metadata!};
  }
  cancel(viewerId:string,readGeneration:number):void {
    const entry=this.entries.get(viewerId);if (!entry || entry.readGeneration !== readGeneration) return;
    entry.state='cancelled';entry.errorCode='REQUEST_CANCELLED';entry.lastFrame=null;this.clearDeadline(entry);this.abort(entry,'REQUEST_CANCELLED');this.pool.cancel(this.key(entry));entry.channel?.cancel();this.entries.delete(viewerId);
  }
  close(serverId:string,generation:number,viewerId:string,readGeneration:number):void {
    const entry=this.entries.get(viewerId);if (!entry) return;if (entry.serverId !== serverId || entry.generation !== generation) throw new Error('TOKEN_EXPIRED');this.cancel(viewerId,readGeneration);
  }
  sessionChanged(serverId:string,generation:number,connected:boolean):void {
    for (const entry of this.entries.values()) if (entry.serverId === serverId && (entry.generation !== generation || !connected)) this.fail(entry,'CONNECTION_LOST');
  }
}
