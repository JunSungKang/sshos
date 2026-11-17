import { constants, type BigIntStats } from "node:fs";
import { open, lstat, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, dirname, basename, join } from "node:path";
import { validName } from "../../shared/files";
import {
  MAX_TRANSFER_BYTES,
  transferStatSchema,
  type TransferStat,
} from "../../shared/transfers";
import {
  TransferIOFailure,
  transferFailure,
} from "../../shared/file-policies/transfer-failure";
export type LocalDirectory = { path: string; identity: string };
export function supportedLocalPath(path: string): boolean {
  return (
    isAbsolute(path) &&
    !path.includes("\0") &&
    !path.startsWith("//") &&
    !path.startsWith("\\\\") &&
    (process.platform !== "win32" || /^[A-Za-z]:[\\/]/u.test(path))
  );
}
export function localDownloadName(
  name: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!validName(name)) return false;
  return (
    platform !== "win32" ||
    (!/[<>:"\\|?*]/u.test(name) &&
      !/[. ]$/u.test(name) &&
      !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(name))
  );
}
export const identity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}`;
export function fileStat(stat: BigIntStats): TransferStat {
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new TransferIOFailure("PATH_UNSUPPORTED");
  if (stat.size < 0n || stat.size > BigInt(MAX_TRANSFER_BYTES))
    throw new TransferIOFailure("FILE_LIMIT");
  return transferStatSchema.parse({
    size: Number(stat.size),
    mtime: stat.mtimeNs.toString(),
    identity: identity(stat),
  });
}
/** Main uses this only for a native selection; renderer paths never reach here. */
export async function inspectLocalDirectory(
  selected: string,
): Promise<LocalDirectory> {
  if (!supportedLocalPath(selected))
    throw new TransferIOFailure("PATH_UNSUPPORTED");
  try {
    const before = await lstat(selected, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink())
      throw new TransferIOFailure("PATH_UNSUPPORTED");
    const path = await realpath(selected);
    const stat = await lstat(path, { bigint: true });
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      identity(before) !== identity(stat)
    )
      throw new TransferIOFailure("PATH_UNSUPPORTED");
    return { path, identity: identity(stat) };
  } catch (error) {
    throw transferFailure(error);
  }
}
export async function inspectLocalFile(
  selected: string,
): Promise<{ path: string; parent: LocalDirectory; stat: TransferStat }> {
  if (!supportedLocalPath(selected))
    throw new TransferIOFailure("PATH_UNSUPPORTED");
  let handle: FileHandle | null = null;
  try {
    const before = await lstat(selected, { bigint: true });
    fileStat(before);
    const parent = await inspectLocalDirectory(dirname(selected));
    const path = join(parent.path, basename(selected));
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat({ bigint: true });
    if (identity(before) !== identity(stat))
      throw new TransferIOFailure("SOURCE_CHANGED");
    return { path, parent, stat: fileStat(stat) };
  } catch (error) {
    throw transferFailure(error);
  } finally {
    await handle?.close();
  }
}
