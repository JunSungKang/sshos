import type { TransferPhase } from "./transfers";
export type TransferShelfRow = {
  taskId: string;
  name: string;
  serverName: string;
  direction: "upload" | "download";
  phase: TransferPhase;
  totalBytes: number;
  transferredBytes: number;
  verifiedBytes: number;
  bytesPerSecond: number | null;
  cancelable: boolean;
  registering: boolean;
  cleanupPending: boolean;
};
export type TransferShelf = {
  active: TransferShelfRow[];
  queued: number;
  registering: number;
  unresolved: number;
  failed: number;
};
