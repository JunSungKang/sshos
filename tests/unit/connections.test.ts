import { afterEach,describe,expect,it,vi } from 'vitest';
import { mkdir,mkdtemp,rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConnectionController } from '../../src/main/connections';
import { StateRepository } from '../../src/main/persistence/state-repository';
import type { EngineGateway } from '../../src/main/engine-gateway';
import type { SecretVault } from '../../src/main/persistence/secrets';
import type { SessionSnapshot } from '../../src/shared/session-contracts';
const owned:string[]=[];
afterEach(async () => {vi.restoreAllMocks();for (const root of owned.splice(0)) await rm(root,{recursive:true});});
const deferred=<T>() => {let resolve!:(value:T)=>void;const promise=new Promise<T>(done => {resolve=done;});return {promise,resolve};};
async function fixture(unknown=false) {
  await mkdir(resolve('.local/tmp'),{recursive:true});const root=await mkdtemp(resolve('.local/tmp/connections-'));owned.push(root);
  const repo=await StateRepository.open(resolve(root,'data'));const profile=await repo.create({name:'fixture',host:'example.invalid',port:22,username:'fixture',authentication:'password'});
  if (!unknown) await repo.trust('example.invalid:22',Buffer.from('fixture-public-blob'),'SHA256:fixture');
  const encrypted=deferred<string>();let encryptionStarted=false,healthy=true;let connects=0;let controller!:ConnectionController;
  const gateway={request:async (request:{action:string;serverId:string;generation:number;payload?:{trustedHostKey:string|null}}) => {
    if (request.action === 'session:disconnect') return;
    connects++;if (request.payload?.trustedHostKey === null) return {status:'awaiting_host_trust',publicKey:Buffer.from('fixture-public-blob').toString('base64'),fingerprint:'SHA256:fixture'};
    const snapshot:SessionSnapshot={serverId:request.serverId,generation:request.generation,status:'connected',os:'supported',osConfirmed:false,sftp:'available',initialPath:'/home/fixture',errorCode:null};
    controller.observe(snapshot);return {status:'connected',snapshot};
  }} as unknown as EngineGateway;
  const vault={encrypt:async () => {encryptionStarted=true;return encrypted.promise;}} as unknown as SecretVault;
  controller=new ConnectionController(() => repo,gateway,vault,() => healthy);
  return {repo,profile,controller,encrypted,vault,gateway,setHealthy:(value:boolean) => {healthy=value;},get started(){return encryptionStarted;},get connects(){return connects;}};
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
  it('does not start fresh authentication after disconnect during durable host trust approval',async () => {
    const f=await fixture(true);await f.controller.connect(f.profile.id,{password:'fixture-only',saveSecret:false});const challenge=f.controller.challenges()[0]!;
    const gate=deferred<void>();let saving=false;const original=f.repo.trust.bind(f.repo);vi.spyOn(f.repo,'trust').mockImplementation(async (...args) => {saving=true;await gate.promise;await original(...args);});
    const approval=f.controller.approve(challenge.challengeId);const rejected=expect(approval).rejects.toThrow('CONNECTION_LOST');for (let i=0;i<20 && !saving;i++) await Promise.resolve();
    await f.controller.disconnect(f.profile.id);await expect(f.controller.connect(f.profile.id,{password:'fixture-only',saveSecret:false})).rejects.toThrow('SESSION_BUSY');gate.resolve();await rejected;expect(f.connects).toBe(1);expect(f.controller.views()[0]?.sessionToken).toBeNull();
  });
});

it('rejects stale secret rotation and authentication after engine loss while allowing an explicitly newer generation',async()=>{
 const f=await fixture(),secretId=crypto.randomUUID(),original=Buffer.from('old fixture ciphertext').toString('base64'),newer=Buffer.from('new fixture ciphertext').toString('base64'),gate=deferred<void>();let decrypting=false;
 await f.repo.store.update(state=>({...state!,profiles:state!.profiles.map(row=>({...row,secretId})),encryptedSecrets:[{id:secretId,profileId:f.profile.id,endpoint:'example.invalid:22',username:'fixture',ciphertext:original}]}));
 f.vault.decrypt=async(_ciphertext,persist)=>{decrypting=true;await gate.promise;await persist(Buffer.from('stale replacement').toString('base64'));return 'old fixture password';};
 const pending=f.controller.connect(f.profile.id,{saveSecret:false}),failure=expect(pending).rejects.toThrow('CONNECTION_LOST');await vi.waitFor(()=>expect(decrypting).toBe(true));f.controller.engineStopped();await f.controller.connect(f.profile.id,{password:'new fixture password',saveSecret:false});await f.repo.store.update(state=>({...state!,encryptedSecrets:state!.encryptedSecrets.map(row=>({...row,ciphertext:newer}))}));gate.resolve();await failure;expect(f.repo.snapshot().encryptedSecrets[0]?.ciphertext).toBe(newer);expect(f.connects).toBe(1);expect(f.controller.views()[0]).toMatchObject({status:'connected',generation:2});
});

it('does not fail or disconnect a newer connection when old host approval finishes after engine loss',async()=>{const f=await fixture(true);await f.controller.connect(f.profile.id,{password:'fixture-only',saveSecret:false});const challenge=f.controller.challenges()[0]!,gate=deferred<void>(),original=f.repo.trust.bind(f.repo);let written=false;vi.spyOn(f.repo,'trust').mockImplementation(async(...args)=>{await original(...args);written=true;await gate.promise;});const requests=vi.spyOn(f.gateway,'request'),approval=f.controller.approve(challenge.challengeId),failure=expect(approval).rejects.toThrow('CONNECTION_LOST');await vi.waitFor(()=>expect(written).toBe(true));f.controller.engineStopped();await f.controller.connect(f.profile.id,{password:'new fixture',saveSecret:false});gate.resolve();await failure;expect(f.controller.views()[0]).toMatchObject({status:'connected',generation:2});expect(f.controller.views()[0]?.sessionToken).not.toBeNull();expect(requests.mock.calls.some(([request])=>request.action==='session:disconnect'&&request.generation===2)).toBe(false);});

it('does not overwrite or close a new generation when an older disconnect ACK or deadline arrives late',async()=>{const f=await fixture();await f.controller.connect(f.profile.id,{password:'fixture',saveSecret:false});const gate=deferred<void>(),original=f.gateway.request.bind(f.gateway),spy=vi.spyOn(f.gateway,'request').mockImplementation(async request=>{if(request.action==='session:disconnect'){await gate.promise;return;}return original(request);});const closing=f.controller.disconnect(f.profile.id,1);f.controller.observe({serverId:f.profile.id,generation:1,status:'disconnected',os:'supported',osConfirmed:false,sftp:'available',initialPath:'/home',errorCode:null});await f.controller.connect(f.profile.id,{password:'new fixture',saveSecret:false});gate.resolve();await closing;expect(f.controller.views()[0]).toMatchObject({status:'connected',generation:2});const count=spy.mock.calls.length;await f.controller.disconnect(f.profile.id,1);expect(spy.mock.calls).toHaveLength(count);expect(f.controller.views()[0]?.sessionToken).not.toBeNull();});
