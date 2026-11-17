import { randomUUID } from "node:crypto";
import {
  remotePathSchema,
  compareNames,
  type FileEntry,
  type FilePage,
} from "../../shared/files";
import type { CommandAccess } from "./metadata/command-runner";
import { UbuntuMetadata } from "./metadata/ubuntu-metadata";
type Snapshot = {
  serverId: string;
  generation: number;
  id: string;
  path: string;
  listedAt: string;
  partial: boolean;
  rows: FileEntry[];
};
export class FileBrowser {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly reading = new Set<string>();
  private readonly cancelled = new Set<string>();
  constructor(
    private readonly access: (
      serverId: string,
      generation: number,
    ) => CommandAccess,
  ) {}
  private metadata(serverId: string, generation: number) {
    return new UbuntuMetadata(this.access(serverId, generation));
  }
  close(browserId: string): void {
    this.snapshots.delete(browserId);
    if (this.reading.has(browserId)) this.cancelled.add(browserId);
  }
  async list(
    serverId: string,
    generation: number,
    browserId: string,
    path: string,
  ): Promise<FilePage> {
    if (this.reading.has(browserId)) throw new Error("REQUEST_BUSY");
    if (
      !this.snapshots.has(browserId) &&
      this.snapshots.size + this.reading.size >= 9
    )
      throw new Error("WINDOW_LIMIT");
    const metadata = this.metadata(serverId, generation);
    this.reading.add(browserId);
    this.cancelled.delete(browserId);
    try {
      const { rows, partial } = await metadata.list(
        remotePathSchema.parse(path),
      );
      rows.sort(
        (a, b) =>
          Number(b.type === "directory") - Number(a.type === "directory") ||
          compareNames(a.rawName || a.name, b.rawName || b.name),
      );
      if (this.cancelled.has(browserId)) throw new Error("REQUEST_CANCELLED");
      this.snapshots.set(browserId, {
        id: randomUUID(),
        serverId,
        generation,
        path,
        listedAt: new Date().toISOString(),
        partial,
        rows,
      });
      return this.page(serverId, generation, browserId, 0);
    } finally {
      this.reading.delete(browserId);
      this.cancelled.delete(browserId);
    }
  }
  page(
    serverId: string,
    generation: number,
    browserId: string,
    offset: number,
    snapshotId?: string,
  ): FilePage {
    this.access(serverId, generation).check();
    const snapshot = this.snapshots.get(browserId);
    if (
      !snapshot ||
      snapshot.serverId !== serverId ||
      snapshot.generation !== generation ||
      (snapshotId !== undefined && snapshot.id !== snapshotId) ||
      offset > snapshot.rows.length
    )
      throw new Error("TOKEN_EXPIRED");
    const entries: FileEntry[] = [];
    let bytes = 0;
    for (const row of snapshot.rows.slice(offset, offset + 256)) {
      const size = Buffer.byteLength(JSON.stringify(row));
      if (bytes + size > 192 * 1024) break;
      entries.push(row);
      bytes += size;
    }
    const next = offset + entries.length;
    return {
      snapshotId: snapshot.id,
      path: snapshot.path,
      listedAt: snapshot.listedAt,
      partial: snapshot.partial,
      total: snapshot.rows.length,
      offset,
      nextOffset: next < snapshot.rows.length ? next : null,
      entries,
    };
  }
}
