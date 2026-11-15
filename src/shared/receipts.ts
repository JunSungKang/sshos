import { z } from 'zod';
import { mutationReceiptSchema } from './mutations';
import { transferReceiptSchema,transferTerminal } from './transfers';
export const fileReceiptSchema=z.discriminatedUnion('kind',[mutationReceiptSchema,transferReceiptSchema]);
export type FileReceipt=z.infer<typeof fileReceiptSchema>;
export function receiptUnresolved(row:FileReceipt):boolean {
  return row.acknowledgedAt === null && (row.phase === 'result_unknown' || row.kind === 'file_mutation' && row.phase === 'partial' || row.kind === 'file_transfer' && ['needed','unknown'].includes(row.cleanupState) && transferTerminal(row.phase));
}
export function receiptTerminal(row:FileReceipt):boolean {return row.kind === 'file_transfer' ? transferTerminal(row.phase) : ['completed','failed','partial','result_unknown'].includes(row.phase);}
