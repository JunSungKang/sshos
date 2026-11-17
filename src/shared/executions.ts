import { z } from "zod";
import { remotePathSchema } from "./files";
import { endpointSnapshotSchema } from "./mutations";
const encodedSize = (value: string) => new TextEncoder().encode(value).length;
export const executionArgumentSchema = z
  .string()
  .refine(
    (value) =>
      encodedSize(value) <= 4096 &&
      !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value),
  );
export const executionArgumentsSchema = z
  .array(executionArgumentSchema)
  .max(64)
  .refine(
    (values) =>
      values.reduce((sum, value) => sum + encodedSize(value), 0) <= 16384,
  );
export const executionSpecSchema = z
  .object({
    path: remotePathSchema.refine((value) => value !== "/"),
    cwd: remotePathSchema,
    mode: z.enum(["direct", "sh", "bash"]),
    argv: executionArgumentsSchema,
  })
  .strict();
export type ExecutionSpec = z.infer<typeof executionSpecSchema>;
export function quotePOSIX(value: string): string {
  return "'" + value.replace(/'/gu, "'\\''") + "'";
}
export function executionCommand(input: ExecutionSpec): string {
  const spec = executionSpecSchema.parse(input),
    words = [
      ...(spec.mode === "direct"
        ? []
        : [spec.mode === "sh" ? "/bin/sh" : "/bin/bash"]),
      spec.path,
      ...spec.argv,
    ];
  return `cd ${quotePOSIX(spec.cwd)} && exec ${words.map(quotePOSIX).join(" ")}`;
}
export const executionPhaseSchema = z.enum([
  "prepared",
  "dispatching",
  "running",
  "stop_requested",
  "stop_unconfirmed",
  "exited",
  "result_unknown",
  "cancelled_not_sent",
  "rejected",
]);
export type ExecutionPhase = z.infer<typeof executionPhaseSchema>;
export const executionTerminal = (phase: ExecutionPhase): boolean =>
  ["exited", "result_unknown", "cancelled_not_sent", "rejected"].includes(
    phase,
  );
export const executionReceiptSchema = z
  .object({
    kind: z.enum(["gui_exec", "pty"]),
    taskId: z.uuid(),
    executionId: z.uuid().nullable(),
    terminalId: z.uuid().nullable(),
    serverId: z.uuid(),
    generation: z.int().positive(),
    backendEpoch: z.uuid(),
    endpointSnapshot: endpointSnapshotSchema,
    hostKeyFingerprint: z.string().max(128),
    source: remotePathSchema.nullable(),
    cwd: remotePathSchema.nullable(),
    destination: z.null(),
    phase: executionPhaseSchema,
    lastConfirmedPhase: z.string().max(64),
    channelAccepted: z.boolean(),
    channelClosed: z.boolean(),
    exitObserved: z.boolean(),
    exitCode: z.int().min(0).max(0xffffffff).nullable(),
    exitSignal: z.string().max(64).nullable(),
    stopRequestedAt: z.iso.datetime().nullable(),
    errorCode: z.string().max(64).nullable(),
    recoveryUncertain: z.boolean(),
    recoveredFromPhase: z.string().max(64).nullable(),
    acknowledgedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (row) =>
      (row.kind === "gui_exec"
        ? row.executionId === row.taskId &&
          row.terminalId === null &&
          row.source !== null &&
          row.cwd !== null
        : row.terminalId === row.taskId &&
          row.executionId === null &&
          row.source === null &&
          row.cwd === null) &&
      (row.phase !== "exited" || (row.exitObserved && row.channelClosed)) &&
      (!row.exitObserved || row.exitCode !== null || row.exitSignal !== null),
  );
export type ExecutionReceipt = z.infer<typeof executionReceiptSchema>;
export function recoverExecution(
  row: ExecutionReceipt,
  backup: boolean,
): ExecutionReceipt {
  if (backup || (!executionTerminal(row.phase) && row.phase !== "prepared"))
    return {
      ...row,
      phase: "result_unknown",
      errorCode: "EXEC_RESULT_UNKNOWN",
      recoveryUncertain: backup,
      recoveredFromPhase: row.phase,
      ...(backup ? { acknowledgedAt: null } : {}),
    };
  if (row.phase === "prepared")
    return {
      ...row,
      phase: "cancelled_not_sent",
      recoveredFromPhase: "prepared",
    };
  return row;
}
