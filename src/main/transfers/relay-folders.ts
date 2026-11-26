import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  filePageSchema,
  remotePathSchema,
  validName,
} from "../../shared/files";
import type { ConnectionController } from "../connections/connections";
import type { EngineGateway } from "../engine-gateway";

const inputSchema = z
  .object({
    sessionToken: z.uuid(),
    path: remotePathSchema,
    offset: z.int().min(0).max(10000),
  })
  .strict();
type Listing = {
  token: string;
  path: string;
  names: string[];
  partial: boolean;
};
/** Cache one bounded picker listing. The temporary browser owns no visible window or entry capabilities. */
export class RelayFolders {
  private current: Listing | null = null;
  private sequence = 0;
  constructor(
    private readonly connections: ConnectionController,
    private readonly gateway: EngineGateway,
  ) {}
  invalidate(): void {
    this.sequence++;
    this.current = null;
  }
  async list(payload: unknown) {
    const { sessionToken, path, offset } = inputSchema.parse(payload);
    const target = this.connections.sessionCapability(sessionToken);
    if (offset === 0) {
      this.invalidate();
      const revision = this.sequence,
        browserId = randomUUID(),
        names: string[] = [];
      let partial = false;
      try {
        let page = filePageSchema.parse(
          await this.gateway.request({
            action: "file:list",
            ...target,
            browserId,
            path,
          }),
        );
        partial = page.partial;
        const snapshotId = page.snapshotId;
        let expectedOffset = 0;
        for (;;) {
          if (
            page.path !== path ||
            page.snapshotId !== snapshotId ||
            page.offset !== expectedOffset
          )
            throw new Error("PATH_CHANGED");
          if (revision !== this.sequence) throw new Error("REQUEST_CANCELLED");
          for (const row of page.entries)
            if (
              row.type === "directory" &&
              row.operable &&
              validName(row.rawName)
            )
              names.push(row.rawName);
          // Directory entries precede all other kinds in the engine snapshot.
          if (
            page.entries.some((row) => row.type !== "directory") ||
            page.nextOffset === null
          )
            break;
          expectedOffset = page.nextOffset;
          if (
            expectedOffset <= page.offset ||
            expectedOffset !== page.offset + page.entries.length
          )
            throw new Error("PATH_CHANGED");
          page = filePageSchema.parse(
            await this.gateway.request({
              action: "file:page",
              ...target,
              browserId,
              snapshotId: page.snapshotId,
              offset: page.nextOffset,
            }),
          );
        }
      } finally {
        await this.gateway
          .request({ action: "file:close", ...target, browserId })
          .catch(() => {});
      }
      if (revision !== this.sequence) throw new Error("REQUEST_CANCELLED");
      this.connections.sessionCapability(sessionToken);
      this.current = { token: sessionToken, path, names, partial };
    }
    const listing = this.current;
    if (
      !listing ||
      listing.token !== sessionToken ||
      listing.path !== path ||
      offset > listing.names.length
    )
      throw new Error("TOKEN_EXPIRED");
    const directories = listing.names.slice(offset, offset + 128),
      end = offset + directories.length;
    return {
      path,
      directories,
      nextOffset: end < listing.names.length ? end : null,
      partial: listing.partial,
    };
  }
}
