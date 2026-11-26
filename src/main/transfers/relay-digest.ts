import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { fileStat } from "../../platform/local-files/selection";
import type { TransferStat } from "../../shared/transfers";

/** Explicit retry verifies the bytes of the same staged object before granting a new B attempt. */
export async function verifyRelayDigest(
  path: string,
  expected: TransferStat,
  digest: string,
): Promise<void> {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const check = async () => {
      const actual = fileStat(await handle.stat({ bigint: true }));
      if (
        actual.identity !== expected.identity ||
        actual.size !== expected.size ||
        actual.mtime !== expected.mtime
      )
        throw Error("SOURCE_CHANGED");
    };
    await check();
    const buffer = Buffer.allocUnsafe(64 * 1024),
      hash = createHash("sha256");
    let position = 0;
    while (position < expected.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, expected.size - position),
        position,
      );
      if (!bytesRead) throw Error("SOURCE_CHANGED");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    await check();
    if (hash.digest("hex") !== digest) throw Error("VERIFY_MISMATCH");
  } finally {
    await handle.close();
  }
}
