import { afterEach,describe,expect,it,vi } from 'vitest';
import { TransferScope } from '../../src/worker/transfers/scope';
import type { AuxiliaryLease } from '../../src/worker/connection/auxiliary-sockets';
const deferred=<T>() => {let resolve!:(value:T)=>void;const promise=new Promise<T>(done => {resolve=done;});return {promise,resolve};};
afterEach(() => vi.useRealTimers());
describe('transfer I/O cancellation and ACK boundary',() => {
  it('waits for native operations to settle and records a late successful create without resuming it',async () => {
    const abort=new AbortController(),gate=deferred<string>();const observations:string[]=[];const scope=new TransferScope(abort.signal,() => {},stage => observations.push(stage));
    const created=scope.native(() => gate.promise,'temp_create_ack');const rejected=expect(created).rejects.toMatchObject({message:'REQUEST_CANCELLED',uncertain:true});abort.abort(new Error('REQUEST_CANCELLED'));await rejected;
    let settled=false;const shutdown=scope.shutdown().then(() => {settled=true;});for (let i=0;i<5;i++) await Promise.resolve();expect(settled).toBe(false);gate.resolve('late-native-handle');await shutdown;expect(observations).toEqual(['temp_create_ack']);
  });
  it('distinguishes explicit SFTP failure from timeout and keeps late link ACK observational',async () => {
    vi.useFakeTimers();const abort=new AbortController();const observations:string[]=[];const scope=new TransferScope(abort.signal,() => {},stage => observations.push(stage));
    await expect(scope.remote<void>(done => done(Object.assign(new Error('fixture-denial'),{code:3}),undefined),'final_link_ack')).rejects.toMatchObject({message:'PERMISSION_DENIED',statusCode:3,uncertain:false});
    let callback!:(error:Error|null,value:undefined)=>void;const link=scope.remote<undefined>(done => {callback=done;},'final_link_ack');const rejected=expect(link).rejects.toMatchObject({message:'IO_TIMEOUT',uncertain:true});await vi.advanceTimersByTimeAsync(15001);await rejected;callback(null,undefined);expect(observations).toEqual(['final_link_ack']);await scope.shutdown();
  });
  it('refuses a stale control capability before dispatch and closes only its owned lease',async () => {
    let active=true,dispatches=0,closes=0;const closed=deferred<void>();const abort=new AbortController();const scope=new TransferScope(abort.signal,() => {if (!active) throw new Error('CONNECTION_LOST');},() => {});
    const lease={ready:Promise.resolve({}),closed:closed.promise,closing:false,close:() => {closes++;closed.resolve();}} as unknown as AuxiliaryLease;scope.attach(lease);active=false;
    await expect(scope.remote<void>(() => {dispatches++;},'temp_create_ack')).rejects.toMatchObject({message:'CONNECTION_LOST',uncertain:false});expect(dispatches).toBe(0);abort.abort(new Error('REQUEST_CANCELLED'));await scope.shutdown();expect(closes).toBeGreaterThanOrEqual(1);
  });
  it('does not dispatch an unsupported hardlink or reinterpret local EEXIST as uncertainty',async () => {
    const scope=new TransferScope(new AbortController().signal,() => {},() => {});
    await expect(scope.remote<void>(() => {throw new Error('Server does not support this extended request');},'final_link_ack')).rejects.toMatchObject({message:'HARDLINK_UNSUPPORTED',uncertain:false});
    await expect(scope.native(async () => {throw Object.assign(new Error('fixture-existing'),{code:'EEXIST'});},'temp_create_ack')).rejects.toMatchObject({message:'NAME_CONFLICT',uncertain:false});await scope.shutdown();
  });
});
