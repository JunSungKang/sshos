import { z } from "zod";
import { executionRuntimeSchema } from "./execution-protocol";
export const terminalRuntimeSchema = z
  .object({
    execution: executionRuntimeSchema,
    uiReady: z.boolean(),
    inputUncertain: z.boolean(),
    inputInFlight: z.int().min(0).max(65536),
    nextInputSequence: z.int().positive(),
  })
  .strict()
  .refine((row) => row.execution.receipt.kind === "pty");
export type TerminalRuntime = z.infer<typeof terminalRuntimeSchema>;
export const terminalFreezeSchema = z
  .object({
    restoreToken: z.uuid(),
    startOffset: z.int().nonnegative(),
    endOffset: z.int().nonnegative(),
    omitted: z.boolean(),
    nextInputSequence: z.int().positive(),
  })
  .strict()
  .refine((row) => row.startOffset <= row.endOffset);
export type TerminalFreeze = z.infer<typeof terminalFreezeSchema>;
export const terminalInputSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.length > 0 && bytes.length <= 65536);
export const terminalSizeSchema = z
  .object({ cols: z.int().min(2).max(500), rows: z.int().min(1).max(200) })
  .strict();
export function terminalSize(
  cols: number,
  rows: number,
): { cols: number; rows: number } {
  if (!Number.isFinite(cols) || !Number.isFinite(rows))
    throw new Error("INPUT_INVALID");
  return {
    cols: Math.max(2, Math.min(500, Math.floor(cols))),
    rows: Math.max(1, Math.min(200, Math.floor(rows))),
  };
}
