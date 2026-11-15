import { randomUUID } from 'node:crypto';
import type { UtilityProcess } from 'electron';
import { engineEventSchema, engineRequestSchema, type EngineCommand } from '../shared/engine-protocol';
import { sessionSnapshotSchema, type SessionSnapshot } from '../shared/session-contracts';
import type { TransferRuntime } from '../shared/transfer-protocol';

export class EngineGateway {
  private readonly pending = new Map<string, { serverId: string; generation: number; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private stopped = false;
  private lastSequence = 0;
  private lastTransferSequence=0;
  constructor(private readonly worker: UtilityProcess, readonly epoch: string, private readonly sessionChanged: (snapshot: SessionSnapshot) => void,private readonly receiptChannel?:{accept(raw:unknown):boolean},private readonly transferChanged?:(snapshot:TransferRuntime,gap:boolean,sequence:number)=>void) {
    worker.on('message', (raw: unknown) => {
      if (this.receiptChannel?.accept(raw)) return;
      const event = engineEventSchema.safeParse(raw); if (!event.success || event.data.backendEpoch !== epoch) return;
      const data = event.data;
      if (data.type === 'transfer') {if (data.sequence<=this.lastTransferSequence) return;const gap=data.sequence !== this.lastTransferSequence+1;this.lastTransferSequence=data.sequence;this.transferChanged?.(data.snapshot,gap,data.sequence);return;}
      if (data.type === 'session') {
        if (data.sequence <= this.lastSequence) return;
        const gap = data.sequence !== this.lastSequence + 1;
        this.lastSequence = data.sequence; sessionChanged(data.snapshot);
        if (gap) void this.request({ action: 'session:snapshot', serverId: data.snapshot.serverId, generation: data.snapshot.generation }).then(result => {
          for (const snapshot of sessionSnapshotSchema.array().max(10).parse(result)) sessionChanged(snapshot);
        }).catch(() => {});
        return;
      }
      const pending = this.pending.get(data.requestId);
      if (!pending || pending.serverId !== data.serverId || pending.generation !== data.generation) return;
      this.pending.delete(data.requestId); clearTimeout(pending.timer);
      if (data.ok) pending.resolve(data.result); else pending.reject(new Error(data.errorCode ?? 'INTERNAL_ERROR'));
    });
    worker.on('exit', () => {
      this.stopped = true;
      for (const value of this.pending.values()) { clearTimeout(value.timer); value.reject(new Error('ENGINE_STOPPED')); }
      this.pending.clear();
    });
  }
  request(request: EngineCommand): Promise<unknown> {
    if (this.stopped || this.pending.size >= 32) return Promise.reject(new Error('ENGINE_STOPPED'));
    const message = engineRequestSchema.parse({ ...request, requestId: randomUUID(), backendEpoch: this.epoch });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(message.requestId); reject(new Error('IO_TIMEOUT')); }, 90000);
      this.pending.set(message.requestId, { serverId: message.serverId, generation: message.generation, timer, resolve, reject });
      try { this.worker.postMessage(message); }
      catch { this.pending.delete(message.requestId); clearTimeout(timer); reject(new Error('ENGINE_STOPPED')); }
    });
  }
}
