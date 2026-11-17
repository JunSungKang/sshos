import type { SFTPWrapper, Stats } from "ssh2";
import { remotePathSchema, type FileEntry } from "../../shared/files";
export interface ControlAccess {
  sftp: SFTPWrapper;
  check(): void;
  quarantine(): void;
}
export async function controlCall<T>(
  control: ControlAccess,
  call: (done: (error: Error | undefined | null, value: T) => void) => void,
  duration = 15000,
): Promise<T> {
  control.check();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      control.quarantine();
      reject(new Error("IO_TIMEOUT"));
    }, duration);
    try {
      call((error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          control.check();
          if (error) {
            const code = (error as Error & { code?: number }).code;
            throw Object.assign(
              new Error(code === 3 ? "PERMISSION_DENIED" : "INTERNAL_ERROR"),
              { code },
            );
          }
          resolve(value);
        } catch (failure) {
          reject(failure);
        }
      });
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}
export function fileType(stat: Stats): FileEntry["type"] {
  return stat.isSymbolicLink()
    ? "symlink"
    : stat.isDirectory()
      ? "directory"
      : stat.isFile()
        ? "file"
        : stat.isFIFO() ||
            stat.isSocket() ||
            stat.isBlockDevice() ||
            stat.isCharacterDevice()
          ? "special"
          : "unknown";
}
export async function verifyDirectory(
  control: ControlAccess,
  path: string,
): Promise<void> {
  remotePathSchema.parse(path);
  const stat = await controlCall<Stats>(control, (done) =>
    control.sftp.lstat(path, done),
  );
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("PATH_UNSUPPORTED");
  const canonical = await controlCall<string>(control, (done) =>
    control.sftp.realpath(path, done),
  );
  if (canonical !== path) throw new Error("PATH_CHANGED");
}
