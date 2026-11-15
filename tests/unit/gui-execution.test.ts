import { afterEach,describe,expect,it,vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { Client,ClientChannel } from 'ssh2';
import { GUIExecutions,type ExecutionRuntime } from '../../src/worker/execution/gui';
import type { SessionManager } from '../../src/worker/connection/session-manager';
import type { AuxiliaryLease } from '../../src/worker/connection/auxiliary-sockets';
import type { FileReceipt } from '../../src/shared/receipts';
import { executionReceipt } from '../fixtures/executions';
afterEach(()=>vi.useRealTimers());const tick=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
function fixture(options:{storageFailure?:boolean;mode?:number}={}) {
 const row=executionReceipt(),expected={type:'file' as const,size:10,mtime:1,mode:options.mode ?? 0o100700},spec={path:row.source!,cwd:row.cwd!,mode:'direct' as const,argv:['sensitive-argument']};const saved:FileReceipt[]=[],commands:string[]=[],events:ExecutionRuntime[]=[];let callback!:(error:Error|undefined,channel:ClientChannel)=>void,resolveClosed!:()=>void;let closing=false;
 const client={exec:(command:string,done:typeof callback)=>{commands.push(command);callback=done;}} as unknown as Client;
 const lease:AuxiliaryLease={ready:Promise.resolve(client),closed:new Promise(done=>{resolveClosed=done;}),get closing(){return closing;},close:()=>{closing=true;queueMicrotask(resolveClosed);}};
 const access={check:()=>{},quarantine:()=>{throw new Error('Unexpected quarantine');},sftp:{lstat:(path:string,done:(error:undefined,stat:unknown)=>void)=>queueMicrotask(()=>done(undefined,{size:10,mtime:1,mode:expected.mode,isDirectory:()=>path==='/home',isFile:()=>path==='/home/program.sh',isSymbolicLink:()=>false})),realpath:(path:string,done:(error:undefined,path:string)=>void)=>queueMicrotask(()=>done(undefined,path))}};
 const sessions={control:()=>access,auxiliary:()=>lease,withMetadata:async(_server:string,_generation:number,action:()=>Promise<unknown>)=>action()} as unknown as Pick<SessionManager,'control'|'auxiliary'|'withMetadata'>;
 const writer={faulted:false,persist:async(receipt:FileReceipt)=>{if(options.storageFailure)throw new Error('STORAGE_FAILED');saved.push(structuredClone(receipt));}};
 const executions=new GUIExecutions(row.backendEpoch,sessions,writer,value=>events.push(value));const channel=new PassThrough() as unknown as ClientChannel;channel.stderr=new PassThrough();channel.signal=vi.fn();channel.close=vi.fn(()=>channel);const end=vi.spyOn(channel,'end');
 return {row,expected,spec,executions,saved,commands,events,channel,end,accept:()=>callback(undefined,channel),reject:()=>callback(new Error('denied'),undefined as unknown as ClientChannel)};
}
describe('GUI exec lifecycle and bounded output owner',()=>{
 it('durably gates dispatch, keeps stdin open and distinguishes observed exit from channel termination',async()=>{
  const f=fixture();f.executions.start(f.row,f.spec,f.expected);await tick();expect(f.saved[0]).toMatchObject({phase:'dispatching',channelAccepted:false});expect(f.commands).toHaveLength(1);expect(JSON.stringify(f.saved)).not.toContain('sensitive-argument');f.accept();await tick();f.channel.emit('data',Buffer.from('plain \x1b[31m <script>'));f.channel.stderr.emit('data',Buffer.from('stderr'));f.channel.emit('exit',0);await tick();expect(f.executions.snapshot(f.row.serverId,1)[0]?.receipt).toMatchObject({phase:'running',exitObserved:true,exitCode:0,channelClosed:false});expect(f.end).not.toHaveBeenCalled();f.channel.emit('close');await tick();expect(f.executions.snapshot(f.row.serverId,1)[0]).toMatchObject({receipt:{phase:'exited',channelClosed:true,exitCode:0},active:false,recordPending:false});expect(f.executions.read(f.row.serverId,1,f.row.taskId,0).frames.map(frame=>frame.stream)).toEqual(['stdout','stderr']);
 });
 it('does not time out a silent running program and sends only one TERM with an unconfirmed stop after5s',async()=>{
  vi.useFakeTimers();const f=fixture();f.executions.start(f.row,f.spec,f.expected);await vi.runAllTicks();await tick();f.accept();await tick();await vi.advanceTimersByTimeAsync(120000);expect(f.executions.snapshot(f.row.serverId,1)[0]?.receipt.phase).toBe('running');f.executions.stop(f.row.serverId,1,f.row.taskId);f.executions.stop(f.row.serverId,1,f.row.taskId);expect(f.channel.signal).toHaveBeenCalledExactlyOnceWith('TERM');await vi.advanceTimersByTimeAsync(5000);expect(f.executions.snapshot(f.row.serverId,1)[0]?.receipt.phase).toBe('stop_unconfirmed');expect(f.channel.close).not.toHaveBeenCalled();f.channel.emit('close');await tick();expect(f.executions.snapshot(f.row.serverId,1)[0]?.receipt.phase).toBe('result_unknown');
 });
 it('sends no exec after intent-storage failure or missing executable bits',async()=>{
  const f=fixture({storageFailure:true});f.executions.start(f.row,f.spec,f.expected);await tick();expect(f.commands).toEqual([]);expect(f.executions.snapshot(f.row.serverId,1)[0]).toMatchObject({receipt:{phase:'cancelled_not_sent'},recordError:true,active:false});const g=fixture({mode:0o100600});g.executions.start(g.row,g.spec,g.expected);await tick();expect(g.commands).toEqual([]);expect(g.executions.snapshot(g.row.serverId,1)[0]?.receipt.errorCode).toBe('EXEC_PERMISSION');
 });
 it('keeps explicit request rejection distinct from unknown channel closure and clears session output without replay',async()=>{
  const f=fixture();f.executions.start(f.row,f.spec,f.expected);await tick();f.reject();await tick();expect(f.executions.snapshot(f.row.serverId,1)[0]?.receipt.phase).toBe('rejected');const g=fixture();g.executions.start(g.row,g.spec,g.expected);await tick();g.accept();g.channel.emit('data',Buffer.from('cached'));g.executions.closeChannel(g.row.serverId,1,g.row.taskId);expect(g.channel.close).toHaveBeenCalledOnce();g.channel.emit('exit',0);g.channel.emit('close');await tick();expect(g.executions.snapshot(g.row.serverId,1)[0]?.receipt).toMatchObject({phase:'result_unknown',exitCode:0});g.executions.sessionChanged(g.row.serverId,1,false);g.channel.emit('data',Buffer.from('late discarded'));expect(g.executions.read(g.row.serverId,1,g.row.taskId,0)).toMatchObject({frames:[],omitted:true});await g.executions.forget(g.row.serverId,1,g.row.taskId);expect(()=>g.executions.read(g.row.serverId,1,g.row.taskId,0)).toThrow('TOKEN_EXPIRED');
 });
});
