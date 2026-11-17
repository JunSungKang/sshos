import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { viewerFrameSchema } from "../../shared/viewers/reader";
import type { EngineGateway } from "../engine-gateway";
/** Shares the worker's bounded SFTP read pool; no resource bytes enter RPC replay caches. */
export class WebContentReader {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly gateway: EngineGateway) {}
  async read(
    serverId: string,
    generation: number,
    path: string,
    signal: AbortSignal,
    check: () => void,
  ): Promise<Buffer> {
    if (this.waiting.length >= 32) throw new Error("REQUEST_BUSY");
    if (this.active >= 2)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    const viewerId = randomUUID();
    let opened = false;
    try {
      check();
      if (signal.aborted) throw new Error("REQUEST_CANCELLED");
      await this.gateway.request({
        action: "viewer:open",
        serverId,
        generation,
        viewerId,
        readGeneration: 1,
        path,
        parent: posix.dirname(path),
        kind: "image",
      });
      opened = true;
      const parts: Buffer[] = [];
      let size = 0,
        sequence = 0;
      while (true) {
        check();
        if (signal.aborted) throw new Error("REQUEST_CANCELLED");
        const frame = viewerFrameSchema.parse(
          await this.gateway.request({
            action: "viewer:next",
            serverId,
            generation,
            viewerId,
            readGeneration: 1,
            sequence,
          }),
        );
        if (
          frame.viewerId !== viewerId ||
          frame.readGeneration !== 1 ||
          frame.sequence !== sequence
        )
          throw new Error("TOKEN_EXPIRED");
        if (frame.status !== "waiting" && frame.metadata.path !== path)
          throw new Error("PATH_CHANGED");
        if (frame.status === "waiting") {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
        if (frame.status === "end") break;
        size += frame.bytes.length;
        if (size > 20 * 1024 * 1024) throw new Error("FILE_LIMIT");
        parts.push(Buffer.from(frame.bytes));
        sequence++;
      }
      check();
      return Buffer.concat(parts, size);
    } finally {
      if (opened)
        await this.gateway
          .request({
            action: "viewer:cancel",
            serverId,
            generation,
            viewerId,
            readGeneration: 1,
          })
          .catch(() => {});
      const wake = this.waiting.shift();
      if (wake) wake();
      else this.active--;
    }
  }
}
