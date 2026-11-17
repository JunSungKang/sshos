import { z } from "zod";
import { executionReceiptSchema, executionTerminal } from "./executions";
import { mutationReceiptSchema } from "./mutations";
import { transferReceiptSchema, transferTerminal } from "./transfers";
export const fileReceiptSchema = z.discriminatedUnion("kind", [
  mutationReceiptSchema,
  transferReceiptSchema,
  executionReceiptSchema,
]);
export type OperationReceipt = z.infer<typeof fileReceiptSchema>;
// Legacy API name retained while callers migrate to the four-kind record union.
export type FileReceipt = OperationReceipt;
export function receiptUnresolved(row: FileReceipt): boolean {
  return (
    row.acknowledgedAt === null &&
    (row.phase === "result_unknown" ||
      (row.kind === "file_mutation" && row.phase === "partial") ||
      (row.kind === "file_transfer" &&
        ["needed", "unknown"].includes(row.cleanupState) &&
        transferTerminal(row.phase)))
  );
}
export function receiptTerminal(row: FileReceipt): boolean {
  return row.kind === "file_transfer"
    ? transferTerminal(row.phase)
    : row.kind === "file_mutation"
      ? ["completed", "failed", "partial", "result_unknown"].includes(row.phase)
      : executionTerminal(row.phase);
}
