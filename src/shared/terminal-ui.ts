import type { ExecutionOutput } from "./execution-ui";
import type { TerminalRuntime, TerminalFreeze } from "./terminals";
export type TerminalDescriptor = {
  name: string;
  terminalId: string;
  terminalToken: string;
  windowId: string;
  outputToken: string;
  readGeneration: number;
  nextOffset: number;
  restore: TerminalFreeze | null;
  status: "restoring" | "ready" | "disconnected" | "blocked" | "unavailable";
  inputAllowed: boolean;
  nextInputSequence: number;
  runtime: TerminalRuntime;
};
export type TerminalInputResult =
  | { accepted: false; retryAfterMs: number }
  | { accepted: true; nextSequence: number };
export function hasTerminalFileControls(text: string): boolean {
  // The file reader already normalized CRLF. Only HT and LF are valid C0 controls.
  return /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(text);
}
export type TerminalPastePreview = {
  fileBracketed: boolean | null;
  terminalName: string;
  confirmationToken: string;
  terminalId: string;
  serverName: string;
  endpoint: string;
  text: string;
  byteLength: number;
  requiresConfirmation: boolean;
  expiresAt: string;
};
export type TerminalClosePreview = {
  terminalName: string;
  confirmationToken: string;
  terminalId: string;
  serverName: string;
  endpoint: string;
  active: boolean;
  expiresAt: string;
};
export type TerminalFrame =
  | { status: "waiting" }
  | { status: "data"; batch: ExecutionOutput; inputAllowed: boolean };
