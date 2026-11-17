import type { z } from "zod";
import type {
  executionRuntimeSchema,
  executionOutputSchema,
} from "./execution-protocol";
import type { ExecutionSpec } from "./executions";
export type ExecutionRuntime = z.infer<typeof executionRuntimeSchema>;
export type ExecutionOutput = z.infer<typeof executionOutputSchema>;
export type ExecutionContext = {
  name: string;
  serverName: string;
  endpoint: string;
  hostKeyFingerprint: string;
  path: string;
  cwd: string;
  posixConfirmed: boolean;
};
export type ExecutionPreview = ExecutionContext &
  ExecutionSpec & { confirmationToken: string; expiresAt: string };
export type ExecutionDescriptor = {
  executionId: string;
  name: string;
  outputToken: string;
  readGeneration: number;
  nextOffset: number;
  outputAvailable: boolean;
  runtime: ExecutionRuntime;
};
export type ExecutionFrame =
  | { status: "waiting" }
  | { status: "data"; batch: ExecutionOutput };
export type ExecutionActionPreview = {
  confirmationToken: string;
  executionId: string;
  action: "stop" | "close_channel" | "close_window";
  serverName: string;
  endpoint: string;
  path: string | null;
  phase: string;
  active: boolean;
  canStop: boolean;
  expiresAt: string;
};
