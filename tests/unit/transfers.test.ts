import { describe,expect,it } from 'vitest';
import { createHash } from 'node:crypto';
import { TransferQueue,type QueuedTransfer } from '../../src/worker/transfers/queue';
import { TransferState } from '../../src/shared/transfer-state';
import { TransferRate } from '../../src/worker/transfers/progress';
import { copyAndHash,hashReadBack,readTransferBlock,type IOObserver,type ReadPort } from '../../src/worker/transfers/io';
import { PathLocks } from '../../src/worker/files/path-locks';
import { MAX_TRANSFER_BYTES,TRANSFER_CHUNK_BYTES,recoverTransfer,type TransferReceipt } from '../../src/shared/transfers';
const observer=():IOObserver & {transferred:number;verified:number} => ({transferred:0,verified:0,check:() => {},activity:() => {},progress(kind,bytes){if (kind === 'transferred') this.transferred+=bytes;else this.verified+=bytes;}});
function memorySource(data:Buffer,short=TRANSFER_CHUNK_BYTES):ReadPort {
  return {read:async (buffer,offset,length,position) => {const size=Math.max(0,Math.min(length,short,data.length-position));if (size) data.copy(buffer,offset,position,position+size);return size;}};
}
function task(serverId:string,name:string):QueuedTransfer {return {taskId:name,serverId,generation:1,remoteClaims:[{path:'/home/'+name,mode:'write'},{path:'/home',mode:'keep'}],localClaims:[{path:'/local/'+name,mode:'write'}]};}
describe('transfer state and queue',() => {
  it('locks cancellation before awaiting the durable finalization intent and forbids terminal replay',() => {
    const state=new TransferState();state.move('preparing');state.move('transferring');state.move('verifying');state.move('finalize_intent_pending');expect(() => state.cancel()).toThrow('CANCEL_TOO_LATE');state.move('finalizing');state.move('completed');expect(() => state.move('preparing')).toThrow('INPUT_INVALID');
    const cancelled=new TransferState();cancelled.move('preparing');cancelled.move('transferring');expect(cancelled.cancel()).toBe('cancel_requested');expect(() => cancelled.move('finalize_intent_pending')).toThrow('INPUT_INVALID');cancelled.move('cancelled');
  });
  it('reserves whole batches, skips a blocked server, and retains unknown-path restrictions',() => {
    const locks=new PathLocks();const queue=new TransferQueue(locks);queue.reserve('batch',4);queue.commit('batch',[task('A','a'),task('A','b'),task('B','c'),task('C','d')]);
    expect(queue.take()?.taskId).toBe('a');expect(queue.take()?.taskId).toBe('c');expect(queue.take()).toBeNull();queue.finish('a',true);
    // Different children can proceed although an unknown sibling remains locked.
    expect(queue.take()?.taskId).toBe('b');queue.finish('b',false);queue.finish('c',false);
    queue.reserve('blocked',1);const overlap=task('A','e');overlap.remoteClaims=[{path:'/home/a',mode:'write'}];queue.commit('blocked',[overlap]);
    expect(queue.take()?.taskId).toBe('d');expect(queue.take()).toBeNull();queue.acknowledge('a');expect(queue.take()?.taskId).toBe('e');
    const full=new TransferQueue(new PathLocks());full.reserve('one',60);expect(() => full.reserve('two',41)).toThrow('TASK_LIMIT');full.reserve('two',40);expect(() => full.commit('one',[task('A','x')])).toThrow('INPUT_INVALID');full.releaseReservation('one');full.reserve('three',60);
  });
  it('does not let another server bypass an active local destination lock',() => {
    const queue=new TransferQueue(new PathLocks());const first=task('A','a'),second=task('B','b');second.localClaims=first.localClaims;
    queue.reserve('batch',2);queue.commit('batch',[first,second]);expect(queue.take()?.taskId).toBe('a');expect(queue.take()).toBeNull();queue.finish('a',false);expect(queue.take()?.taskId).toBe('b');
  });
  it('restores finalizing and backup receipts as unknown without auto-execution',() => {
    const initial={phase:'queued',stage:'queued',tempCreated:false,cleanupState:'none',recoveryUncertain:false} as TransferReceipt;
    expect(recoverTransfer(initial,false).phase).toBe('interrupted');expect(recoverTransfer({...initial,phase:'verifying',tempCreated:true},false)).toMatchObject({phase:'interrupted',cleanupState:'needed'});
    expect(recoverTransfer({...initial,phase:'finalizing'},false).phase).toBe('result_unknown');expect(recoverTransfer({...initial,phase:'completed'},true)).toMatchObject({phase:'result_unknown',recoveryUncertain:true});
    expect(recoverTransfer({...initial,phase:'preparing',stage:'temp_create_intent'},false).phase).toBe('result_unknown');
  });
});
describe('bounded transfer byte engine',() => {
  it.each(['upload','download'] as const)('copies and hashes short reads/writes in order for %s',async direction => {
    const source=Buffer.from('한글 and bytes\n'.repeat(7000));const output=Buffer.alloc(source.length);const status=observer();
    const digest=await copyAndHash(direction,memorySource(source,113),{write:async (bytes,offset,length,position) => {const count=Math.min(length,257);bytes.copy(output,position,offset,offset+count);return count;}},source.length,status);
    expect(output).toEqual(source);expect(digest).toBe(createHash('sha256').update(source).digest('hex'));expect(status.transferred).toBe(source.length);
    expect(await hashReadBack(memorySource(output,173),output.length,status)).toBe(digest);expect(status.verified).toBe(output.length);
  });
  it('limits upload writes and download reads to16 outstanding32KiB buffers',async () => {
    const source=Buffer.alloc(2*1024*1024,67);let active=0,peak=0;const delayed=async <T>(action:()=>T) => {active++;peak=Math.max(peak,active);await new Promise(resolve => setImmediate(resolve));try {return action();} finally {active--;}};
    await copyAndHash('upload',memorySource(source),{write:async (_bytes,_offset,length) => {expect(length).toBeLessThanOrEqual(32768);return delayed(() => length);}},source.length,observer());expect(peak).toBe(16);peak=0;
    const read=memorySource(source);await copyAndHash('download',{read:(bytes,offset,length,position) => {expect(length).toBeLessThanOrEqual(32768);return delayed(() => read.read(bytes,offset,length,position));}},{write:async (_bytes,_offset,length) => length},source.length,observer());expect(peak).toBe(16);
  });
  it('validates empty files, unexpected EOF/growth, zero writes and cancellation',async () => {
    const empty=createHash('sha256').digest('hex');expect(await copyAndHash('upload',memorySource(Buffer.alloc(0)),{write:async () => {throw new Error('Unexpected write');}},0,observer())).toBe(empty);
    await expect(copyAndHash('download',memorySource(Buffer.from('ab')),{write:async (_b,_o,length) => length},3,observer())).rejects.toThrow('SOURCE_CHANGED');
    await expect(copyAndHash('upload',memorySource(Buffer.from('ab')),{write:async (_b,_o,length) => length},1,observer())).rejects.toThrow('SOURCE_CHANGED');
    await expect(copyAndHash('upload',memorySource(Buffer.from('a')),{write:async () => 0},1,observer())).rejects.toThrow('IO_FAILED');
    const status=observer();status.check=() => {throw new Error('REQUEST_CANCELLED');};await expect(hashReadBack(memorySource(Buffer.from('a')),1,status)).rejects.toThrow('REQUEST_CANCELLED');
  });
  it('preserves offsets beyond4GiB and rejects64GiB overflow before dispatch',async () => {
    const positions:number[]=[];const offset=2**32+37;const read:ReadPort={read:async (bytes,start,length,position) => {positions.push(position);bytes.fill(65,start,start+length);return length;}};
    expect(await readTransferBlock(read,offset,7,observer())).toEqual(Buffer.from('AAAAAAA'));expect(positions).toEqual([offset]);
    await expect(readTransferBlock(read,MAX_TRANSFER_BYTES,1,observer())).rejects.toThrow('FILE_LIMIT');await expect(copyAndHash('download',read,{write:async () => 1},MAX_TRANSFER_BYTES+1,observer())).rejects.toThrow('FILE_LIMIT');
  });
  it('reports transfer and verification speed separately and expires stalled samples',() => {
    const rate=new TransferRate(0);expect(rate.value(100)).toBeNull();rate.add(1000,1000);expect(rate.value(1000)).toBe(1000);rate.add(2000,2000);expect(rate.value(2000)).toBe(1500);expect(rate.value(5000)).toBeNull();rate.reset(5000);expect(rate.value(5001)).toBeNull();rate.add(500,5500);expect(rate.value(5500)).toBe(1000);expect(rate.value(5499)).toBeNull();
  });
});


