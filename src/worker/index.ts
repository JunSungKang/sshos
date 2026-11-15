import { Client } from 'ssh2';
import { z } from 'zod';
import { SessionManager } from './connection/session-manager';
import { engineRequestSchema, type EngineRequest, type EngineEvent } from '../shared/engine-protocol';
import { FileBrowser } from './files/browser';
import { FileMutations } from './files/mutations';
import { PathLocks } from './files/path-locks';
import { ViewerReader } from './viewers/reader';
import { WorkerReceiptWriter } from './receipt-writer';
import { TransferCoordinator } from './transfers/coordinator';
import { WorkerStorageRecovery } from './storage-recovery';
import { TransferInspector } from './transfers/inspect';

const epoch = z.uuid().parse(process.argv[2]);
if (!process.parentPort) throw new Error('Utility process parent port required');
// Loading the SSH implementation proves runtime linkage without connecting anywhere.
if (typeof Client !== 'function') throw new Error('SSH implementation unavailable');
process.parentPort.postMessage({ type: 'ready', backendEpoch: epoch, sshLibrary: 'ssh2' });
let transfers:TransferCoordinator|null=null;
const receiptWriter=new WorkerReceiptWriter(epoch,message => process.parentPort?.postMessage(message),() => transfers?.storageFault());
let sequence = 0;
let readers:ViewerReader|null=null;
const sessions = new SessionManager(snapshot => {
  transfers?.sessionChanged(snapshot.serverId,snapshot.generation,snapshot.status === 'connected');
  readers?.sessionChanged(snapshot.serverId,snapshot.generation,snapshot.status === 'connected');
  process.parentPort?.postMessage({ type: 'session', backendEpoch: epoch, sequence: ++sequence, snapshot });
});
readers=new ViewerReader((serverId,generation) => sessions.readClient(serverId,generation));
const files = new FileBrowser((serverId, generation) => sessions.control(serverId, generation));
const locks=new PathLocks();
let transferSequence=0;
transfers=new TransferCoordinator(epoch,sessions,locks,receiptWriter,snapshot => process.parentPort?.postMessage({type:'transfer',backendEpoch:epoch,sequence:++transferSequence,snapshot}));
const recovery=new WorkerStorageRecovery(epoch,receiptWriter,transfers,message=>process.parentPort?.postMessage(message));
const transferInspector=new TransferInspector((serverId,generation) => sessions.control(serverId,generation,true));
const mutations=new FileMutations((serverId,generation) => sessions.control(serverId,generation,true),locks);
const inFlight = new Map<string, Promise<EngineEvent>>();
const completed = new Map<string, EngineEvent>();
async function execute(request: EngineRequest): Promise<EngineEvent> {
  try {
    let result: unknown;
    if (request.action === 'session:connect') result = await sessions.connect(request.serverId, request.generation, request.payload);
    else if (request.action === 'session:disconnect') sessions.disconnect(request.serverId, request.generation);
    else if (request.action === 'session:snapshot') result = sessions.snapshots();
    else if (request.action === 'session:confirmOS') sessions.confirmOS(request.serverId, request.generation);
    else if (request.action === 'file:list') result = await sessions.withMetadata(request.serverId,request.generation,()=>files.list(request.serverId, request.generation, request.browserId, request.path));
    else if (request.action === 'file:page') result = files.page(request.serverId, request.generation, request.browserId, request.offset, request.snapshotId);
    else if (request.action === 'file:close') files.close(request.browserId);
    else if (request.action === 'mutation:inspect') result=await sessions.withMetadata(request.serverId,request.generation,()=>mutations.inspect(request.serverId,request.generation,request.spec));
    else if (request.action === 'mutation:prepare') result=await sessions.withMetadata(request.serverId,request.generation,()=>mutations.prepare(request.serverId,request.generation,request.taskId,request.spec,request.expected));
    else if (request.action === 'mutation:step') result=await sessions.withMetadata(request.serverId,request.generation,()=>mutations.step(request.serverId,request.generation,request.taskId,request.stage));
    else if (request.action === 'mutation:finish') mutations.finish(request.taskId,request.keepRestriction);
    else if (request.action === 'viewer:open') readers!.open(request);
    else if (request.action === 'viewer:next') result=await readers!.next(request.serverId,request.generation,request.viewerId,request.readGeneration,request.sequence);
    else if (request.action === 'viewer:cancel') readers!.close(request.serverId,request.generation,request.viewerId,request.readGeneration);
    else if (request.action === 'transfer:inspect') result=await sessions.withMetadata(request.serverId,request.generation,()=>transferInspector.inspect(request.serverId,request.generation,request.direction,request.path,request.parent));
    else if (request.action === 'transfer:reserve') transfers!.reserve(request.serverId,request.generation,request.reservationToken,request.count);
    else if (request.action === 'transfer:stage') transfers!.stage(request.serverId,request.generation,request.reservationToken,request.index,request.spec);
    else if (request.action === 'transfer:commit') result=transfers!.commit(request.serverId,request.generation,request.reservationToken);
    else if (request.action === 'transfer:release') transfers!.release(request.serverId,request.generation,request.reservationToken);
    else if (request.action === 'transfer:cancel') result=await transfers!.cancel(request.serverId,request.generation,request.taskId);
    else if (request.action === 'transfer:snapshot') result={...transfers!.snapshot(request.serverId,request.generation,request.offset),sequence:transferSequence};
    else transfers!.acknowledge(request.serverId,request.generation,request.taskId);
    return { type: 'response', requestId: request.requestId, backendEpoch: epoch, serverId: request.serverId, generation: request.generation, ok: true, result };
  } catch (error) {
    const errorCode = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INTERNAL_ERROR';
    return { type: 'response', requestId: request.requestId, backendEpoch: epoch, serverId: request.serverId, generation: request.generation, ok: false, errorCode };
  }
}
process.parentPort.on('message', (event: { data: unknown }) => {
  if (receiptWriter.accept(event.data) || recovery.accept(event.data)) return;
  const parsed = engineRequestSchema.safeParse(event.data);
  if (!parsed.success || parsed.data.backendEpoch !== epoch) return;
  const request = parsed.data;
  const cached = completed.get(request.requestId);
  if (cached) { if (cached.type === 'response' && cached.serverId === request.serverId && cached.generation === request.generation) process.parentPort?.postMessage(cached); return; }
  let work = inFlight.get(request.requestId);
  if (!work) {
    if (inFlight.size >= 32) { process.parentPort?.postMessage({ type: 'response', requestId: request.requestId, backendEpoch: epoch, serverId: request.serverId, generation: request.generation, ok: false, errorCode: 'REQUEST_BUSY' }); return; }
    work = execute(request); inFlight.set(request.requestId, work);
    void work.then(result => {
      inFlight.delete(request.requestId);
      // Viewer bytes have their own one-chunk sequence replay buffer. Never put
      // file content into the generic RPC completion/snapshot cache.
      if (request.action !== 'viewer:next') completed.set(request.requestId, result);
      while (completed.size > 200) completed.delete(completed.keys().next().value!);
    });
  }
  void work.then(result => { if (result.type === 'response' && result.serverId === request.serverId && result.generation === request.generation) process.parentPort?.postMessage(result); });
});
process.on('exit', () => sessions.closeAll());
