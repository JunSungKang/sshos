import { describe,expect,it } from 'vitest';
import { TransferCoordinator } from '../../src/worker/transfers/coordinator';
import { PathLocks } from '../../src/worker/files/path-locks';
import type { SessionManager } from '../../src/worker/connection/session-manager';
import type { WorkerReceiptWriter } from '../../src/worker/receipt-writer';
import type { TransferLive } from '../../src/worker/transfers/runner';
import type { StagedTransfer,TransferRuntime } from '../../src/shared/transfer-protocol';
import type { FileReceipt } from '../../src/shared/receipts';
import type { TransferPhase } from '../../src/shared/transfers';
import { transferReceipt } from '../fixtures/transfers';
const tick=async () => {for (let i=0;i<30;i++) await Promise.resolve();};
function fixture() {
  const epoch=crypto.randomUUID();let fault=false;const emitted:TransferRuntime[]=[],saved:FileReceipt[]=[],started:string[]=[];const runners=new Map<string,{finish(phase?:TransferPhase,closed?:boolean):void}>();
  const writer={get faulted(){return fault;},persist:async (row:FileReceipt) => {if (fault) throw new Error('STORAGE_FAILED');saved.push(structuredClone(row));}} as Pick<WorkerReceiptWriter,'faulted'|'persist'>;
  const sessions={control:() => ({check:() => {}})} as unknown as Pick<SessionManager,'control'|'auxiliary'>;
  const coordinator=new TransferCoordinator(epoch,sessions,new PathLocks(),writer,row => emitted.push(row),(spec,hooks) => {
    let live:TransferLive={...spec.row,recordError:false,bytesPerSecond:null};let finish!:(value:{snapshot:TransferLive;resourcesClosed:boolean})=>void;const gate=new Promise<{snapshot:TransferLive;resourcesClosed:boolean}>(resolve => {finish=resolve;});
    const done=(phase:TransferPhase='completed',closed=true) => {live={...live,phase,recordError:fault,cleanupState:phase === 'result_unknown' ? 'unknown' : 'confirmed',...(phase === 'completed' ? {destinationCreated:true,transferredBytes:live.totalBytes,verifiedBytes:live.totalBytes} : {})};finish({snapshot:live,resourcesClosed:closed});};runners.set(spec.row.taskId,{finish:done});
    return {snapshot:() => live,cancel:() => {live={...live,phase:'cancel_requested'};return live.phase;},interrupt:() => done('interrupted'),run:async () => {started.push(spec.row.taskId);live={...live,phase:'preparing'};hooks.update(live);const {recordError:_error,bytesPerSecond:_speed,...receipt}=live;await hooks.persist(receipt);return gate;}};
  });
  const spec=(serverId:string):StagedTransfer => {const row=transferReceipt();row.serverId=serverId;row.backendEpoch=epoch;row.source+='-'+row.taskId;row.destination+='-'+row.taskId;return {row,localDirectory:{path:row.localParent,identity:'1:2'}};};
  const enqueue=(serverId:string,rows:StagedTransfer[]) => {const token=crypto.randomUUID();coordinator.reserve(serverId,1,token,rows.length);rows.forEach((row,index) => coordinator.stage(serverId,1,token,index,row));coordinator.commit(serverId,1,token);return token;};
  return {coordinator,emitted,saved,started,runners,spec,enqueue,setFault:() => {fault=true;coordinator.storageFault();}};
}
describe('transfer coordinator queue and resource ownership',() => {
  it('runs at most2 tasks with1 per-server and starts the oldest eligible queued task',async () => {
    const f=fixture(),a=crypto.randomUUID(),b=crypto.randomUUID(),c=crypto.randomUUID();const a1=f.spec(a),a2=f.spec(a),b1=f.spec(b),c1=f.spec(c);
    f.enqueue(a,[a1,a2]);f.enqueue(b,[b1]);f.enqueue(c,[c1]);await tick();expect(f.started).toEqual([a1.row.taskId,b1.row.taskId]);f.runners.get(a1.row.taskId)!.finish();await tick();expect(f.started).toEqual([a1.row.taskId,b1.row.taskId,a2.row.taskId]);
    f.runners.get(b1.row.taskId)!.finish();await tick();expect(f.started.at(-1)).toBe(c1.row.taskId);
  });
  it('does not launch a partially staged batch and binds reservation/server/generation/path authority',() => {
    const f=fixture(),serverId=crypto.randomUUID(),token=crypto.randomUUID(),row=f.spec(serverId);f.coordinator.reserve(serverId,1,token,2);f.coordinator.stage(serverId,1,token,0,row);
    expect(() => f.coordinator.commit(serverId,1,token)).toThrow('INPUT_INVALID');expect(f.started).toEqual([]);expect(() => f.coordinator.stage(serverId,2,token,1,row)).toThrow('TOKEN_EXPIRED');
    const second=f.spec(serverId);expect(() => f.coordinator.stage(serverId,1,token,1,{...second,localDirectory:{...second.localDirectory,path:'/unapproved'}})).toThrow('INPUT_INVALID');f.coordinator.release(serverId,1,token);expect(() => f.coordinator.commit(serverId,1,token)).toThrow('TOKEN_EXPIRED');
  });
  it('cancels queued tasks without creating a runner and delegates active cancellation',async () => {
    const f=fixture(),server=crypto.randomUUID(),first=f.spec(server),queued=f.spec(server);f.enqueue(server,[first,queued]);await tick();expect(await f.coordinator.cancel(server,1,queued.row.taskId)).toBe('cancelled');expect(f.started).toEqual([first.row.taskId]);expect(f.saved.find(row => row.taskId === queued.row.taskId)?.phase).toBe('cancelled');expect(await f.coordinator.cancel(server,1,first.row.taskId)).toBe('cancel_requested');
  });
  it('retains a slot when closure is unconfirmed and retains unknown paths until acknowledged',async () => {
    const f=fixture(),server=crypto.randomUUID(),first=f.spec(server),queued=f.spec(server);f.enqueue(server,[first,queued]);await tick();f.runners.get(first.row.taskId)!.finish('completed',false);await tick();expect(f.started).toHaveLength(1);expect(f.coordinator.snapshot(server,1).rows.find(row => row.taskId === first.row.taskId)).toMatchObject({active:true,slotOccupied:true,cleanupPending:true});
    const g=fixture(),id=crypto.randomUUID(),unknown=g.spec(id),next=g.spec(id);next.row.source=unknown.row.source;next.row.destination=unknown.row.destination;g.enqueue(id,[unknown,next]);await tick();g.runners.get(unknown.row.taskId)!.finish('result_unknown');await tick();expect(g.started).toHaveLength(1);expect(() => g.coordinator.acknowledge(id,2,unknown.row.taskId)).toThrow('TOKEN_EXPIRED');g.coordinator.acknowledge(id,1,unknown.row.taskId);await tick();expect(g.started).toHaveLength(2);
  });
  it('interrupts only the disconnected generation and prevents queued replay after a storage fault',async () => {
    const f=fixture(),a=crypto.randomUUID(),b=crypto.randomUUID(),a1=f.spec(a),a2=f.spec(a),b1=f.spec(b);f.enqueue(a,[a1,a2]);f.enqueue(b,[b1]);await tick();f.coordinator.sessionChanged(a,1,false);await tick();await f.coordinator.settled();expect(f.started).not.toContain(a2.row.taskId);expect(f.coordinator.snapshot(b,1).rows[0]?.active).toBe(true);expect(f.saved.find(row => row.taskId === a2.row.taskId)?.phase).toBe('interrupted');
    const g=fixture(),server=crypto.randomUUID(),first=g.spec(server),queued=g.spec(server);g.enqueue(server,[first,queued]);await tick();g.setFault();await tick();await g.coordinator.settled();expect(g.started).toEqual([first.row.taskId]);expect(g.coordinator.snapshot(server,1).rows.find(row => row.taskId === queued.row.taskId)).toMatchObject({phase:'interrupted',recordError:true,active:false});
  });
});
