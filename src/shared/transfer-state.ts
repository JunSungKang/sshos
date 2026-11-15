import { transferTerminal,type TransferPhase } from './transfers';

const allowed:Record<TransferPhase,readonly TransferPhase[]>={
  queued:['preparing','cancelled','interrupted','skipped'],
  preparing:['transferring','cancel_requested','failed','interrupted','result_unknown'],
  transferring:['verifying','cancel_requested','failed','interrupted','result_unknown'],
  verifying:['finalize_intent_pending','cancel_requested','failed','interrupted','result_unknown'],
  finalize_intent_pending:['finalizing','failed','interrupted'],
  finalizing:['completed','failed','result_unknown'],
  cancel_requested:['cancelled','result_unknown'],
  completed:[],failed:[],interrupted:[],cancelled:[],result_unknown:[],skipped:[]
};
export class TransferState {
  private value:TransferPhase='queued';
  get phase():TransferPhase {return this.value;}
  move(next:TransferPhase):void {
    if (!allowed[this.value].includes(next)) throw new Error('INPUT_INVALID');this.value=next;
  }
  cancel():TransferPhase {
    if (['finalize_intent_pending','finalizing'].includes(this.value)) throw new Error('CANCEL_TOO_LATE');
    if (transferTerminal(this.value) || this.value === 'cancel_requested') return this.value;
    this.move(this.value === 'queued' ? 'cancelled' : 'cancel_requested');return this.value;
  }
}
