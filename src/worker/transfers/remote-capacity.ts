import type { SFTPWrapper } from "ssh2";
import { TransferIOFailure } from "../../shared/file-policies/transfer-failure";

type StatRequest = (
  receive: (
    done: (error: Error | null | undefined, value: unknown) => void,
  ) => void,
) => Promise<unknown>;
type CapacityReport = {
  capacity: "known" | "unknown";
  availableBytes: string | null;
  errorCode?: "REMOTE_DISK_FULL" | "PERMISSION_DENIED";
};
const unknownCapacity: CapacityReport = {
  capacity: "unknown",
  availableBytes: null,
};
function integer(value: unknown): bigint | null {
  if (typeof value === "bigint" && value >= 0n) return value;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? BigInt(value)
    : null;
}
/** Extension versions are those negotiated by the pinned ssh2 SFTP subsystem. */
export async function remoteCapacity(
  sftp: SFTPWrapper,
  path: string,
  size: number,
  request: StatRequest,
): Promise<CapacityReport> {
  const extensions = (
    sftp as SFTPWrapper & { _extensions?: Record<string, string> }
  )._extensions;
  if (extensions && extensions["hardlink@openssh.com"] !== "1")
    throw new TransferIOFailure("HARDLINK_UNSUPPORTED");
  if (
    extensions?.["statvfs@openssh.com"] !== "2" ||
    typeof sftp.ext_openssh_statvfs !== "function"
  )
    return unknownCapacity;
  let raw: unknown;
  try {
    raw = await request((done) => sftp.ext_openssh_statvfs(path, done));
  } catch (error) {
    const status =
      error instanceof TransferIOFailure
        ? error.statusCode
        : (error as { code?: unknown })?.code;
    // Optional remote measurements may be withheld. Transport and session errors still propagate.
    if (status === 8 || status === 3 || status === 4) return unknownCapacity;
    throw error;
  }
  if (!raw || typeof raw !== "object") return unknownCapacity;
  const stat = raw as Record<string, unknown>;
  const blocks = integer(stat.f_bavail),
    unit = integer(stat.f_frsize),
    flags = integer(stat.f_flag);
  const available =
    blocks !== null && unit !== null && unit > 0n ? blocks * unit : null;
  const report: CapacityReport =
    available === null
      ? unknownCapacity
      : { capacity: "known", availableBytes: available.toString() };
  if (flags !== null && (flags & 1n) !== 0n)
    return { ...report, errorCode: "PERMISSION_DENIED" };
  const files = integer(stat.f_files);
  const outOfInodes =
    files !== null && files > 0n && integer(stat.f_favail) === 0n;
  if (outOfInodes || (available !== null && available < BigInt(size)))
    return { ...report, errorCode: "REMOTE_DISK_FULL" };
  return report;
}
