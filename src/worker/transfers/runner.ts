import { performance } from 'node:perf_hooks';
import { TransferState } from '../../shared/transfer-state';
import { transferReceiptSchema,transferStatSchema,transferTerminal,type TransferReceipt,type TransferStat,type TransferPhase } from '../../shared/transfers';
import { copyAndHash,hashReadBack,type ReadPort,type WritePort,type IOObserver } from './io';
import { TransferRate } from './progress';

export class TransferIOFailure extends Error {
  constructor(code:string,readonly uncertain=false,readonly statusCode:number|string|null=null) {super(code);}
}
export interface TransferSource extends ReadPort {stat():Promise<TransferStat>;close():Promise<void>}
export interface TransferPorts {
  prepare():Promise<TransferSource>;
  createTemp():Promise<WritePort>;
  finishWrite():Promise<void>;
  tempStat():Promise<TransferStat>;
  openVerification():Promise<TransferSource>;
  linkDestination():Promise<void>;
  confirmDestination():Promise<void>;
  removeTemp():Promise<void>;
  /** Resolves only after its socket and local handles are closed. */
  shutdown():Promise<void>;
}
export type TransferLive=TransferReceipt & {recordError:boolean;bytesPerSecond:number|null};
export type TransferHooks={persist(row:TransferReceipt):Promise<void>;update(row:TransferLive):void;now?:()=>number};
const codeOf=(error:unknown) => error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message) ? error.message : 'IO_FAILED';
const sameStat=(a:TransferStat,b:TransferStat) => a.size === b.size && a.mtime === b.mtime && a.identity === b.identity;

