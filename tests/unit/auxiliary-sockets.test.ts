import { fixtureKey } from '../../scripts/fixtures/keys.mjs';
import { describe,expect,it } from 'vitest';
import { Server,utils,type Connection } from 'ssh2';
import { AuxiliarySockets } from '../../src/worker/connection/auxiliary-sockets';
import { SessionManager } from '../../src/worker/connection/session-manager';

async function fixture() {
  const key=fixtureKey();const parsed=utils.parseKey(key.private);if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Fixture key');
  const connections=new Set<Connection>();let auth=0;
  const server=new Server({hostKeys:[key.private]},connection => {
    connections.add(connection);connection.on('error',() => {});connection.on('close',() => connections.delete(connection));
    connection.on('authentication',context => {auth++;if (context.method === 'password' && context.password === 'test-only') context.accept();else context.reject(['password']);});
    connection.on('session',accept => {const session=accept();session.on('sftp',(_accept,reject) => reject());});
  });
  await new Promise<void>((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();if (typeof address !== 'object' || !address) throw new Error('Fixture address');
  return {input:{host:'127.0.0.1',port:address.port,username:'fixture',authentication:'password' as const,password:'test-only',trustedHostKey:parsed.getPublicSSH().toString('base64')},auth:() => auth,close:async () => {for (const connection of connections) connection.end();await new Promise<void>(resolve => server.close(() => resolve()));}};
}
describe('isolated authenticated sockets',() => {
  it('shares one opening socket per role and isolates auxiliary close from control',async () => {
    const remote=await fixture();const manager=new SessionManager(() => {});const serverId=crypto.randomUUID();
    try {
      await manager.connect(serverId,1,remote.input);expect(() => manager.auxiliary(serverId,1,'transfer')).toThrow('OS_UNKNOWN');manager.confirmOS(serverId,1);
      const transfer=manager.auxiliary(serverId,1,'transfer');expect(manager.auxiliary(serverId,1,'transfer')).toBe(transfer);
      const execution=manager.auxiliary(serverId,1,'execution');expect(execution).not.toBe(transfer);await Promise.all([transfer.ready,execution.ready]);expect(remote.auth()).toBe(3);
      transfer.close();expect(() => manager.auxiliary(serverId,1,'transfer')).toThrow('SESSION_BUSY');await transfer.closed;expect(manager.snapshots()[0]?.status).toBe('connected');
      const next=manager.auxiliary(serverId,1,'transfer');await next.ready;expect(remote.auth()).toBe(4);manager.disconnect(serverId,1);await Promise.all([next.closed,execution.closed]);expect(manager.snapshots()[0]?.status).toBe('disconnected');
    } finally {manager.closeAll();await remote.close();}
  });
  it('rejects a changed auxiliary host before authentication without changing control state',async () => {
    const remote=await fixture();const other=fixtureKey();const parsed=utils.parseKey(other.private);if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Fixture key');
    const sockets=new AuxiliarySockets(() => ({input:{...remote.input,trustedHostKey:parsed.getPublicSSH().toString('base64')},agent:null,check:() => {}}));
    try {const lease=sockets.open('transfer');await expect(lease.ready).rejects.toThrow('HOST_KEY_CHANGED');await lease.closed;expect(remote.auth()).toBe(0);} finally {sockets.closeAll();await remote.close();}
  });
  it('cancels an opening socket and refuses stale control generations',async () => {
    const remote=await fixture();let active=true;const sockets=new AuxiliarySockets(() => ({input:remote.input,agent:null,check:() => {if (!active) throw new Error('CONNECTION_LOST');}}));
    try {const lease=sockets.open('transfer');lease.close();await expect(lease.ready).rejects.toThrow('CONNECTION_LOST');await lease.closed;active=false;expect(() => sockets.open('transfer')).toThrow('CONNECTION_LOST');} finally {sockets.closeAll();await remote.close();}
  });
});
