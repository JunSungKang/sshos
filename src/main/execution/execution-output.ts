import { randomUUID } from "node:crypto";
import { executionOutputSchema } from "../../shared/execution-protocol";
import type {
  ExecutionFrame,
  ExecutionOutput,
} from "../../shared/execution-ui";
import type { EngineCommand } from "../../shared/engine-protocol";
import type { EngineGateway } from "../engine-gateway";
type Reader = {
  id: string;
  serverId: string;
  generation: number;
  epoch: string;
  token: string;
  readGeneration: number;
  cursor: number;
  replay: { cursor: number; batch: ExecutionOutput } | null;
  pending: boolean;
  nextAt: number;
  valid: boolean;
};
export class ExecutionOutputReaders {
  private readonly readers = new Map<string, Reader>();
  constructor(
    private readonly gateway: EngineGateway,
    private readonly checkWindow: (id: string) => void,
    private readonly readRequest: (
      serverId: string,
      generation: number,
      id: string,
      cursor: number,
    ) => EngineCommand = (serverId, generation, id, cursor) => ({
      action: "execution:read",
      serverId,
      generation,
      executionId: id,
      cursor,
    }),
  ) {}
  open(
    windowId: string,
    executionId: string,
    serverId: string,
    generation: number,
    initialCursor = 0,
  ): { token: string; readGeneration: number; cursor: number } {
    const prior = this.readers.get(windowId);
    if (prior) prior.valid = false;
    const row: Reader = {
      id: executionId,
      serverId,
      generation,
      epoch: this.gateway.epoch,
      token: randomUUID(),
      readGeneration: (prior?.readGeneration ?? 0) + 1,
      cursor: initialCursor,
      replay: null,
      pending: false,
      nextAt: 0,
      valid: true,
    };
    this.readers.set(windowId, row);
    return {
      token: row.token,
      readGeneration: row.readGeneration,
      cursor: initialCursor,
    };
  }
  descriptor(
    windowId: string,
  ): { token: string; readGeneration: number; cursor: number } | null {
    const row = this.readers.get(windowId);
    return row?.valid
      ? {
          token: row.token,
          readGeneration: row.readGeneration,
          cursor: row.cursor,
        }
      : null;
  }
  consume(windowId: string, cursor: number): void {
    const row = this.readers.get(windowId);
    if (!row?.valid || row.cursor !== cursor) throw new Error("INPUT_INVALID");
    row.replay = null;
  }
  close(windowId: string): void {
    const row = this.readers.get(windowId);
    if (row) row.valid = false;
    this.readers.delete(windowId);
  }
  invalidate(): void {
    for (const row of this.readers.values()) row.valid = false;
    this.readers.clear();
  }
  async next(
    token: string,
    readGeneration: number,
    cursor: number,
  ): Promise<ExecutionFrame> {
    const entry = [...this.readers].find(([, row]) => row.token === token),
      row = entry?.[1];
    if (
      !row ||
      row.readGeneration !== readGeneration ||
      row.epoch !== this.gateway.epoch ||
      !row.valid
    )
      throw new Error("TOKEN_EXPIRED");
    const windowId = entry![0];
    this.checkWindow(windowId);
    if (row.pending) throw new Error("REQUEST_BUSY");
    if (cursor !== row.cursor && cursor !== row.replay?.cursor)
      throw new Error("INPUT_INVALID");
    if (performance.now() < row.nextAt) return { status: "waiting" };
    row.pending = true;
    try {
      const replay = row.replay?.cursor === cursor ? row.replay.batch : null;
      const batch =
        replay ??
        executionOutputSchema.parse(
          await this.gateway.request(
            this.readRequest(row.serverId, row.generation, row.id, cursor),
          ),
        );
      if (!row.valid || this.readers.get(windowId) !== row)
        throw new Error("TOKEN_EXPIRED");
      this.checkWindow(windowId);
      if (
        batch.nextOffset < cursor ||
        (batch.frames[0] &&
          (batch.frames[0].offset < cursor ||
            (!batch.gap && batch.frames[0].offset !== cursor)))
      )
        throw new Error("INPUT_INVALID");
      // Only a consumed cursor releases the previous32KiB replay. Polling an
      // empty end must fetch again because the producer can append later.
      if (batch.nextOffset > cursor) {
        row.cursor = batch.nextOffset;
        row.replay = { cursor, batch };
      } else row.replay = null;
      const bytes = batch.frames.reduce(
        (sum, frame) => sum + frame.bytes.length,
        0,
      );
      row.nextAt = performance.now() + Math.max(20, (bytes * 1000) / 1024 ** 2);
      return { status: "data", batch: structuredClone(batch) };
    } finally {
      row.pending = false;
    }
  }
}
