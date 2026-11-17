import {
  remotePathSchema,
  validName,
  displayName,
  type FileEntry,
  type FileProperties,
} from "../../../shared/files";
import { runCommand, successful, type CommandAccess } from "./command-runner";
import {
  listCommand,
  propertiesCommand,
  directoryCommand,
} from "./ubuntu-commands";
function uint(raw: string, base = 10): number {
  if (
    !(base === 8 ? /^[0-7]+$/ : base === 16 ? /^[0-9a-f]+$/i : /^\d+$/).test(
      raw,
    )
  )
    throw new Error("COMMAND_OUTPUT_INVALID");
  const n = Number.parseInt(raw, base);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("COMMAND_OUTPUT_INVALID");
  return n;
}
function fields(bytes: Buffer): string[] {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0");
}
export function canonicalPath(bytes: Buffer): string {
  const f = fields(bytes);
  if (f.length !== 2 || f[1] !== "") throw new Error("COMMAND_OUTPUT_INVALID");
  return remotePathSchema.parse(f[0]);
}
export function parseListing(
  bytes: Buffer,
  path: string,
  truncated = false,
): { rows: FileEntry[]; partial: boolean } {
  const f = new TextDecoder().decode(bytes).split("\0");
  if (f.shift() !== path) throw new Error("PATH_CHANGED");
  const complete = f.at(-1) === "";
  if (complete) f.pop();
  else if (!truncated) throw new Error("COMMAND_OUTPUT_INVALID");
  const rows: FileEntry[] = [];
  let partial = truncated;
  if (!truncated && f.length % 7) throw new Error("COMMAND_OUTPUT_INVALID");
  for (let i = 0; i + 7 <= f.length; i += 7) {
    if (rows.length === 10000) {
      partial = true;
      break;
    }
    const [name, kind, size, mtime, mode, uid, gid] = f.slice(i, i + 7) as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (!name || name === "." || name === ".." || name.includes("/"))
      throw new Error("COMMAND_OUTPUT_INVALID");
    if (!/^[fdlbcpsD?]$/.test(kind) || !/^\d+(?:\.\d+)?$/.test(mtime))
      throw new Error("COMMAND_OUTPUT_INVALID");
    const type =
      kind === "d"
        ? "directory"
        : kind === "f"
          ? "file"
          : kind === "l"
            ? "symlink"
            : kind === "?"
              ? "unknown"
              : "special";
    const permission = uint(mode, 8);
    if (permission > 0o7777) throw new Error("COMMAND_OUTPUT_INVALID");
    const seconds = Math.floor(Number(mtime));
    if (!Number.isSafeInteger(seconds))
      throw new Error("COMMAND_OUTPUT_INVALID");
    const operable = validName(name) && ["file", "directory"].includes(type);
    rows.push({
      rawName: validName(name) ? name : "",
      name: displayName(name),
      type,
      operable,
      size: uint(size),
      mtime: seconds,
      mode: permission,
      uid: uint(uid),
      gid: uint(gid),
    });
  }
  return { rows, partial };
}
export function parseProperties(bytes: Buffer, path: string): FileProperties {
  const f = fields(bytes);
  if (f.length !== 9 || f.pop() !== "")
    throw new Error("COMMAND_OUTPUT_INVALID");
  for (const raw of [f[5], f[6]])
    if (!raw || !/^\d{1,20}$/.test(raw) || BigInt(raw) > 18446744073709551615n)
      throw new Error("COMMAND_OUTPUT_INVALID");
  const mode = uint(f[0]!, 16),
    kind = mode & 0o170000;
  const type =
    kind === 0o100000
      ? "file"
      : kind === 0o040000
        ? "directory"
        : kind === 0o120000
          ? "symlink"
          : "special";
  return {
    path,
    type,
    mode: mode & 0o7777,
    size: uint(f[1]!),
    mtime: uint(f[2]!),
    uid: uint(f[3]!),
    gid: uint(f[4]!),
    inode: f[5]!,
    device: f[6]!,
    links: uint(f[7]!),
    listedAt: new Date().toISOString(),
  };
}
export class UbuntuMetadata {
  constructor(private readonly access: CommandAccess) {}
  async verifyDirectory(path: string): Promise<void> {
    if (
      canonicalPath(
        successful(
          await runCommand(this.access, directoryCommand(path), 8192, 15000),
        ),
      ) !== path
    )
      throw new Error("PATH_CHANGED");
  }
  async list(path: string) {
    const result = await runCommand(this.access, listCommand(path));
    if (!result.truncated && (result.code !== 0 || result.stderr))
      throw new Error("COMMAND_FAILED");
    return parseListing(result.bytes, path, result.truncated);
  }
  async properties(path: string): Promise<FileProperties> {
    return parseProperties(
      successful(
        await runCommand(this.access, propertiesCommand(path), 8192, 15000),
      ),
      path,
    );
  }
}
