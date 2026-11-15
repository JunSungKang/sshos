import { mkdir, lstat, opendir, unlink, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { AtomicJSONStore } from './store';
import { type MutationReceipt } from '../../shared/mutations';
import { fileReceiptSchema,receiptUnresolved as unresolved,receiptTerminal as terminal,type FileReceipt } from '../../shared/receipts';
import { recoverExecution } from '../../shared/executions';
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
  private version=0;
  private pendingRevision=-1;private pendingRows:FileReceipt[]=[];
  get revision():number {return this.version;}
  get(id:string):FileReceipt|undefined {return this.stores.get(id)?.snapshot();}
  private tail:Promise<void>=Promise.resolve();
  private constructor(readonly root:string,private readonly onDirectorySyncUnavailable?:()=>void) {}
  get faulted():boolean { return this.fault || [...this.stores.values()].some(store => store.faulted); }
  markFault():void {this.fault=true;}
  async settled():Promise<void> { await this.tail; await Promise.all([...this.stores.values()].map(store => store.settled())); }
  static async open(dataRoot:string,continuity?:{epoch:string;executionIds:ReadonlySet<string>},onDirectorySyncUnavailable?:()=>void):Promise<ReceiptRepository> {
    const root=resolve(dataRoot,'receipts');
    try { const stat=await lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('STORAGE_FAILED'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await mkdir(root,{mode:0o700}); }
    const actual=await realpath(root); const relation=relative(await realpath(dataRoot),actual);
    if (!relation || isAbsolute(relation) || relation === '..' || relation.startsWith(`..${sep}`)) throw new Error('STORAGE_FAILED');
    const repo=new ReceiptRepository(actual,onDirectorySyncUnavailable); const ids=new Set<string>();
    const entries=await opendir(actual);
    for await (const entry of entries) {
      const match=/^([a-f0-9-]{36})\.json(?:\.bak)?$/u.exec(entry.name); if (match) ids.add(match[1]!);
    }
    let loadedSincePrune=0;
    for (const id of ids) {
      const store=repo.newStore(id);
      let loaded:Awaited<ReturnType<typeof store.load>>;
      try { loaded=await store.load(); if (loaded.value.taskId !== id) throw new Error('STORAGE_FAILED'); }
      catch { repo.damaged.add(id); continue; }
      const keepExecution=!loaded.recovered && continuity?.epoch === loaded.value.backendEpoch && continuity.executionIds.has(id) && (loaded.value.kind === 'gui_exec' || loaded.value.kind === 'pty');
      const recovered=keepExecution ? loaded.value : loaded.value.kind === 'file_mutation' ? recoverMutation(loaded.value,loaded.recovered) : loaded.value.kind === 'file_transfer' ? recoverTransfer(loaded.value,loaded.recovered) : recoverExecution(loaded.value,loaded.recovered); repo.stores.set(id,store);
      if (recovered !== loaded.value) { try { await store.save(recovered); } catch { repo.fault=true; } }
      // One startup cleanup pass, processed in batches so legitimate completed
      // history cannot hit the retained-record bound before pruning is reached.
      if(++loadedSincePrune>=1000){await repo.prune(continuity?.executionIds);if(repo.stores.size+repo.damaged.size>5000)throw new Error('STORAGE_FAILED');loadedSincePrune=0;}
    }
    await repo.prune(continuity?.executionIds);if(repo.stores.size+repo.damaged.size>5000)throw new Error('STORAGE_FAILED');return repo;
  }
  private newStore(id:string):AtomicJSONStore<FileReceipt> {
    return new AtomicJSONStore(resolve(this.root,`${id}.json`),fileReceiptSchema,65536,this.onDirectorySyncUnavailable);
  }
  snapshots():FileReceipt[] { return [...this.stores.values()].map(store => store.snapshot()).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.taskId.localeCompare(b.taskId)); }
  damagedIds():string[] { return [...this.damaged]; }
  checkNew(serverId:string,claims:PathClaim[],localClaims:PathClaim[]=[]):void {
    if (this.faulted) throw new Error('STORAGE_FAILED');
    // A100-row registration rechecks every claim before each durable write/RPC.
    // Unresolved rows change only with this repository revision, so do not clone
    // and sort all historical receipts for every individual claim.
    if(this.pendingRevision!==this.version){this.pendingRows=[...this.stores.values()].map(store=>store.snapshot()).filter(unresolved);this.pendingRevision=this.version;}
    const pending=this.pendingRows;
    if (pending.length>=100) throw new Error('UNRESOLVED_LIMIT');
    if (pending.some(row => (row.kind === 'file_transfer' || row.kind === 'file_mutation') && row.serverId === serverId && claimsConflict(claims,[...new Set((row.kind === 'file_mutation' ? [row.source,row.destination] : row.direction === 'upload' ? [row.destination,row.tempPath] : [row.source]).filter((path):path is string => path !== null))].map(path => ({path,mode:'write'}))))) throw new Error('RESULT_UNKNOWN');
    if (localClaims.length && pending.some(row => row.kind === 'file_transfer' && claimsConflict(localClaims,transferClaims(row).local))) throw new Error('RESULT_UNKNOWN');
  }
  async save(receipt:FileReceipt):Promise<void> {
    const operation=this.tail.then(async () => {
      if (this.faulted) throw new Error('STORAGE_FAILED');
      const parsed=fileReceiptSchema.parse(receipt);if (parsed.kind === 'file_transfer' && parsed.phase === 'finalize_intent_pending') throw new Error('INPUT_INVALID');let store=this.stores.get(receipt.taskId);
      if (store) {
        const previous=store.snapshot();const immutable=(row:FileReceipt) => row.kind === 'file_mutation' ? [row.kind,row.taskId,row.serverId,row.generation,row.backendEpoch,row.endpointSnapshot,row.hostKeyFingerprint,row.operation,row.source,row.destination,row.parent,row.sourceInitialStat,row.createdAt] : row.kind === 'file_transfer' ? [row.kind,row.taskId,row.serverId,row.generation,row.backendEpoch,row.endpointSnapshot,row.hostKeyFingerprint,row.direction,row.source,row.destination,row.tempPath,row.remoteParent,row.localParent,row.sourceInitialStat,row.totalBytes,row.createdAt] : [row.kind,row.taskId,row.serverId,row.generation,row.backendEpoch,row.endpointSnapshot,row.hostKeyFingerprint,row.executionId,row.terminalId,row.source,row.cwd,row.createdAt];
        if (JSON.stringify(immutable(previous)) !== JSON.stringify(immutable(parsed))) throw new Error('INPUT_INVALID');
        if (terminal(previous) && previous.phase !== parsed.phase) throw new Error('INPUT_INVALID');
      }
      try {
        if (!store) { if (this.damaged.has(receipt.taskId)) throw new Error('STORAGE_FAILED'); store=this.newStore(receipt.taskId); await store.initialize(parsed); this.stores.set(receipt.taskId,store); }
        else await store.save(parsed);
        this.version++;
      } catch { this.fault=true; throw new Error('STORAGE_FAILED'); }
    });
    this.tail=operation.catch(() => {}); return operation;
  }
  private async remove(id:string):Promise<void> {
    for (const suffix of ['.json','.json.bak']) { try { await unlink(resolve(this.root,id+suffix)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    this.stores.delete(id); this.damaged.delete(id);this.version++;
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
  private async prune(preserved:ReadonlySet<string>=new Set()):Promise<void> {
    const eligible=this.snapshots().filter(row => terminal(row) && !unresolved(row) && !preserved.has(row.taskId));
    for (const [index,row] of eligible.entries()) if (index>=1000 || Date.now()-Date.parse(row.updatedAt)>30*86400000) await this.remove(row.taskId);
  }
}
