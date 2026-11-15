import { randomUUID } from 'node:crypto';
import { fileReceiptSchema,type FileReceipt } from '../shared/receipts';
import { receiptACKSchema,receiptSaveSchema,type ReceiptACK } from '../shared/receipt-channel';
export class WorkerReceiptWriter {
  private readonly pending=new Map<string,{identity:Omit<ReceiptACK,'action'|'ok'>;resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private sequence=0;
  private fault=false;
  private paused=false;
  constructor(readonly epoch:string,private readonly post:(message:unknown)=>void,private readonly onFault:()=>void=()=>{}) {}
  get faulted():boolean {return this.fault || this.paused;}
  private fail():void {
    if (!this.fault) {
      this.fault=true;for (const value of this.pending.values()) {clearTimeout(value.timer);value.reject(new Error('STORAGE_FAILED'));}this.pending.clear();
      try {this.post({type:'receipt:fault',backendEpoch:this.epoch,errorCode:'STORAGE_FAILED'});} catch { /* Parent exit is handled by the app lifecycle. */ }
      try {this.onFault();} catch { /* The writer remains locked even if UI observation fails. */ }
    }
  }
  persist(input:FileReceipt):Promise<void> {
    if (this.faulted || this.pending.size>=16) return Promise.reject(new Error(this.faulted ? 'STORAGE_FAILED' : 'REQUEST_BUSY'));
    let receipt:FileReceipt;
    try {receipt=fileReceiptSchema.parse(input);if (receipt.backendEpoch !== this.epoch || Buffer.byteLength(JSON.stringify(receipt))>65536 || !Number.isSafeInteger(this.sequence+1)) throw new Error('INPUT_INVALID');}
    catch {this.fail();return Promise.reject(new Error('STORAGE_FAILED'));}
    const identity={requestId:randomUUID(),backendEpoch:this.epoch,serverId:receipt.serverId,generation:receipt.generation,sequence:++this.sequence};
    const message=receiptSaveSchema.parse({type:'receipt:save',...identity,receipt});
    return new Promise<void>((resolve,reject) => {
      const timer=setTimeout(() => {this.pending.delete(identity.requestId);this.fail();reject(new Error('STORAGE_FAILED'));},5000);
      this.pending.set(identity.requestId,{identity,resolve,reject,timer});
      try {this.post(message);} catch {this.pending.delete(identity.requestId);clearTimeout(timer);this.fail();reject(new Error('STORAGE_FAILED'));}
    });
  }
  accept(raw:unknown):boolean {
    const parsed=receiptACKSchema.safeParse(raw);if (!parsed.success) return false;const ack=parsed.data;
    if (ack.backendEpoch !== this.epoch) return true;const pending=this.pending.get(ack.requestId);if (!pending) return true;
    if (ack.serverId !== pending.identity.serverId || ack.generation !== pending.identity.generation || ack.sequence !== pending.identity.sequence) return true;
    this.pending.delete(ack.requestId);clearTimeout(pending.timer);
    if (ack.ok) pending.resolve();else {this.fail();pending.reject(new Error('STORAGE_FAILED'));}return true;
  }
  pauseAfterQuiescence():void {if(this.pending.size)throw new Error('REQUEST_BUSY');this.paused=true;}
  resetAfterStorageVerification():void {if (this.pending.size) throw new Error('REQUEST_BUSY');this.fault=false;this.paused=false;}
  stop():void {this.fail();for (const value of this.pending.values()) {clearTimeout(value.timer);value.reject(new Error('STORAGE_FAILED'));}this.pending.clear();}
}
