import { randomUUID } from 'node:crypto';
import { recoveryRequestSchema,type RecoveryResponse,type ExecutionRecoveryUncertainty } from '../shared/storage-recovery';
import type { WorkerReceiptWriter } from './receipt-writer';
import type { TransferCoordinator } from './transfers/coordinator';
type ExecutionParticipant={readonly hasActive:boolean;settled():Promise<void>;reconcileStorage(uncertain:ExecutionRecoveryUncertainty[]):Promise<void>};
/** Only the authenticated parent MessagePort can invoke this protocol. */
export class WorkerStorageRecovery {
  private token:string|null=null;private busy=false;
  constructor(private readonly epoch:string,private readonly writer:WorkerReceiptWriter,private readonly transfers:Pick<TransferCoordinator,'quiescent'|'storageFault'|'settled'>,private readonly post:(response:RecoveryResponse)=>void,private readonly executions:ExecutionParticipant[]=[]) {}
  accept(raw:unknown):boolean {
    const parsed=recoveryRequestSchema.safeParse(raw);if (!parsed.success) return false;const request=parsed.data;if (request.backendEpoch !== this.epoch) return true;
    const reply=(ok:boolean,errorCode:RecoveryResponse['errorCode'],barrierToken:string|null=null,release=true)=>{if (release) this.busy=false;this.post({type:'storage:response',requestId:request.requestId,backendEpoch:this.epoch,ok,errorCode,barrierToken});};
    if (this.busy) {reply(false,'REQUEST_BUSY',null,false);return true;}this.busy=true;
    void (async()=>{
      if (request.action === 'storage:reset') {if (!this.token || request.barrierToken !== this.token) {reply(false,'TOKEN_EXPIRED');return;}if (!this.transfers.quiescent()) {reply(false,'REQUEST_BUSY');return;}this.writer.resetAfterStorageVerification();try{await Promise.all(this.executions.map(participant=>participant.reconcileStorage(request.uncertainExecutions)));}catch(error){this.writer.stop();throw error;}this.token=null;reply(true,null);return;}
      if (!request.faulted && !this.writer.faulted && (!this.transfers.quiescent() || this.executions.some(participant=>participant.hasActive))) {reply(false,'REQUEST_BUSY');return;}
      if (request.faulted || this.writer.faulted) {this.writer.stop();this.transfers.storageFault();}
      const deadline=performance.now()+5000;
      while (!this.transfers.quiescent() && performance.now()<deadline) await new Promise(done=>setTimeout(done,20));
      if (!this.transfers.quiescent()) {reply(false,'REQUEST_BUSY');return;}
      await this.transfers.settled();await Promise.all(this.executions.map(participant=>participant.settled()));this.writer.pauseAfterQuiescence();this.token ??=randomUUID();reply(true,null,this.token);
    })().catch(()=>reply(false,'STORAGE_FAILED'));return true;
  }
}
