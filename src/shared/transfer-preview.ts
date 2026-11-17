export type TransferPreviewRow = {
  index: number;
  name: string;
  sourceLabel: string;
  destinationLabel: string;
  size: number | null;
  status: "checking" | "valid" | "conflict" | "unsupported";
  selected: boolean;
  errorCode: string | null;
};
export type TransferPreviewPage = {
  previewId: string;
  revision: number;
  direction: "upload" | "download";
  status: "checking" | "ready" | "error";
  serverName: string;
  endpoint: string;
  hostKeyFingerprint: string;
  rows: TransferPreviewRow[];
  total: number;
  nextOffset: number | null;
  selectedCount: number;
  confirmationToken: string | null;
  expiresAt: string | null;
  errorCode: string | null;
};
