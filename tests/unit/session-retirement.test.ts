import { afterEach,describe,it,expect,vi } from 'vitest';
import type { EventEmitter } from 'node:events';
import { Client } from 'ssh2';
vi.mock('ssh2',async load=>{
 const original=await load<typeof import('ssh2')>();const {EventEmitter}=await import('node:events');
 class Client extends EventEmitter {
  static instances:EventEmitter[]=[];
  constructor(){super();Client.instances.push(this);}
  connect(){return this;}
  destroy(){return this;}
  sftp(done:(error:Error)=>void){done(new Error('SFTP denied'));}
 }
 return {...original,Client};
});
import { SessionManager } from '../../src/worker/connection/session-manager';
const state={clients:(Client as unknown as {instances:EventEmitter[]}).instances};
const managers:SessionManager[]=[];afterEach(()=>{for(const manager of managers.splice(0))manager.closeAll();for(const client of state.clients.splice(0))client.emit('close');});
const input=()=>({host:'example.invalid',port:22,username:'fixture',authentication:'password' as const,password:'fixture',trustedHostKey:Buffer.from('fixture-key').toString('base64')});
const tick=async()=>{for(let index=0;index<40;index++)await Promise.resolve();};
function manager(){const value=new SessionManager(()=>{});managers.push(value);return value;}
describe('control generation socket retirement',()=>{
 it('waits for both old control and auxiliary actual close before allocating any replacement socket',async()=>{const sessions=manager(),id=crypto.randomUUID(),first=sessions.connect(id,1,input());state.clients[0]!.emit('ready');await first;sessions.confirmOS(id,1);const lease=sessions.auxiliary(id,1,'execution');state.clients[1]!.emit('ready');await lease.ready;sessions.disconnect(id,1);const replacement=sessions.connect(id,2,input());await tick();expect(state.clients).toHaveLength(2);state.clients[0]!.emit('close');await tick();expect(state.clients).toHaveLength(2);state.clients[1]!.emit('close');await tick();expect(state.clients).toHaveLength(3);state.clients[2]!.emit('ready');await replacement;expect(sessions.snapshots()[0]).toMatchObject({generation:2,status:'connected'});});
 it('cancels a newer connection waiting for retirement without ever creating its TCP client or changing older socket ownership',async()=>{const sessions=manager(),id=crypto.randomUUID(),first=sessions.connect(id,1,input());state.clients[0]!.emit('ready');await first;sessions.disconnect(id,1);const waiting=sessions.connect(id,2,input()),failure=expect(waiting).rejects.toThrow('CONNECTION_LOST');sessions.disconnect(id,2);await failure;expect(state.clients).toHaveLength(1);state.clients[0]!.emit('close');await tick();expect(state.clients).toHaveLength(1);});
 it('counts closing sockets toward the global three-server limit and does not evict them as disconnected history',async()=>{const sessions=manager(),ids=Array.from({length:3},()=>crypto.randomUUID());for(const id of ids){const pending=sessions.connect(id,1,input());state.clients.at(-1)!.emit('ready');await pending;sessions.disconnect(id,1);}const fourth=crypto.randomUUID();await expect(sessions.connect(fourth,1,input())).rejects.toThrow('SESSION_LIMIT');expect(state.clients).toHaveLength(3);state.clients[0]!.emit('close');await tick();const pending=sessions.connect(fourth,1,input());expect(state.clients).toHaveLength(4);state.clients[3]!.emit('ready');await pending;});
 it('rejects stale generations and closeAll cancels waiting reservations without a post-close reconnect',async()=>{const sessions=manager(),id=crypto.randomUUID(),first=sessions.connect(id,1,input());state.clients[0]!.emit('ready');await first;await expect(sessions.connect(id,1,input())).rejects.toThrow('INPUT_INVALID');sessions.disconnect(id,1);const pending=sessions.connect(id,2,input()),failure=expect(pending).rejects.toThrow('CONNECTION_LOST');sessions.closeAll();await failure;state.clients[0]!.emit('close');await tick();expect(state.clients).toHaveLength(1);});
});