/** One accepted task. No retry, overwrite, destination rollback or resume path. */
export class TransferRunner {
  private row:TransferReceipt;
  private readonly state=new TransferState();
  private readonly abort=new AbortController();
  private readonly now:()=>number;
  private readonly rate:TransferRate;
  private ports:TransferPorts|null=null;
  private deadline:ReturnType<typeof setTimeout>|null=null;
  private progressTimer:ReturnType<typeof setInterval>|null=null;
  private lastPublished=-Infinity;
  private started=false;
  private recordError=false;
  private tempRequestPending=false;
  private linkRequestPending=false;
  private linkAcknowledged=false;
  private destinationConfirmed=false;
  private persistTail:Promise<void>=Promise.resolve();
  constructor(initial:TransferReceipt,private readonly createPorts:(row:TransferReceipt,signal:AbortSignal,late:(stage:'temp_create_ack'|'final_link_ack'|'temp_remove_ack')=>void)=>TransferPorts,private readonly hooks:TransferHooks) {
    this.row=transferReceiptSchema.parse(initial);if (this.row.phase !== 'queued') throw new Error('INPUT_INVALID');this.now=hooks.now ?? (() => performance.now());this.rate=new TransferRate(this.now());
  }
  snapshot():TransferLive {return {...structuredClone(this.row),phase:this.state.phase,recordError:this.recordError,bytesPerSecond:transferTerminal(this.state.phase) ? null : this.rate.value(this.now())};}
  private publish(force=false):void {const now=this.now();if (force || now-this.lastPublished>=250) {this.lastPublished=now;try {this.hooks.update(this.snapshot());} catch { /* UI loss cannot alter a remote operation. */ }}}
  private move(phase:TransferPhase,publish=true):void {this.state.move(phase);if (publish) this.publish(transferTerminal(phase));}
  cancel():TransferPhase {
    const phase=this.state.cancel();if (phase === 'cancel_requested') this.abort.abort(new Error('REQUEST_CANCELLED'));this.publish(transferTerminal(phase));return phase;
  }
  interrupt(code='CONNECTION_LOST'):void {if (!transferTerminal(this.state.phase)) this.abort.abort(new Error(code));}
  private check():void {if (this.abort.signal.aborted) throw this.abort.signal.reason;if (transferTerminal(this.state.phase)) throw new Error('REQUEST_CANCELLED');}
  private activity():void {if (this.deadline) clearTimeout(this.deadline);this.deadline=setTimeout(() => this.interrupt('IO_TIMEOUT'),30000);}
  private async persist(changes:Partial<TransferReceipt>={}):Promise<void> {
    const work=this.persistTail.then(async () => {
      if (this.recordError) throw new Error('STORAGE_FAILED');
      const phase=this.state.phase === 'finalize_intent_pending' ? 'finalizing' : this.state.phase;
      this.row=transferReceiptSchema.parse({...this.row,phase,...changes,updatedAt:new Date().toISOString()});
      if (this.row.phase === 'finalize_intent_pending') throw new Error('INPUT_INVALID');
      try {await this.hooks.persist(structuredClone(this.row));} catch {this.recordError=true;this.publish(true);throw new Error('STORAGE_FAILED');}
    });
    this.persistTail=work.catch(() => {});return work;
  }
  private late(stage:'temp_create_ack'|'final_link_ack'|'temp_remove_ack'):void {
    // A late callback is an observation, never a state transition to completed.
    if (this.row.lateObservations.some(row => row.stage === stage) || this.row.lateObservations.length>=16) return;
    this.row.lateObservations.push({stage,observedAt:new Date().toISOString()});
    void this.persist().then(() => this.publish(true)).catch(() => {this.recordError=true;this.publish(true);});
  }
  private progress(kind:'transferred'|'verified',bytes:number):void {
    this.check();const key=kind === 'transferred' ? 'transferredBytes' : 'verifiedBytes';const next=this.row[key]+bytes;
    if (!Number.isSafeInteger(next) || next>this.row.totalBytes) throw new Error('IO_FAILED');this.row[key]=next;this.rate.add(bytes,this.now());this.publish();
  }
  private async closePorts():Promise<boolean> {try {await this.ports?.shutdown();return true;} catch {return false;}}
  async run():Promise<{snapshot:TransferLive;resourcesClosed:boolean}> {
    if (this.started) throw new Error('INPUT_INVALID');this.started=true;
    if (this.state.phase === 'cancelled') {await this.persist({stage:'cancelled'});this.publish(true);return {snapshot:this.snapshot(),resourcesClosed:true};}
    let failure:unknown;let resourcesClosed=false;
    try {
      this.move('preparing');this.activity();this.progressTimer=setInterval(() => this.publish(),250);await this.persist({stage:'preparing'});this.check();
      this.ports=this.createPorts(structuredClone(this.row),this.abort.signal,stage => this.late(stage));
      const source=await this.ports.prepare();this.check();const initial=transferStatSchema.parse(await source.stat());this.check();if (!sameStat(initial,this.row.sourceInitialStat)) throw new Error('SOURCE_CHANGED');
      await this.persist({stage:'temp_create_intent'});this.check();this.tempRequestPending=true;
      const destination=await this.ports.createTemp();this.tempRequestPending=false;this.row.tempCreated=true;
      await this.persist({stage:'temp_created',lastConfirmedPhase:'temp_created',cleanupState:'needed'});this.check();
      this.move('transferring');this.rate.reset(this.now());await this.persist({stage:'transferring'});this.check();
      const observer:IOObserver={check:() => this.check(),activity:() => this.activity(),progress:(kind,bytes) => this.progress(kind,bytes)};
      const digest=await copyAndHash(this.row.direction,source,destination,this.row.totalBytes,observer);this.check();
      const final=transferStatSchema.parse(await source.stat());this.check();if (!sameStat(initial,final)) throw new Error('SOURCE_CHANGED');await source.close();this.check();
      await this.ports.finishWrite();this.check();const temp=transferStatSchema.parse(await this.ports.tempStat());this.check();if (temp.size !== this.row.totalBytes) throw new Error('VERIFY_MISMATCH');
      this.move('verifying');this.rate.reset(this.now());await this.persist({stage:'verifying',streamSha256:digest,lastConfirmedPhase:'bytes_and_handles_closed'});this.check();
      const verification=await this.ports.openVerification();this.check();const before=transferStatSchema.parse(await verification.stat());this.check();if (before.size !== this.row.totalBytes) throw new Error('VERIFY_MISMATCH');
      let verified:string;
      try {verified=await hashReadBack(verification,this.row.totalBytes,observer);} catch (error) {if (codeOf(error) === 'SOURCE_CHANGED') throw new TransferIOFailure('VERIFY_MISMATCH');throw error;}
      this.check();const after=transferStatSchema.parse(await verification.stat());this.check();await verification.close();this.check();
      if (!sameStat(before,after) || verified !== digest) throw new Error('VERIFY_MISMATCH');
      // Synchronous reducer decision wins the race before any await of storage.
      this.move('finalize_intent_pending');await this.persist({stage:'final_link_intent',dispatchAllowed:true,lastConfirmedPhase:'content_verified'});this.check();
      this.move('finalizing');this.linkRequestPending=true;await this.ports.linkDestination();this.linkRequestPending=false;this.linkAcknowledged=true;this.check();
      await this.ports.confirmDestination();this.check();this.destinationConfirmed=true;this.row.destinationCreated=true;
      await this.persist({stage:'destination_confirmed',lastConfirmedPhase:'destination_confirmed'});
      let cleanup:TransferReceipt['cleanupState']='confirmed';
      try {this.check();await this.ports.removeTemp();} catch (error) {cleanup=error instanceof TransferIOFailure && !error.uncertain ? 'needed' : 'unknown';}
      await this.persist({phase:'completed',stage:'completed',cleanupState:cleanup,lastConfirmedPhase:cleanup === 'confirmed' ? 'temp_removed' : 'destination_confirmed'});
      this.move('completed');
    } catch (error) {failure=error;}
    finally {if (this.deadline) {clearTimeout(this.deadline);this.deadline=null;}resourcesClosed=await this.closePorts();await this.persistTail;if (this.progressTimer) {clearInterval(this.progressTimer);this.progressTimer=null;}}
    if (failure) {
      const errorCode=codeOf(failure);const uncertain=failure instanceof TransferIOFailure ? failure.uncertain : this.tempRequestPending || this.linkRequestPending;
      let phase:TransferPhase;
      if (this.state.phase === 'cancel_requested') phase=uncertain || !resourcesClosed ? 'result_unknown' : 'cancelled';
      else if (this.state.phase === 'finalizing') phase=uncertain || this.linkAcknowledged || this.destinationConfirmed || errorCode === 'STORAGE_FAILED' ? 'result_unknown' : 'failed';
      else phase=uncertain ? 'result_unknown' : this.abort.signal.aborted || ['CONNECTION_LOST','IO_TIMEOUT','ENGINE_STOPPED'].includes(errorCode) ? 'interrupted' : 'failed';
      this.move(phase,false);this.row.errorCode=errorCode;if (this.row.cleanupState === 'none') this.row.cleanupState=this.row.tempCreated ? 'needed' : uncertain ? 'unknown' : 'none';
      if (!this.recordError) {try {await this.persist({stage:phase});} catch {this.row.errorCode='STORAGE_FAILED';}}
      this.publish(true);
    }
    return {snapshot:this.snapshot(),resourcesClosed};
  }
}