it('validates whole queue reservations and isolates generation snapshots/cancellation copies',()=>{const queue=new TransferQueue(new PathLocks());for(const count of [0,-1,101,1.5,NaN])expect(()=>queue.reserve('bad',count)).toThrow('INPUT_INVALID');queue.reserve('batch',2);expect(()=>queue.reserve('batch',1)).toThrow('INPUT_INVALID');expect(()=>queue.commit('batch',[task('A','duplicate'),task('B','duplicate')])).toThrow('INPUT_INVALID');const a=task('A','a'),b={...task('A','b'),generation:2};queue.commit('batch',[a,b]);const first=queue.queuedFor('A',1);expect(first.map(row=>row.taskId)).toEqual(['a']);first[0]!.remoteClaims[0]!.path='/changed';expect(queue.queuedFor('A',1)[0]!.remoteClaims[0]!.path).toBe('/home/a');expect(queue.cancelQueued('missing')).toBeNull();expect(queue.cancelQueued('b')?.generation).toBe(2);expect(queue.queuedCount).toBe(1);expect(()=>queue.finish('missing',false)).toThrow('INPUT_INVALID');queue.acknowledge('missing');expect(queue.take()?.taskId).toBe('a');queue.reserve('again',1);expect(()=>queue.commit('again',[a])).toThrow('INPUT_INVALID');queue.releaseReservation('again');queue.finish('a',true);queue.reserve('restricted',1);expect(()=>queue.commit('restricted',[a])).toThrow('INPUT_INVALID');queue.releaseReservation('restricted');queue.acknowledge('a');expect(queue.activeCount).toBe(0);});
