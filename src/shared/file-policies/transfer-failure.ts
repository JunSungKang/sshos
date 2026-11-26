import { errorCodeOf } from "../errors";
export class TransferIOFailure extends Error {
  constructor(
    code: string,
    readonly uncertain = false,
    readonly statusCode: number | string | null = null,
  ) {
    super(code);
  }
}
export type MutationACK =
  | "temp_create_ack"
  | "final_link_ack"
  | "temp_remove_ack";
const knownNative = new Set([
  "EEXIST",
  "EACCES",
  "EPERM",
  "EROFS",
  "ENOENT",
  "ENOTDIR",
  "EISDIR",
  "ENAMETOOLONG",
  "EINVAL",
  "EXDEV",
  "ENOTSUP",
  "EOPNOTSUPP",
  "ENOSPC",
  "EDQUOT",
]);
export function transferFailure(
  error: unknown,
  mutation: MutationACK | null = null,
  native = false,
): TransferIOFailure {
  if (error instanceof TransferIOFailure) return error;
  const status = (error as { code?: unknown })?.code;
  const value =
    typeof status === "number" || typeof status === "string" ? status : null;
  // A protocol status owns classification. Its server-supplied description is never an app code.
  let code = value === null ? errorCodeOf(error) : "INTERNAL_ERROR";
  if (native && value === "ENOSPC") code = "LOCAL_DISK_FULL";
  else if (native && value === "EDQUOT") code = "LOCAL_QUOTA_EXCEEDED";
  else if (!native && value === 14) code = "REMOTE_DISK_FULL";
  else if (!native && value === 15) code = "REMOTE_QUOTA_EXCEEDED";
  else if (value === 3 || ["EACCES", "EPERM", "EROFS"].includes(String(value)))
    code = "PERMISSION_DENIED";
  else if (value === "EEXIST") code = "NAME_CONFLICT";
  else if (
    value === 2 ||
    ["ENOENT", "ENOTDIR", "EISDIR", "ENAMETOOLONG", "EINVAL"].includes(
      String(value),
    )
  )
    code = "PATH_UNSUPPORTED";
  else if (
    mutation === "final_link_ack" &&
    (value === 8 || ["EXDEV", "ENOTSUP", "EOPNOTSUPP"].includes(String(value)))
  )
    code = "HARDLINK_UNSUPPORTED";
  const known = native
    ? knownNative.has(String(value))
    : typeof value === "number";
  return new TransferIOFailure(code, mutation !== null && !known, value);
}
