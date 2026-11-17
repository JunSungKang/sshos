import { randomUUID } from "node:crypto";
import {
  recoveryResponseSchema,
  type RecoveryResponse,
  type RecoveryRequest,
  type ExecutionRecoveryUncertainty,
} from "../../shared/storage-recovery";
type Port = {
  postMessage(message: unknown): void;
  on(name: "message" | "exit", callback: (message: unknown) => void): unknown;
};
export class MainStorageRecovery {
  private pending: {
    id: string;
    resolve: (reply: RecoveryResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private stopped = false;
  constructor(
    private readonly epoch: string,
    private readonly worker: Port,
  ) {
    worker.on("message", (raw) => {
      const result = recoveryResponseSchema.safeParse(raw);
      if (
        !result.success ||
        result.data.backendEpoch !== epoch ||
        result.data.requestId !== this.pending?.id
      )
        return;
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      if (result.data.ok) pending.resolve(result.data);
      else pending.reject(new Error(result.data.errorCode ?? "STORAGE_FAILED"));
    });
    worker.on("exit", () => {
      this.stopped = true;
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.reject(new Error("ENGINE_STOPPED"));
        this.pending = null;
      }
    });
  }
  private request(
    input:
      | { action: "storage:barrier"; faulted: boolean }
      | {
          action: "storage:reset";
          barrierToken: string;
          uncertainExecutions: ExecutionRecoveryUncertainty[];
        },
  ): Promise<RecoveryResponse> {
    if (this.pending) return Promise.reject(new Error("REQUEST_BUSY"));
    if (this.stopped) return Promise.reject(new Error("ENGINE_STOPPED"));
    const request: RecoveryRequest = {
      ...input,
      requestId: randomUUID(),
      backendEpoch: this.epoch,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error("STORAGE_FAILED"));
      }, 7500);
      this.pending = { id: request.requestId, resolve, reject, timer };
      try {
        this.worker.postMessage(request);
      } catch {
        clearTimeout(timer);
        this.pending = null;
        reject(new Error("ENGINE_STOPPED"));
      }
    });
  }
  async barrier(faulted: boolean): Promise<string> {
    const reply = await this.request({ action: "storage:barrier", faulted });
    if (!reply.barrierToken) throw new Error("STORAGE_FAILED");
    return reply.barrierToken;
  }
  async reset(
    barrierToken: string,
    uncertainExecutions: ExecutionRecoveryUncertainty[] = [],
  ): Promise<void> {
    await this.request({
      action: "storage:reset",
      barrierToken,
      uncertainExecutions,
    });
  }
}
