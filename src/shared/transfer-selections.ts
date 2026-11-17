export type UploadChoice = {
  token: string;
  name: string;
  size: number | null;
  status: "valid" | "unsupported";
  errorCode: string | null;
};
export type DownloadDirectoryChoice = { token: string; name: string };
