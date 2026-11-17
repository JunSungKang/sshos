import { createHash } from "node:crypto";
import {
  MAX_TRANSFER_BYTES,
  TRANSFER_CHUNK_BYTES,
  TRANSFER_PIPELINE,
} from "../../shared/transfers";

export interface ReadPort {
  read(
    bytes: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<number>;
}
export interface WritePort {
  write(
    bytes: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<number>;
}
export interface IOObserver {
  check(): void;
  activity(): void;
  progress(kind: "transferred" | "verified", bytes: number): void;
}
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
const observed = <T>(promise: Promise<T>): Promise<Outcome<T>> =>
  promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
function value<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
function sizeGuard(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_TRANSFER_BYTES)
    throw new Error("FILE_LIMIT");
}
function countGuard(count: number, maximum: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > maximum)
    throw new Error("IO_FAILED");
}

export async function readTransferBlock(
  source: ReadPort,
  position: number,
  length: number,
  observer: IOObserver,
): Promise<Buffer> {
  sizeGuard(position);
  if (
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > TRANSFER_CHUNK_BYTES ||
    position + length > MAX_TRANSFER_BYTES
  )
    throw new Error("FILE_LIMIT");
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    observer.check();
    const count = await source.read(
      bytes,
      offset,
      length - offset,
      position + offset,
    );
    observer.check();
    countGuard(count, length - offset);
    observer.activity();
    if (count === 0) throw new Error("SOURCE_CHANGED");
    offset += count;
  }
  return bytes;
}
async function verifyEOF(
  source: ReadPort,
  size: number,
  observer: IOObserver,
): Promise<void> {
  observer.check();
  const count = await source.read(Buffer.alloc(1), 0, 1, size);
  observer.check();
  countGuard(count, 1);
  observer.activity();
  if (count !== 0) throw new Error("SOURCE_CHANGED");
}
async function writeBlock(
  destination: WritePort,
  bytes: Buffer,
  position: number,
  observer: IOObserver,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    observer.check();
    const count = await destination.write(
      bytes,
      offset,
      bytes.length - offset,
      position + offset,
    );
    observer.check();
    countGuard(count, bytes.length - offset);
    observer.activity();
    if (!count) throw new Error("IO_FAILED");
    offset += count;
    observer.progress("transferred", count);
  }
}
/** At most16 read buffers, emitted in offset order despite out-of-order ACKs. */
async function* orderedBlocks(
  source: ReadPort,
  size: number,
  observer: IOObserver,
): AsyncGenerator<{ position: number; bytes: Buffer }> {
  const pending: { position: number; promise: Promise<Outcome<Buffer>> }[] = [];
  let position = 0;
  let failure: unknown;
  const add = () => {
    if (position >= size) return;
    observer.check();
    if (failure) throw failure;
    const offset = position;
    const length = Math.min(TRANSFER_CHUNK_BYTES, size - offset);
    position += length;
    const promise = observed(
      readTransferBlock(source, offset, length, observer),
    );
    void promise.then((result) => {
      if (!result.ok) failure = result.error;
    });
    pending.push({ position: offset, promise });
  };
  try {
    while (pending.length < TRANSFER_PIPELINE && position < size) add();
    while (pending.length) {
      const first = pending.shift()!;
      const bytes = value(await first.promise);
      observer.check();
      if (failure) throw failure;
      yield { position: first.position, bytes };
      add();
    }
  } finally {
    await Promise.all(pending.map((row) => row.promise));
  }
}

/** No full-file Buffer and no application-level retransmission of remote writes. */
export async function copyAndHash(
  direction: "upload" | "download",
  source: ReadPort,
  destination: WritePort,
  size: number,
  observer: IOObserver,
): Promise<string> {
  sizeGuard(size);
  const hash = createHash("sha256");
  if (direction === "upload") {
    const pending: Promise<Outcome<void>>[] = [];
    let failure: unknown;
    try {
      for (let position = 0; position < size; ) {
        if (pending.length >= TRANSFER_PIPELINE) value(await pending.shift()!);
        observer.check();
        if (failure) throw failure;
        const length = Math.min(TRANSFER_CHUNK_BYTES, size - position);
        const bytes = await readTransferBlock(
          source,
          position,
          length,
          observer,
        );
        hash.update(bytes);
        const write = observed(
          writeBlock(destination, bytes, position, observer),
        );
        void write.then((result) => {
          if (!result.ok) failure = result.error;
        });
        pending.push(write);
        position += length;
      }
      for (const write of pending) value(await write);
    } finally {
      await Promise.all(pending);
    }
  } else {
    for await (const block of orderedBlocks(source, size, observer)) {
      hash.update(block.bytes);
      await writeBlock(destination, block.bytes, block.position, observer);
    }
  }
  await verifyEOF(source, size, observer);
  return hash.digest("hex");
}
export async function hashReadBack(
  source: ReadPort,
  size: number,
  observer: IOObserver,
): Promise<string> {
  sizeGuard(size);
  const hash = createHash("sha256");
  for await (const block of orderedBlocks(source, size, observer)) {
    hash.update(block.bytes);
    observer.progress("verified", block.bytes.length);
  }
  await verifyEOF(source, size, observer);
  return hash.digest("hex");
}
