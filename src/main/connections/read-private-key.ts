import { lstat, open } from "node:fs/promises";
import { constants } from "node:fs";

export const MAX_PRIVATE_KEY_BYTES = 512 * 1024;

/** Called only with a main-owned OS dialog capability, never a renderer path. */
export async function readPrivateKeyFile(path: string): Promise<Buffer> {
  try {
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new Error("KEY_INVALID");
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const scratch = Buffer.alloc(MAX_PRIVATE_KEY_BYTES + 1);
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.size > MAX_PRIVATE_KEY_BYTES ||
        stat.size === 0
      )
        throw new Error("KEY_INVALID");
      let bytes = 0;
      while (bytes < scratch.length) {
        const read = await handle.read(
          scratch,
          bytes,
          scratch.length - bytes,
          bytes,
        );
        if (read.bytesRead === 0) break;
        bytes += read.bytesRead;
      }
      if (bytes === 0 || bytes > MAX_PRIVATE_KEY_BYTES)
        throw new Error("KEY_INVALID");
      return Buffer.from(scratch.subarray(0, bytes));
    } finally {
      scratch.fill(0);
      await handle.close();
    }
  } catch {
    throw new Error("KEY_INVALID");
  }
}
