import { describe, expect, it } from 'vitest';
import { Client, Server, utils, type Connection } from 'ssh2';
import { openReadChannel } from '../../src/worker/viewers/sftp-channel';
import { ViewerReadPool } from '../../src/worker/viewers/read-pool';

async function fixture(mode:'normal'|'hold_open'|'hold_subsystem') {
  const key=utils.generateKeyPairSync('ed25519');const connections=new Set<Connection>();
  const parsed=utils.parseKey(key.private);if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Invalid fixture key');
  let sessions=0,subsystems=0;let releaseOpen:(()=>void)|undefined;
  const server=new Server({hostKeys:[key.private]},connection => {
    connections.add(connection);connection.on('error',() => {});connection.on('close',() => connections.delete(connection));
    connection.on('authentication',context => {if (context.method === 'password' && context.password === 'fixture') context.accept();else context.reject(['password']);});
    connection.on('session',accept => {
      const number=++sessions;
      const open=() => {
        const session=accept();let accepted=false;
        // ssh2's test server does not automatically ACK CLOSE for a Session
        // awaiting a subsystem. Emulate the peer's protocol ACK explicitly.
        session.on('close',() => {if (!accepted) {const peer=connection as unknown as {_protocol:{channelClose(id:number):void}};const state=session as unknown as {_chanInfo:{outgoing:{id:number}}};peer._protocol.channelClose(state._chanInfo.outgoing.id);}});
        session.on('sftp',acceptSFTP => {subsystems++;if (mode === 'hold_subsystem' && number === 1) return;const sftp=acceptSFTP();accepted=true;sftp.on('error',() => {});sftp.on('close',() => sftp.end());});
      };
      if (mode === 'hold_open' && number === 1) releaseOpen=open;else open();
    });
  });
  await new Promise<void>((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();if (typeof address !== 'object' || address === null) throw new Error('Fixture unavailable');
  const client=new Client();client.on('error',() => {});
  await new Promise<void>((resolve,reject) => {client.once('ready',resolve);client.once('error',reject);client.connect({host:'127.0.0.1',port:address.port,username:'fixture',password:'fixture',hostVerifier:bytes => bytes.equals(parsed.getPublicSSH())});});
  return {client,get subsystems(){return subsystems;},get sessions(){return sessions;},releaseOpen:() => releaseOpen?.(),async close() {client.destroy();for (const value of connections) value.end();await new Promise<void>(resolve => server.close(() => resolve()));}};
}
async function bounded<T>(stage:string,promise:Promise<T>):Promise<T> {let timer:ReturnType<typeof setTimeout>|undefined;try {return await Promise.race([promise,new Promise<T>((_resolve,reject) => {timer=setTimeout(() => reject(new Error(stage)),1500);})]);}finally {clearTimeout(timer);}}
async function until(test:()=>boolean):Promise<void> {const deadline=performance.now()+2000;while (!test()) {if (performance.now()>deadline) throw new Error('Fixture deadline');await new Promise(resolve => setTimeout(resolve,5));}}
describe('isolated read channel lifecycle',() => {
  it('closes a ready read channel while preserving shared SSH for the next channel',async () => {
    const f=await fixture('normal');try {const first=openReadChannel(f.client);await bounded('first ready',first.ready);first.cancel();await bounded('first closed',first.closed);const second=openReadChannel(f.client);await bounded('second ready',second.ready);expect(f.subsystems).toBe(2);second.cancel();await bounded('second closed',second.closed);}finally {await f.close();}
  });
  it('cancels before channel confirmation and never starts the late SFTP subsystem',async () => {
    const f=await fixture('hold_open');try {const first=openReadChannel(f.client);const cancelled=expect(first.ready).rejects.toThrow('REQUEST_CANCELLED');await until(() => f.sessions === 1);first.cancel();await cancelled;f.releaseOpen();await bounded('first closed',first.closed);expect(f.subsystems).toBe(0);const second=openReadChannel(f.client);await bounded('second ready',second.ready);second.cancel();await bounded('second closed',second.closed);}finally {await f.close();}
  });
  it('times out a stalled subsystem without closing the shared SSH connection',async () => {
    const f=await fixture('hold_subsystem');try {const first=openReadChannel(f.client,30);await expect(first.ready).rejects.toThrow('IO_TIMEOUT');await bounded('first closed',first.closed);const second=openReadChannel(f.client);await bounded('second ready',second.ready);second.cancel();await bounded('second closed',second.closed);}finally {await f.close();}
  });
  it('queues FIFO eligible reads with four global and two per-server slots',async () => {
    const pool=new ViewerReadPool();const a=await pool.acquire('a','server1'),b=await pool.acquire('b','server1');const order:string[]=[];
    const waiting=pool.acquire('c','server1').then(lease => {order.push('c');return lease;});const d=await pool.acquire('d','server2'),e=await pool.acquire('e','server2');
    expect(order).toEqual([]);a.release();const c=await waiting;expect(order).toEqual(['c']);
    const cancelled=pool.acquire('cancel','server1');const rejected=expect(cancelled).rejects.toThrow('REQUEST_CANCELLED');pool.cancel('cancel');await rejected;b.release();c.release();d.release();e.release();
  });
});
