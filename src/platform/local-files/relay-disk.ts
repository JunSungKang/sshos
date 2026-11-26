import { lstat, realpath, statfs } from "node:fs/promises";
import { identity, type LocalDirectory } from "./selection";
import { MAX_TRANSFER_BYTES } from "../../shared/transfers";

export type RelayDiskView = {
  volumeId: string;
  sizeBytes: number;
  marginBytes: number;
  requiredBytes: number;
  osFreeBytes: string;
  effectiveBytes: string;
  shortfallBytes: number;
};

type Volume = { volumeId: string; free: bigint };
type Claim = {
  volumeId: string;
  relay: boolean;
  size: number;
  remaining: bigint;
  margin: bigint;
};

async function currentVolume(directory: LocalDirectory): Promise<Volume> {
  try {
    const before = await lstat(directory.path, { bigint: true });
    if (
      !before.isDirectory() ||
      identity(before) !== directory.identity ||
      (await realpath(directory.path)) !== directory.path
    )
      throw new Error("PATH_CHANGED");
    const stats = await statfs(directory.path, { bigint: true });
    const after = await lstat(directory.path, { bigint: true });
    if (identity(after) !== directory.identity) throw new Error("PATH_CHANGED");
    if (stats.bsize <= 0n || stats.bavail < 0n || stats.bavail > stats.blocks)
      throw new Error("LOCAL_SPACE_UNKNOWN");
    return {
      volumeId: before.dev.toString(),
      free: stats.bavail * stats.bsize,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "PATH_CHANGED") throw error;
    throw new Error("LOCAL_SPACE_UNKNOWN");
  }
}

function sizeOf(size: number): bigint {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_TRANSFER_BYTES)
    throw new Error("FILE_LIMIT");
  return BigInt(size);
}

/** Main owns a single instance shared by ordinary downloads and relay jobs. */
export class RelayDiskLedger {
  private readonly claims = new Map<string, Claim>();
  private tail: Promise<void> = Promise.resolve();
  constructor(
    private readonly measure: (
      directory: LocalDirectory,
    ) => Promise<Volume> = currentVolume,
  ) {}

  private serialized<T>(action: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async quote(
    directory: LocalDirectory,
    size: number,
    relay: boolean,
    except?: string,
  ): Promise<RelayDiskView> {
    const bytes = sizeOf(size),
      margin = relay ? (bytes + 9n) / 10n : 0n;
    const { volumeId, free } = await this.measure(directory);
    if (free < 0n || !volumeId) throw new Error("LOCAL_SPACE_UNKNOWN");
    let available = free;
    for (const [id, claim] of this.claims)
      if (id !== except && claim.volumeId === volumeId)
        available -= claim.remaining + claim.margin;
    const required = bytes + margin;
    // An external write may have consumed space promised to earlier jobs.
    // Clearing only the new file's size would still leave those jobs short.
    const shortfall =
      required > 0n && available < required ? required - available : 0n;
    return {
      volumeId,
      sizeBytes: size,
      marginBytes: Number(margin),
      requiredBytes: Number(required),
      osFreeBytes: free.toString(),
      effectiveBytes: (available > 0n ? available : 0n).toString(),
      shortfallBytes: Number(shortfall),
    };
  }

  preview(directory: LocalDirectory, size: number): Promise<RelayDiskView> {
    return this.serialized(() => this.quote(directory, size, true));
  }

  private admit(
    id: string,
    directory: LocalDirectory,
    size: number,
    expectedVolume?: string,
  ): Promise<void> {
    return this.serialized(async () => {
      if (this.claims.has(id)) throw new Error("REQUEST_BUSY");
      // Native selections bind dev:ino. A legacy ordinary download only
      // needs a new free-space gate when it competes with a relay promise.
      const originalVolume = directory.identity.split(":", 1)[0]!;
      if (
        expectedVolume === undefined &&
        !Array.from(this.claims.values()).some(
          (c) => c.relay && c.volumeId === originalVolume,
        )
      ) {
        this.claims.set(id, {
          volumeId: originalVolume,
          relay: false,
          size,
          remaining: sizeOf(size),
          margin: 0n,
        });
        return;
      }
      const quote = await this.quote(
        directory,
        size,
        expectedVolume !== undefined,
      );
      if (expectedVolume !== undefined && quote.volumeId !== expectedVolume)
        throw new Error("PATH_CHANGED");
      if (quote.shortfallBytes) throw new Error("LOCAL_DISK_FULL");
      this.claims.set(id, {
        volumeId: quote.volumeId,
        relay: expectedVolume !== undefined,
        size,
        remaining: BigInt(size),
        margin: BigInt(quote.marginBytes),
      });
    });
  }

  reserveOrdinary(
    id: string,
    directory: LocalDirectory,
    size: number,
  ): Promise<void> {
    return this.admit(id, directory, size);
  }

  reserveRelay(
    id: string,
    directory: LocalDirectory,
    size: number,
    volumeId: string,
  ): Promise<void> {
    return this.admit(id, directory, size, volumeId);
  }

  recheck(id: string, directory: LocalDirectory, size: number): Promise<void> {
    return this.serialized(async () => {
      const claim = this.claims.get(id);
      if (!claim || size !== claim.size) throw new Error("SOURCE_CHANGED");
      const quote = await this.quote(directory, size, true, id);
      if (claim.volumeId !== quote.volumeId) throw new Error("PATH_CHANGED");
      if (quote.shortfallBytes) throw new Error("LOCAL_DISK_FULL");
    });
  }

  // Only after the writer has synced and closed the verified immutable stage.
  // Mid-transfer progress and apparent file length never release a data charge.
  retained(id: string, volumeId: string, size: number): Promise<void> {
    return this.serialized(() => {
      const bytes = sizeOf(size),
        previous = this.claims.get(id);
      if (
        previous &&
        (previous.size !== size || previous.volumeId !== volumeId)
      )
        throw new Error("PATH_CHANGED");
      this.claims.set(id, {
        volumeId,
        relay: true,
        size,
        remaining: 0n,
        margin: (bytes + 9n) / 10n,
      });
    });
  }

  release(id: string): Promise<void> {
    return this.serialized(() => {
      this.claims.delete(id);
    });
  }
}
