import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ReceiptRepository, recoverMutation } from '../../src/main/persistence/receipts';
import { mutationReceiptSchema, type MutationReceipt } from '../../src/shared/mutations';
const owned:string[]=[];
async function directory() {const root=resolve('.local/tmp');await mkdir(root,{recursive:true});const path=await mkdtemp(resolve(root,'receipts-'));owned.push(path);return path;}
afterEach(async () => {for (const path of owned.splice(0)) await rm(path,{recursive:true});});
export function receipt():MutationReceipt {const now=new Date().toISOString();return {kind:'file_mutation',taskId:crypto.randomUUID(),serverId:crypto.randomUUID(),generation:1,backendEpoch:crypto.randomUUID(),endpointSnapshot:{name:'fixture',host:'example.invalid',port:22,username:'fixture',endpoint:'example.invalid:22'},hostKeyFingerprint:'SHA256:fixture',operation:'mkdir',source:null,destination:'/home/new',parent:'/home',sourceInitialStat:null,phase:'prepared',stage:'prepared',lastConfirmedPhase:'prepared',destinationCreated:false,sourceRemovalConfirmed:false,errorCode:null,recoveryUncertain:false,recoveredFromPhase:null,acknowledgedAt:null,createdAt:now,updatedAt:now};}
it('stores strict receipts without credential, input or output payloads',async () => {
  const dir=await directory();const repo=await ReceiptRepository.open(dir);const row=receipt();await repo.save(row);expect(repo.snapshots()).toEqual([row]);
  expect(mutationReceiptSchema.safeParse({...row,password:'sentinel'}).success).toBe(false);expect(mutationReceiptSchema.safeParse({...row,argv:['secret']}).success).toBe(false);
});
it('recovers dispatch conservatively and keeps unknown result after user acknowledgement',async () => {
  const dir=await directory();const repo=await ReceiptRepository.open(dir);const row={...receipt(),phase:'dispatched' as const,stage:'operation_intent'};await repo.save(row);
  const restored=await ReceiptRepository.open(dir);expect(restored.snapshots()[0]?.phase).toBe('result_unknown');expect(() => restored.checkNew(row.serverId,[{path:'/home/new',mode:'write'}])).toThrow('RESULT_UNKNOWN');
  await expect(restored.forget(row.taskId)).rejects.toThrow('INPUT_INVALID');await restored.acknowledge(row.taskId);expect(restored.snapshots()[0]?.phase).toBe('result_unknown');expect(() => restored.checkNew(row.serverId,[{path:'/home/new',mode:'write'}])).not.toThrow();
});
it('marks backup terminal state uncertain and never promotes it to current success',async () => {
  const dir=await directory();const repo=await ReceiptRepository.open(dir);const row={...receipt(),phase:'completed' as const,destinationCreated:true};await repo.save(row);await repo.save({...row,updatedAt:new Date(Date.now()+100).toISOString()});await writeFile(resolve(dir,'receipts',row.taskId+'.json'),'{broken');
  const restored=await ReceiptRepository.open(dir);expect(restored.snapshots()[0]?.phase).toBe('result_unknown');expect(restored.snapshots()[0]?.recoveryUncertain).toBe(true);expect(restored.snapshots()[0]?.destinationCreated).toBe(true);
  expect(recoverMutation({...receipt(),phase:'prepared'},false).phase).toBe('failed');
});
it('keeps a corrupt record isolated and removes only explicitly selected local receipt files',async () => {
  const dir=await directory();const repo=await ReceiptRepository.open(dir);const good={...receipt(),phase:'completed' as const};await repo.save(good);const bad=crypto.randomUUID();await writeFile(resolve(dir,'receipts',bad+'.json'),'{broken');
  const restored=await ReceiptRepository.open(dir);expect(restored.damagedIds()).toEqual([bad]);expect(restored.snapshots()).toHaveLength(1);await restored.forget(bad);expect(restored.snapshots()[0]?.taskId).toBe(good.taskId);expect(await readFile(resolve(dir,'receipts',good.taskId+'.json'),'utf8')).toContain(good.taskId);
});
