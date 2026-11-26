import { constants } from "node:fs";
import {
  open,
  lstat,
  realpath,
  link,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import {
  type TransferReceipt,
  type TransferStat,
} from "../../shared/transfers";
import { TransferIOFailure, type TransferSource } from "./runner";
import { TransferScope } from "./scope";
import type { WritePort } from "./io";

import {
  localDownloadName,
  supportedLocalPath,
  fileStat,
  identity,
  type LocalDirectory,
} from "../../platform/local-files/selection";
/** Local authority is one canonical parent plus the immutable row's source/name. */
export class LocalTransferFiles {
  private readonly handles = new Set<FileHandle>();
  private writeHandle: FileHandle | null = null;
  private tempIdentity: string | null = null;
  constructor(
    private readonly row: TransferReceipt,
    private readonly directory: LocalDirectory,
    private readonly scope: TransferScope,
  ) {
    if (
      row.localParent !== directory.path ||
      !supportedLocalPath(directory.path) ||
      resolve(directory.path) !== directory.path
    )
      throw new TransferIOFailure("PATH_UNSUPPORTED");
    const local = row.direction === "upload" ? row.source : row.destination;
    if (
      !supportedLocalPath(local) ||
      dirname(local) !== directory.path ||
      !localDownloadName(basename(local))
    )
      throw new TransferIOFailure("PATH_UNSUPPORTED");
    if (
      row.direction === "download" &&
      (dirname(row.tempPath) !== directory.path ||
        basename(row.tempPath) !== `.sshos-${row.taskId}.part` ||
        row.destination === row.tempPath)
    )
      throw new TransferIOFailure("PATH_UNSUPPORTED");
  }
  async verifyParent(): Promise<void> {
    this.scope.check();
    const stat = await this.scope.native(() =>
      lstat(this.directory.path, { bigint: true }),
    );
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      identity(stat) !== this.directory.identity ||
      (await this.scope.native(() => realpath(this.directory.path))) !==
        this.directory.path
    )
      throw new TransferIOFailure("PATH_UNSUPPORTED");
  }
  async absentDestination(): Promise<void> {
    try {
      await this.scope.native(() => lstat(this.row.destination));
    } catch (error) {
      if (error instanceof TransferIOFailure && error.statusCode === "ENOENT")
        return;
      throw error;
    }
    throw new TransferIOFailure("NAME_CONFLICT");
  }
  private async acquire(
    path: string,
    flags: number,
    mode?: number,
    mutation: "temp_create_ack" | null = null,
  ): Promise<FileHandle> {
    return this.scope.native(async () => {
      const handle = await open(path, flags, mode);
      this.handles.add(handle);
      return handle;
    }, mutation);
  }
  private async close(handle: FileHandle): Promise<void> {
    if (!this.handles.has(handle)) return;
    await this.scope.native(() => handle.close());
    this.handles.delete(handle);
  }
  private source(handle: FileHandle): TransferSource {
    return {
      read: (bytes, offset, length, position) =>
        this.scope.native(
          async () =>
            (await handle.read(bytes, offset, length, position)).bytesRead,
        ),
      stat: async () =>
        fileStat(await this.scope.native(() => handle.stat({ bigint: true }))),
      close: () => this.close(handle),
    };
  }
  async openSource(): Promise<TransferSource> {
    await this.verifyParent();
    const before = await this.scope.native(() =>
      lstat(this.row.source, { bigint: true }),
    );
    fileStat(before);
    const handle = await this.acquire(
      this.row.source,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const stat = await this.scope.native(() => handle.stat({ bigint: true }));
    if (identity(before) !== identity(stat))
      throw new TransferIOFailure("SOURCE_CHANGED");
    fileStat(stat);
    return this.source(handle);
  }
  async createTemp(): Promise<WritePort> {
    await this.verifyParent();
    const handle = await this.acquire(
      this.row.tempPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
      "temp_create_ack",
    );
    this.writeHandle = handle;
    if (this.row.relayParentId) await this.captureTempIdentity(handle);
    return {
      write: async (bytes, offset, length, position) => {
        await this.captureTempIdentity(handle);
        return this.scope.native(
          async () =>
            (await handle.write(bytes, offset, length, position)).bytesWritten,
        );
      },
    };
  }
  private async captureTempIdentity(handle: FileHandle): Promise<void> {
    if (this.tempIdentity) return;
    const stat = await this.scope.native(() => handle.stat({ bigint: true }));
    fileStat(stat);
    this.tempIdentity = identity(stat);
  }
  async finishWrite(): Promise<void> {
    const handle = this.writeHandle;
    if (!handle) throw new TransferIOFailure("INTERNAL_ERROR");
    await this.captureTempIdentity(handle);
    await this.scope.native(() => handle.sync());
    await this.close(handle);
    this.writeHandle = null;
  }
  async tempStat(): Promise<TransferStat> {
    await this.verifyParent();
    const stat = await this.scope.native(() =>
      lstat(this.row.tempPath, { bigint: true }),
    );
    if (!this.tempIdentity || identity(stat) !== this.tempIdentity)
      throw new TransferIOFailure("PATH_UNSUPPORTED");
    return fileStat(stat);
  }
  async openVerification(): Promise<TransferSource> {
    await this.tempStat();
    try {
      const handle = await this.acquire(
        this.row.tempPath,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const stat = await this.scope.native(() => handle.stat({ bigint: true }));
      if (identity(stat) !== this.tempIdentity)
        throw new TransferIOFailure("PATH_UNSUPPORTED");
      fileStat(stat);
      return this.source(handle);
    } catch (error) {
      if (
        error instanceof TransferIOFailure &&
        error.message === "PERMISSION_DENIED"
      )
        throw new TransferIOFailure("VERIFY_READ_DENIED");
      throw error;
    }
  }
  async linkDestination(): Promise<void> {
    await this.tempStat();
    await this.scope.native(
      () => link(this.row.tempPath, this.row.destination),
      "final_link_ack",
    );
  }
  async confirmDestination(): Promise<void> {
    await this.verifyParent();
    const stat = await this.scope.native(() =>
      lstat(this.row.destination, { bigint: true }),
    );
    const value = fileStat(stat);
    if (
      identity(stat) !== this.tempIdentity ||
      value.size !== this.row.totalBytes
    )
      throw new TransferIOFailure("VERIFY_MISMATCH");
  }
  async removeTemp(): Promise<void> {
    await this.tempStat();
    await this.scope.native(() => unlink(this.row.tempPath), "temp_remove_ack");
  }
  async shutdown(): Promise<void> {
    // Scope.shutdown has already waited for late native acquisitions/writes.
    const outcomes = await Promise.allSettled(
      [...this.handles].map((handle) => handle.close()),
    );
    this.handles.clear();
    this.writeHandle = null;
    if (outcomes.some((result) => result.status === "rejected"))
      throw new TransferIOFailure("INTERNAL_ERROR");
  }
}
