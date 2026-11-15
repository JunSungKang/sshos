import { afterEach,describe,expect,it } from 'vitest';
import { mkdir,mkdtemp,rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConnectionController } from '../../src/main/connections';
import { StateRepository } from '../../src/main/persistence/state-repository';
import type { EngineGateway } from '../../src/main/engine-gateway';
import type { SecretVault } from '../../src/main/persistence/secrets';
import type { SessionSnapshot } from '../../src/shared/session-contracts';
const owned:string[]=[];
afterEach(async () => {for (const root of owned.splice(0)) await rm(root,{recursive:true});});
const deferred=<T>() => {let resolve!:(value:T)=>void;const promise=new Promise<T>(done => {resolve=done;});return {promise,resolve};};
async function fixture() {
  await mkdir(resolve('.local/tmp'),{recursive:true});const root=await mkdtemp(resolve('.local/tmp/connections-'));owned.push(root);
  const repo=await StateRepository.open(resolve(root,'data'));const profile=await repo.create({name:'fixture',host:'example.invalid',port:22,username:'fixture',authentication:'password'});
  await repo.trust('example.invalid:22',Buffer.from('fixture-public-blob'),'SHA256:fixture');
  const encrypted=deferred<string>();let encryptionStarted=false,healthy=true;let connects=0;let controller!:ConnectionController;
  const gateway={request:async (request:{action:string;serverId:string;generation:number}) => {
    if (request.action === 'session:disconnect') return;
    connects++;const snapshot:SessionSnapshot={serverId:request.serverId,generation:request.generation,status:'connected',os:'supported',osConfirmed:false,sftp:'available',initialPath:'/home/fixture',errorCode:null};
    controller.observe(snapshot);return {status:'connected',snapshot};
  }} as unknown as EngineGateway;
  const vault={encrypt:async () => {encryptionStarted=true;return encrypted.promise;}} as unknown as SecretVault;
  controller=new ConnectionController(() => repo,gateway,vault,() => healthy);
  return {repo,profile,controller,encrypted,setHealthy:(value:boolean) => {healthy=value;},get started(){return encryptionStarted;},get connects(){return connects;}};
}
describe('connection readiness and credential lifetime',() => {
  it('issues a resource capability only after inspection and requested secret storage finish',async () => {
    const f=await fixture();const pending=f.controller.connect(f.profile.id,{password:'fixture-only',saveSecret:true});
    for (let i=0;i<20 && !f.started;i++) await Promise.resolve();
    expect(f.started).toBe(true);expect(f.controller.views()[0]?.sessionToken).toBeNull();expect(f.controller.isBusy(f.profile.id)).toBe(true);
    f.encrypted.resolve(Buffer.from('opaque-fixture-cipher').toString('base64'));await pending;
    const token=f.controller.views()[0]?.sessionToken;expect(token).toBeTypeOf('string');expect(f.controller.sessionCapability(token!)).toEqual({serverId:f.profile.id,generation:1});
  });
  it('does not save a late secret or restore a capability after disconnect during encryption',async () => {
    const f=await fixture();const pending=f.controller.connect(f.profile.id,{password:'fixture-only',saveSecret:true});const rejected=expect(pending).rejects.toThrow('CONNECTION_LOST');
    for (let i=0;i<20 && !f.started;i++) await Promise.resolve();await f.controller.disconnect(f.profile.id);
    await expect(f.controller.connect(f.profile.id,{password:'fixture-only',saveSecret:false})).rejects.toThrow('SESSION_BUSY');
    f.controller.observe({serverId:f.profile.id,generation:1,status:'connected',os:'supported',osConfirmed:false,sftp:'available',initialPath:'/home/fixture',errorCode:null});expect(f.controller.views()[0]?.sessionToken).toBeNull();
    f.encrypted.resolve('opaque-fixture-cipher');await rejected;expect(f.repo.snapshot().encryptedSecrets).toHaveLength(0);expect(f.controller.views()[0]?.sessionToken).toBeNull();expect(f.connects).toBe(1);
  });
  it('blocks trust-writing connection operations while the receipt writer is faulted',async () => {
    const f=await fixture();f.setHealthy(false);await expect(f.controller.connect(f.profile.id,{password:'fixture-only',saveSecret:false})).rejects.toThrow('STORAGE_FAILED');expect(f.connects).toBe(0);
  });
});
