import { mkdir, lstat, opendir, unlink, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { AtomicJSONStore } from './store';
import { mutationReceiptSchema, type MutationReceipt } from '../../shared/mutations';
import { claimsConflict, type PathClaim } from '../../worker/files/path-locks';

const unresolved = (receipt:MutationReceipt) => ['result_unknown','partial'].includes(receipt.phase) && receipt.acknowledgedAt === null;
const terminal = (receipt:MutationReceipt) => ['completed','failed','partial','result_unknown'].includes(receipt.phase);
export function recoverMutation(receipt:MutationReceipt,backup:boolean):MutationReceipt {
  if (backup || ['dispatched'].includes(receipt.phase)) return {...receipt,phase:'result_unknown',errorCode:'RESULT_UNKNOWN',recoveryUncertain:backup,recoveredFromPhase:receipt.phase};
  if (receipt.phase === 'prepared') return {...receipt,phase:'failed',errorCode:'CONNECTION_LOST',recoveredFromPhase:'prepared'};
  return receipt;
}
export class ReceiptRepository {
  private readonly stores=new Map<string,AtomicJSONStore<MutationReceipt>>();
  private readonly damaged=new Set<string>();
  private fault=false;
  private tail:Promise<void>=Promise.resolve();
  private constructor(readonly root:string) {}
  get faulted():boolean { return this.fault || [...this.stores.values()].some(store => store.faulted); }
  async settled():Promise<void> { await this.tail; await Promise.all([...this.stores.values()].map(store => store.settled())); }
  static async open(dataRoot:string):Promise<ReceiptRepository> {
    const root=resolve(dataRoot,'receipts');
    try { const stat=await lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('STORAGE_FAILED'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await mkdir(root,{mode:0o700}); }
    const actual=await realpath(root); const relation=relative(await realpath(dataRoot),actual);
    if (!relation || isAbsolute(relation) || relation === '..' || relation.startsWith(`..${sep}`)) throw new Error('STORAGE_FAILED');
    const repo=new ReceiptRepository(actual); const ids=new Set<string>();
    const entries=await opendir(actual);
    for await (const entry of entries) {
      const match=/^([a-f0-9-]{36})\.json(?:\.bak)?$/u.exec(entry.name); if (match) ids.add(match[1]!);
      if (ids.size>5000) throw new Error('STORAGE_FAILED');
    }
    for (const id of ids) {
      const store=repo.newStore(id);
      let loaded:Awaited<ReturnType<typeof store.load>>;
      try { loaded=await store.load(); if (loaded.value.taskId !== id) throw new Error('STORAGE_FAILED'); }
      catch { repo.damaged.add(id); continue; }
      const recovered=recoverMutation(loaded.value,loaded.recovered); repo.stores.set(id,store);
      if (recovered !== loaded.value) { try { await store.save(recovered); } catch { repo.fault=true; } }
    }
    await repo.prune(); return repo;
  }
  private newStore(id:string):AtomicJSONStore<MutationReceipt> {
    return new AtomicJSONStore(resolve(this.root,`${id}.json`),mutationReceiptSchema,65536);
  }
  snapshots():MutationReceipt[] { return [...this.stores.values()].map(store => store.snapshot()).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.taskId.localeCompare(b.taskId)); }
  damagedIds():string[] { return [...this.damaged]; }
  checkNew(serverId:string,claims:PathClaim[]):void {
    if (this.faulted) throw new Error('STORAGE_FAILED');
    const pending=this.snapshots().filter(unresolved);
    if (pending.length>=100) throw new Error('UNRESOLVED_LIMIT');
    if (pending.some(row => row.serverId === serverId && claimsConflict(claims,[...new Set([row.source,row.destination].filter((path):path is string => path !== null))].map(path => ({path,mode:'write'}))))) throw new Error('RESULT_UNKNOWN');
  }
  async save(receipt:MutationReceipt):Promise<void> {
    const operation=this.tail.then(async () => {
      if (this.faulted) throw new Error('STORAGE_FAILED');
      const parsed=mutationReceiptSchema.parse(receipt); let store=this.stores.get(receipt.taskId);
      try {
        if (!store) { if (this.damaged.has(receipt.taskId)) throw new Error('STORAGE_FAILED'); store=this.newStore(receipt.taskId); await store.initialize(parsed); this.stores.set(receipt.taskId,store); }
        else await store.save(parsed);
      } catch { this.fault=true; throw new Error('STORAGE_FAILED'); }
    });
    this.tail=operation.catch(() => {}); return operation;
  }
  private async remove(id:string):Promise<void> {
    for (const suffix of ['.json','.json.bak']) { try { await unlink(resolve(this.root,id+suffix)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    this.stores.delete(id); this.damaged.delete(id);
  }
  async acknowledge(id:string):Promise<void> {
    const store=this.stores.get(id); if (!store || !unresolved(store.snapshot())) throw new Error('INPUT_INVALID');
    await this.save({...store.snapshot(),acknowledgedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
  async forget(id:string):Promise<void> {
    await this.tail; const row=this.stores.get(id)?.snapshot();
    if (!this.damaged.has(id) && (!row || !terminal(row) || unresolved(row))) throw new Error('INPUT_INVALID');
    await this.remove(id);
  }
  private async prune():Promise<void> {
    const eligible=this.snapshots().filter(row => terminal(row) && !unresolved(row));
    for (const [index,row] of eligible.entries()) if (index>=1000 || Date.now()-Date.parse(row.updatedAt)>30*86400000) await this.remove(row.taskId);
  }
}
