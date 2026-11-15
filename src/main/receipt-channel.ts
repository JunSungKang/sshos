import { createHash } from 'node:crypto';
import { receiptSaveSchema,receiptFaultSchema,type ReceiptSave,type ReceiptACK } from '../shared/receipt-channel';
import type { ReceiptRepository } from './persistence/receipts';
type Result={hash:string;ack:ReceiptACK};
export class MainReceiptChannel {
  private readonly inFlight=new Map<string,{hash:string;promise:Promise<Result>}>();
  private readonly completed=new Map<string,Result>();
  private lastSequence=0;
  constructor(readonly epoch:string,private readonly repository:()=>ReceiptRepository|null,private readonly stateHealthy:()=>boolean,private readonly post:(message:unknown)=>void) {}
  private send(ack:ReceiptACK):void {try {this.post(ack);} catch { /* No acknowledgement means no remote dispatch permission. */ }}
  private identity(request:ReceiptSave):Omit<ReceiptACK,'ok'> {return {action:'receipt:ack',requestId:request.requestId,backendEpoch:request.backendEpoch,serverId:request.serverId,generation:request.generation,sequence:request.sequence};}
  private async save(request:ReceiptSave,hash:string):Promise<Result> {
    const repo=this.repository();let ok=false;
    try {
      if (!repo || repo.faulted || !this.stateHealthy() || Buffer.byteLength(JSON.stringify(request.receipt))>65536) throw new Error('STORAGE_FAILED');
      // Main must have durably accepted this exact resource before worker writes.
      const existing=repo.get(request.receipt.taskId);
      if (!existing || existing.backendEpoch !== this.epoch || existing.serverId !== request.serverId || existing.generation !== request.generation || request.receipt.backendEpoch !== this.epoch || request.receipt.serverId !== request.serverId || request.receipt.generation !== request.generation) throw new Error('INPUT_INVALID');
      await repo.save(request.receipt);if (repo.faulted || !this.stateHealthy()) throw new Error('STORAGE_FAILED');ok=true;
    } catch {repo?.markFault();}
    return {hash,ack:{...this.identity(request),ok}};
  }
  accept(raw:unknown):boolean {
    if (!raw || typeof raw !== 'object' || !('type' in raw) || !['receipt:save','receipt:fault'].includes(String(raw.type))) return false;
    if (!('backendEpoch' in raw) || raw.backendEpoch !== this.epoch) return true;
    if (raw.type === 'receipt:fault') {if (receiptFaultSchema.safeParse(raw).success) this.repository()?.markFault();return true;}
    const parsed=receiptSaveSchema.safeParse(raw);if (!parsed.success) {this.repository()?.markFault();return true;}
    const request=parsed.data,hash=createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const completed=this.completed.get(request.requestId),pending=this.inFlight.get(request.requestId);
    const old=completed ?? pending;
    if (old && old.hash !== hash) {this.repository()?.markFault();this.send({...this.identity(request),ok:false});return true;}
    if (completed) {this.send(completed.ack);return true;}
    if (pending) {void pending.promise.then(result => this.send(result.ack));return true;}
    if (request.sequence<=this.lastSequence || this.inFlight.size>=16) {this.send({...this.identity(request),ok:false});return true;}
    this.lastSequence=request.sequence;
    const promise=this.save(request,hash);this.inFlight.set(request.requestId,{hash,promise});
    void promise.then(result => {this.inFlight.delete(request.requestId);this.completed.set(request.requestId,result);while (this.completed.size>200) this.completed.delete(this.completed.keys().next().value!);this.send(result.ack);});return true;
  }
  async settled():Promise<void> {await Promise.all([...this.inFlight.values()].map(row => row.promise));}
}
