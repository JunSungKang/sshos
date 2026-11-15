import { mkdir, lstat, opendir, unlink, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { AtomicJSONStore } from './store';
import { type MutationReceipt } from '../../shared/mutations';
import { fileReceiptSchema,receiptUnresolved as unresolved,receiptTerminal as terminal,type FileReceipt } from '../../shared/receipts';
import { recoverTransfer } from '../../shared/transfers';
import { claimsConflict, type PathClaim } from '../../worker/files/path-locks';
import { transferClaims } from '../../worker/transfers/claims';

export function recoverMutation(receipt:MutationReceipt,backup:boolean):MutationReceipt {
  if (backup || ['dispatched'].includes(receipt.phase)) return {...receipt,phase:'result_unknown',errorCode:'RESULT_UNKNOWN',recoveryUncertain:backup,recoveredFromPhase:receipt.phase,...(backup ? {acknowledgedAt:null} : {})};
  if (receipt.phase === 'prepared') return {...receipt,phase:'failed',errorCode:'CONNECTION_LOST',recoveredFromPhase:'prepared'};
  return receipt;
}
export class ReceiptRepository {
  private readonly stores=new Map<string,AtomicJSONStore<FileReceipt>>();
  private readonly damaged=new Set<string>();
  private fault=false;
  private tail:Promise<void>=Promise.resolve();
  private constructor(readonly root:string) {}
  get faulted():boolean { return this.fault || [...this.stores.values()].some(store => store.faulted); }
  markFault():void {this.fault=true;}
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
      const recovered=loaded.value.kind === 'file_mutation' ? recoverMutation(loaded.value,loaded.recovered) : recoverTransfer(loaded.value,loaded.recovered); repo.stores.set(id,store);
      if (recovered !== loaded.value) { try { await store.save(recovered); } catch { repo.fault=true; } }
    }
    await repo.prune(); return repo;
  }
  private newStore(id:string):AtomicJSONStore<FileReceipt> {
    return new AtomicJSONStore(resolve(this.root,`${id}.json`),fileReceiptSchema,65536);
  }
  snapshots():FileReceipt[] { return [...this.stores.values()].map(store => store.snapshot()).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.taskId.localeCompare(b.taskId)); }
  damagedIds():string[] { return [...this.damaged]; }
  checkNew(serverId:string,claims:PathClaim[],localClaims:PathClaim[]=[]):void {
    if (this.faulted) throw new Error('STORAGE_FAILED');
    const pending=this.snapshots().filter(unresolved);
    if (pending.length>=100) throw new Error('UNRESOLVED_LIMIT');
    if (pending.some(row => row.serverId === serverId && claimsConflict(claims,[...new Set((row.kind === 'file_mutation' ? [row.source,row.destination] : row.direction === 'upload' ? [row.destination,row.tempPath] : [row.source]).filter((path):path is string => path !== null))].map(path => ({path,mode:'write'}))))) throw new Error('RESULT_UNKNOWN');
    if (localClaims.length && pending.some(row => row.kind === 'file_transfer' && claimsConflict(localClaims,transferClaims(row).local))) throw new Error('RESULT_UNKNOWN');
  }
  async save(receipt:FileReceipt):Promise<void> {
    const operation=this.tail.then(async () => {
      if (this.faulted) throw new Error('STORAGE_FAILED');
      const parsed=fileReceiptSchema.parse(receipt);if (parsed.kind === 'file_transfer' && parsed.phase === 'finalize_intent_pending') throw new Error('INPUT_INVALID');let store=this.stores.get(receipt.taskId);
      if (store) {
        const previous=store.snapshot();const immutable=(row:FileReceipt) => row.kind === 'file_mutation' ? [row.kind,row.taskId,row.serverId,row.generation,row.backendEpoch,row.endpointSnapshot,row.hostKeyFingerprint,row.operation,row.source,row.destination,row.parent,row.sourceInitialStat,row.createdAt] : [row.kind,row.taskId,row.serverId,row.generation,row.backendEpoch,row.endpointSnapshot,row.hostKeyFingerprint,row.direction,row.source,row.destination,row.tempPath,row.remoteParent,row.localParent,row.sourceInitialStat,row.totalBytes,row.createdAt];
        if (JSON.stringify(immutable(previous)) !== JSON.stringify(immutable(parsed))) throw new Error('INPUT_INVALID');
        if (terminal(previous) && previous.phase !== parsed.phase) throw new Error('INPUT_INVALID');
      }
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
