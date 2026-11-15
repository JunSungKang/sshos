import { afterEach,describe,expect,it,vi } from 'vitest';
import { mkdir,mkdtemp,rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MainReceiptChannel } from '../../src/main/receipt-channel';
import { WorkerReceiptWriter } from '../../src/worker/receipt-writer';
import { ReceiptRepository } from '../../src/main/persistence/receipts';
import type { ReceiptSave,ReceiptACK } from '../../src/shared/receipt-channel';
import { transferReceipt } from '../fixtures/transfers';
const owned:string[]=[];
afterEach(async () => {vi.useRealTimers();vi.restoreAllMocks();for (const path of owned.splice(0)) await rm(path,{recursive:true});});
const ack=(request:ReceiptSave,ok=true):ReceiptACK => ({action:'receipt:ack',requestId:request.requestId,backendEpoch:request.backendEpoch,serverId:request.serverId,generation:request.generation,sequence:request.sequence,ok});
async function fixture() {
  await mkdir(resolve('.local/tmp'),{recursive:true});const root=await mkdtemp(resolve('.local/tmp/receipt-channel-'));owned.push(root);const repo=await ReceiptRepository.open(root);const row=transferReceipt();await repo.save(row);return {repo,row};
}
describe('worker to main durable receipt channel',() => {
  it('acknowledges only durable registered records and deduplicates the same request',async () => {
    const f=await fixture();const writes=vi.spyOn(f.repo,'save');const requests:ReceiptSave[]=[];const main=new MainReceiptChannel(f.row.backendEpoch,() => f.repo,() => true,message => worker.accept(message));
    const worker=new WorkerReceiptWriter(f.row.backendEpoch,message => {if ((message as {type:string}).type === 'receipt:save') requests.push(message as ReceiptSave);queueMicrotask(() => main.accept(message));});
    await worker.persist({...f.row,phase:'preparing',stage:'preparing'});expect(f.repo.snapshots()[0]?.phase).toBe('preparing');expect(writes).toHaveBeenCalledTimes(1);main.accept(requests[0]);await main.settled();expect(writes).toHaveBeenCalledTimes(1);expect(worker.faulted).toBe(false);
    const replay={...requests[0]!,requestId:crypto.randomUUID()};main.accept(replay);await main.settled();expect(writes).toHaveBeenCalledTimes(1);
  });
  it('refuses unknown resources, changed task identity and mismatched generations without dispatch permission',async () => {
    for (const variation of ['unknown','path','generation'] as const) {
      const f=await fixture();const replies:ReceiptACK[]=[];const main=new MainReceiptChannel(f.row.backendEpoch,() => f.repo,() => true,message => replies.push(message as ReceiptACK));
      const receipt=variation === 'unknown' ? {...transferReceipt(),backendEpoch:f.row.backendEpoch} : variation === 'path' ? {...f.row,destination:'/home/altered'} : f.row;
      main.accept({type:'receipt:save',requestId:crypto.randomUUID(),backendEpoch:f.row.backendEpoch,serverId:receipt.serverId,generation:variation === 'generation' ? 2 : 1,sequence:1,receipt});await main.settled();
      expect(replies.at(-1)?.ok).toBe(false);expect(f.repo.faulted).toBe(true);expect(f.repo.snapshots()).toEqual([f.row]);
    }
  });
  it('does not accept a late ACK after5s fault or reuse sequence numbers after explicit verification reset',async () => {
    vi.useFakeTimers();const row=transferReceipt();const messages:unknown[]=[];const worker=new WorkerReceiptWriter(row.backendEpoch,message => messages.push(message));
    const pending=worker.persist(row);const rejected=expect(pending).rejects.toThrow('STORAGE_FAILED');expect(() => worker.resetAfterStorageVerification()).toThrow('REQUEST_BUSY');const first=messages[0] as ReceiptSave;
    await vi.advanceTimersByTimeAsync(5001);await rejected;worker.accept(ack(first));expect(worker.faulted).toBe(true);await expect(worker.persist(row)).rejects.toThrow('STORAGE_FAILED');
    worker.resetAfterStorageVerification();const next=worker.persist(row);const request=messages.at(-1) as ReceiptSave;expect(request.sequence).toBeGreaterThan(first.sequence);
    worker.accept({...ack(request),generation:2});worker.accept(ack(request));await next;expect(worker.faulted).toBe(false);
  });
  it('invalidates all pending permissions on one writer fault, even if another success ACK arrives later',async () => {
    const first=transferReceipt();const second={...transferReceipt(),backendEpoch:first.backendEpoch};const messages:unknown[]=[];const worker=new WorkerReceiptWriter(first.backendEpoch,message => messages.push(message));
    const one=worker.persist(first),two=worker.persist(second);const rejectedOne=expect(one).rejects.toThrow('STORAGE_FAILED'),rejectedTwo=expect(two).rejects.toThrow('STORAGE_FAILED');const requests=messages.slice() as ReceiptSave[];
    worker.accept(ack(requests[0]!,false));worker.accept(ack(requests[1]!));await Promise.all([rejectedOne,rejectedTwo]);expect(worker.faulted).toBe(true);
  });
  it('rejects oversized receipt and credential fields before sending a write request',async () => {
    for (const invalid of [{...transferReceipt(),password:'fixture-only'},{...transferReceipt(),source:'/'+ 'a'.repeat(32700)+'/source',localParent:'/'+ 'a'.repeat(32700)}]) {
      const messages:unknown[]=[];const worker=new WorkerReceiptWriter(invalid.backendEpoch,message => messages.push(message));await expect(worker.persist(invalid)).rejects.toThrow('STORAGE_FAILED');expect(messages).toEqual([{type:'receipt:fault',backendEpoch:invalid.backendEpoch,errorCode:'STORAGE_FAILED'}]);
    }
  });
  it('withholds permission if another storage fault occurs before the durable ACK is released',async () => {
    const f=await fixture();let healthy=true;const original=f.repo.save.bind(f.repo);vi.spyOn(f.repo,'save').mockImplementation(async row => {await original(row);healthy=false;});const replies:ReceiptACK[]=[];
    const main=new MainReceiptChannel(f.row.backendEpoch,() => f.repo,() => healthy,message => replies.push(message as ReceiptACK));main.accept({type:'receipt:save',requestId:crypto.randomUUID(),backendEpoch:f.row.backendEpoch,serverId:f.row.serverId,generation:1,sequence:1,receipt:{...f.row,phase:'preparing',stage:'preparing'}});await main.settled();
    expect(f.repo.snapshots()[0]?.phase).toBe('preparing');expect(replies.at(-1)?.ok).toBe(false);expect(f.repo.faulted).toBe(true);
  });
});
