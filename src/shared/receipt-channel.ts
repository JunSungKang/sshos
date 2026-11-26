import { z } from "zod";
import { fileReceiptSchema } from "./receipts";
const identity = {
  requestId: z.uuid(),
  backendEpoch: z.uuid(),
  serverId: z.uuid(),
  generation: z.int().positive(),
  sequence: z.int().positive(),
};
export const receiptSaveSchema = z
  .object({
    type: z.literal("receipt:save"),
    ...identity,
    receipt: fileReceiptSchema,
  })
  .strict();
export const receiptACKSchema = z
  .object({ action: z.literal("receipt:ack"), ...identity, ok: z.boolean() })
  .strict();
export const receiptFaultSchema = z
  .object({
    type: z.literal("receipt:fault"),
    backendEpoch: z.uuid(),
    errorCode: z.literal("STORAGE_FAILED"),
  })
  .strict();
export type ReceiptSave = z.infer<typeof receiptSaveSchema>;
export type ReceiptACK = z.infer<typeof receiptACKSchema>;

export const relayCheckSchema = z
  .object({
    type: z.literal("relay:checkDisk"),
    requestId: z.uuid(),
    backendEpoch: z.uuid(),
    serverId: z.uuid(),
    generation: z.int().positive(),
    taskId: z.uuid(),
    parentId: z.uuid(),
  })
  .strict();
export const relayCheckAckSchema = z
  .object({
    action: z.literal("relay:diskChecked"),
    requestId: z.uuid(),
    backendEpoch: z.uuid(),
    error: z
      .string()
      .regex(/^[A-Z_]{1,64}$/)
      .nullable(),
  })
  .strict();
