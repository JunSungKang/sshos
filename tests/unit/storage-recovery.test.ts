import { describe,expect,it,vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { WorkerStorageRecovery } from '../../src/worker/storage-recovery';
import { MainStorageRecovery } from '../../src/main/storage-recovery';
import { WorkerReceiptWriter } from '../../src/worker/receipt-writer';
import type { RecoveryResponse } from '../../src/shared/storage-recovery';
import { transferReceipt } from '../fixtures/transfers';
function fixture(){const epoch=crypto.randomUUID(),port=new EventEmitter() as EventEmitter & {postMessage(raw:unknown):void};const output:RecoveryResponse[]=[];let quiet=true,finish!:()=>void;const gate=new Promise<void>(done=>{finish=done;});let stopped=0;const writer=new WorkerReceiptWriter(epoch,()=>{});const transfers={quiescent:()=>quiet,storageFault:()=>{stopped++;},settled:()=>gate};const worker=new WorkerStorageRecovery(epoch,writer,transfers,reply=>{output.push(reply);port.emit('message',reply);});port.postMessage=raw=>{worker.accept(raw);};const main=new MainStorageRecovery(epoch,port);return {epoch,writer,main,worker,output,finish,transfers,port,quiet:()=>{quiet=true;},active:()=>{quiet=false;},stopped:()=>stopped};}
describe('explicit storage recovery barrier',()=>{
 it('waits for settlement, pauses dispatch and requires the exact single-use barrier token',async()=>{
   const f=fixture();const waiting=f.main.barrier(false);await Promise.resolve();expect(f.output).toEqual([]);f.finish();const token=await waiting;expect(f.writer.faulted).toBe(true);const row=transferReceipt();row.backendEpoch=f.epoch;await expect(f.writer.persist(row)).rejects.toThrow('STORAGE_FAILED');await expect(f.main.reset(crypto.randomUUID())).rejects.toThrow('TOKEN_EXPIRED');expect(f.writer.faulted).toBe(true);await f.main.reset(token);expect(f.writer.faulted).toBe(false);await expect(f.main.reset(token)).rejects.toThrow('TOKEN_EXPIRED');
 });
 it('refuses to disturb healthy active work and force-quiesces only a fault recovery',async()=>{
   const f=fixture();f.active();await expect(f.main.barrier(false)).rejects.toThrow('REQUEST_BUSY');expect(f.stopped()).toBe(0);expect(f.writer.faulted).toBe(false);const waiting=f.main.barrier(true);await vi.waitFor(()=>expect(f.stopped()).toBe(1));expect(f.writer.faulted).toBe(true);f.quiet();f.finish();const token=await waiting;await f.main.reset(token);expect(f.writer.faulted).toBe(false);
 });
 it('ignores foreign epochs and rejects concurrent requests or worker exit',async()=>{
   const f=fixture();expect(f.worker.accept({action:'storage:barrier',backendEpoch:crypto.randomUUID(),requestId:crypto.randomUUID(),faulted:true})).toBe(true);expect(f.output).toEqual([]);const waiting=f.main.barrier(false);await expect(f.main.barrier(false)).rejects.toThrow('REQUEST_BUSY');f.port.emit('exit',0);await expect(waiting).rejects.toThrow('ENGINE_STOPPED');await expect(f.main.barrier(false)).rejects.toThrow('ENGINE_STOPPED');f.finish();
 });
});
