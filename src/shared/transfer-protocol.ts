import { z } from "zod";
import {
  transferReceiptSchema,
  transferPhaseSchema,
  MAX_TRANSFER_BYTES,
} from "./transfers";
export const localDirectorySchema = z
  .object({
    path: z
      .string()
      .min(1)
      .refine(
        (value) =>
          new TextEncoder().encode(value).length <= 32768 &&
          !value.includes("\0"),
      ),
    identity: z.string().min(1).max(128),
  })
  .strict();
export const stagedTransferSchema = z
  .object({
    row: transferReceiptSchema,
    localDirectory: localDirectorySchema,
    relay: z
      .object({
        parentId: z.uuid(),
        expectedSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type StagedTransfer = z.infer<typeof stagedTransferSchema>;
export const transferRuntimeSchema = z
  .object({
    taskId: z.uuid(),
    serverId: z.uuid(),
    generation: z.int().positive(),
    phase: transferPhaseSchema,
    totalBytes: z.int().min(0).max(MAX_TRANSFER_BYTES),
    transferredBytes: z.int().min(0).max(MAX_TRANSFER_BYTES),
    verifiedBytes: z.int().min(0).max(MAX_TRANSFER_BYTES),
    bytesPerSecond: z.number().finite().nonnegative().nullable(),
    cleanupState: z.enum(["none", "confirmed", "needed", "unknown"]),
    tempCreated: z.boolean(),
    destinationCreated: z.boolean(),
    lastConfirmedPhase: z.string().max(64),
    errorCode: z.string().max(64).nullable(),
    updatedAt: z.iso.datetime(),
    recordError: z.boolean(),
    active: z.boolean(),
    slotOccupied: z.boolean(),
    cleanupPending: z.boolean(),
  })
  .strict()
  .refine(
    (row) =>
      row.transferredBytes <= row.totalBytes &&
      row.verifiedBytes <= row.totalBytes &&
      (row.phase !== "completed" ||
        (row.destinationCreated &&
          row.transferredBytes === row.totalBytes &&
          row.verifiedBytes === row.totalBytes)),
  );
export type TransferRuntime = z.infer<typeof transferRuntimeSchema>;
