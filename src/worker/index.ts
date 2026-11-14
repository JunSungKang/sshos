import { Client } from 'ssh2';
import { z } from 'zod';
import { SessionManager } from './connection/session-manager';
import { engineRequestSchema, type EngineRequest, type EngineEvent } from '../shared/engine-protocol';

const epoch = z.uuid().parse(process.argv[2]);
if (!process.parentPort) throw new Error('Utility process parent port required');
// Loading the SSH implementation proves runtime linkage without connecting anywhere.
if (typeof Client !== 'function') throw new Error('SSH implementation unavailable');
process.parentPort.postMessage({ type: 'ready', backendEpoch: epoch, sshLibrary: 'ssh2' });
let sequence = 0;
const sessions = new SessionManager(snapshot => process.parentPort?.postMessage({ type: 'session', backendEpoch: epoch, sequence: ++sequence, snapshot }));
const inFlight = new Map<string, Promise<EngineEvent>>();
const completed = new Map<string, EngineEvent>();
async function execute(request: EngineRequest): Promise<EngineEvent> {
  try {
    let result: unknown;
    if (request.action === 'session:connect') result = await sessions.connect(request.serverId, request.generation, request.payload);
    else if (request.action === 'session:disconnect') sessions.disconnect(request.serverId, request.generation);
    else if (request.action === 'session:snapshot') result = sessions.snapshots();
    else sessions.confirmOS(request.serverId, request.generation);
    return { type: 'response', requestId: request.requestId, backendEpoch: epoch, serverId: request.serverId, generation: request.generation, ok: true, result };
  } catch (error) {
    const errorCode = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INTERNAL_ERROR';
    return { type: 'response', requestId: request.requestId, backendEpoch: epoch, serverId: request.serverId, generation: request.generation, ok: false, errorCode };
  }
}
process.parentPort.on('message', (event: { data: unknown }) => {
  const parsed = engineRequestSchema.safeParse(event.data);
  if (!parsed.success || parsed.data.backendEpoch !== epoch) return;
  const request = parsed.data;
  const cached = completed.get(request.requestId);
  if (cached) { if (cached.type === 'response' && cached.serverId === request.serverId && cached.generation === request.generation) process.parentPort?.postMessage(cached); return; }
  let work = inFlight.get(request.requestId);
  if (!work) {
    if (inFlight.size >= 32) return;
    work = execute(request); inFlight.set(request.requestId, work);
    void work.then(result => {
      inFlight.delete(request.requestId); completed.set(request.requestId, result);
      while (completed.size > 200) completed.delete(completed.keys().next().value!);
    });
  }
  void work.then(result => { if (result.type === 'response' && result.serverId === request.serverId && result.generation === request.generation) process.parentPort?.postMessage(result); });
});
process.on('exit', () => sessions.closeAll());
