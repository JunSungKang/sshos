import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { z } from 'zod';

const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), privatePEM: z.string().min(1).max(512 * 1024), publicSSH: z.string().min(1).max(64 * 1024) }).strict(),
  z.object({ ok: z.literal(false), code: z.enum(['KEY_INVALID', 'AUTH_UNSUPPORTED']) }).strict()
]);
export interface ParsedPrivateKey { privatePEM: string; publicSSH: string }

export class PrivateKeyParser {
  private pending=0;private tail:Promise<void>=Promise.resolve();
  async parse(bytes:Buffer,passphrase?:string,current:()=>boolean=()=>true):Promise<ParsedPrivateKey> {
    if(this.pending>=3 || bytes.length===0 || bytes.length>512*1024 || passphrase!==undefined && Buffer.byteLength(passphrase)>1024)throw new Error('KEY_INVALID');this.pending++;
    const operation=this.tail.then(()=>{if(!current())throw new Error('CONNECTION_LOST');return this.parseOne(bytes,passphrase);});this.tail=operation.then(()=>{},()=>{});try{return await operation;}finally{bytes.fill(0);this.pending--;}
  }
  private async parseOne(bytes: Buffer, passphrase?: string): Promise<ParsedPrivateKey> {
    if ( bytes.length === 0 || bytes.length > 512 * 1024 || (passphrase !== undefined && Buffer.byteLength(passphrase) > 1024)) throw new Error('KEY_INVALID');
    let worker: Worker | undefined;
    try {
      worker = new Worker(resolve(__dirname, 'key-parser-thread.js'), { workerData: { bytes, passphrase } });
      const running = worker;
      return await new Promise<ParsedPrivateKey>((resolveResult, reject) => {
        let settled = false;
        const finish = (error: Error | null, value?: ParsedPrivateKey) => {
          if (settled) return; settled = true; clearTimeout(timer);
          if (error || !value) reject(error ?? new Error('KEY_INVALID')); else resolveResult(value);
        };
        const timer = setTimeout(() => finish(new Error('KEY_INVALID')), 5000);
        running.on('message', (raw: unknown) => {
          const parsed = resultSchema.safeParse(raw);
          if (!parsed.success) { finish(new Error('KEY_INVALID')); return; }
          if (!parsed.data.ok) { finish(new Error(parsed.data.code)); return; }
          finish(null, { privatePEM: parsed.data.privatePEM, publicSSH: parsed.data.publicSSH });
        });
        running.on('error', () => finish(new Error('KEY_INVALID')));
        running.on('exit', () => finish(new Error('KEY_INVALID')));
      });
    } finally { if (worker) await worker.terminate(); }
  }
}
