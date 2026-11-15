import { posix } from 'node:path';
import type { Stats } from 'ssh2';
import { mutationSpecSchema, initialStatSchema, type MutationSpec, type InitialStat, type MutationResult,type MutationObservation } from '../../shared/mutations';
import { controlCall, verifyDirectory, type ControlAccess } from './browser';
import { PathLocks, type PathClaim } from './path-locks';

type Prepared = { serverId:string; generation:number; spec:MutationSpec; stat:InitialStat|null; stage:'prepared'|'first_sent'|'first_ack'|'remove_sent'|'terminal'; destinationCreated:boolean; sourceRemovalConfirmed:boolean; busy:boolean };
export function mutationClaims(spec:MutationSpec):PathClaim[] { return [{path:spec.parent,mode:'keep'},...[spec.source,spec.destination].flatMap(path => path ? [{path,mode:'write' as const}] : [])]; }
export class FileMutations {
  private readonly tasks = new Map<string,Prepared>();
  constructor(private readonly control:(serverId:string,generation:number) => ControlAccess, private readonly locks:PathLocks,private readonly observe:(value:Omit<MutationObservation,'backendEpoch'>)=>void=()=>{}) {}
  private validate(input:MutationSpec):MutationSpec {
    const spec=mutationSpecSchema.parse(input);
    if (spec.operation === 'mkdir' ? spec.source !== null || spec.destination === null || spec.type !== null : !spec.source || !spec.type || (spec.operation === 'delete' ? spec.destination !== null : !spec.destination || spec.type !== 'file')) throw new Error('INPUT_INVALID');
    for (const path of [spec.source,spec.destination]) if (path && (path === '/' || posix.dirname(path) !== spec.parent)) throw new Error('PATH_UNSUPPORTED');
    if (spec.source && spec.source === spec.destination) throw new Error('NAME_CONFLICT');
    return spec;
  }
  private async sourceStat(control:ControlAccess,spec:MutationSpec):Promise<InitialStat|null> {
    if (!spec.source) return null;
    const stat=await controlCall<Stats>(control,done => control.sftp.lstat(spec.source!,done));
    if (stat.isSymbolicLink() || (spec.type === 'file' ? !stat.isFile() : !stat.isDirectory())) throw new Error('PATH_UNSUPPORTED');
    return initialStatSchema.parse({type:spec.type,size:stat.size,mtime:stat.mtime,mode:stat.mode});
  }
  private async absent(control:ControlAccess,path:string):Promise<void> {
    try { await controlCall<Stats>(control,done => control.sftp.lstat(path,done)); }
    catch (error) { if ((error as {code?:number}).code === 2) return; throw error; }
    throw new Error('NAME_CONFLICT');
  }
  async inspect(serverId:string,generation:number,input:MutationSpec):Promise<InitialStat|null> {
    const spec=this.validate(input); const control=this.control(serverId,generation); await verifyDirectory(control,spec.parent);
    const stat=await this.sourceStat(control,spec); if (spec.destination) await this.absent(control,spec.destination); return stat;
  }
  async prepare(serverId:string,generation:number,taskId:string,input:MutationSpec,expected:InitialStat|null):Promise<boolean> {
    if (this.tasks.has(taskId)) throw new Error('REQUEST_BUSY');
    if (this.tasks.size >= 100) throw new Error('TASK_LIMIT');
    const spec=this.validate(input);
    if (!this.locks.acquire(taskId,serverId,mutationClaims(spec))) return false;
    try {
      const stat=await this.inspect(serverId,generation,spec);
      if (JSON.stringify(stat) !== JSON.stringify(expected)) throw new Error('SOURCE_CHANGED');
      this.tasks.set(taskId,{serverId,generation,spec,stat,stage:'prepared',destinationCreated:false,sourceRemovalConfirmed:false,busy:false}); return true;
    } catch (error) { this.locks.release(taskId); throw error; }
  }
  async step(serverId:string,generation:number,taskId:string,stage:'first'|'remove_source'):Promise<MutationResult> {
    const task=this.tasks.get(taskId);
    if (!task || task.serverId !== serverId || task.generation !== generation) throw new Error('TOKEN_EXPIRED');
    if (task.busy || (stage === 'first' ? task.stage !== 'prepared' : task.stage !== 'first_ack' || task.spec.operation !== 'rename')) throw new Error('REQUEST_BUSY');
    task.busy=true; let sent=false; let acknowledged=false;let returned=false;let lateObserved=false;
    const result=(phase:MutationResult['phase'],errorCode:string|null,lastConfirmedPhase:string):MutationResult => ({phase,errorCode,lastConfirmedPhase,destinationCreated:task.destinationCreated,sourceRemovalConfirmed:task.sourceRemovalConfirmed});
    try {
      const control=this.control(serverId,generation); const {spec}=task;
      await verifyDirectory(control,spec.parent);
      const stat=await this.sourceStat(control,spec);
      if (JSON.stringify(stat) !== JSON.stringify(task.stat)) throw new Error('SOURCE_CHANGED');
      if (stage === 'first' && spec.destination) await this.absent(control,spec.destination);
      await controlCall<void>(control,done => {
        let callbackSeen=false;
        const callback=(error:Error|undefined|null) => {
          if(callbackSeen)return;callbackSeen=true;
          if (!error) { acknowledged=true; if (stage === 'remove_source' || spec.operation === 'delete') task.sourceRemovalConfirmed=true; else task.destinationCreated=true;if(returned && !lateObserved){lateObserved=true;try{this.observe({serverId,generation,taskId,operation:spec.operation,source:spec.source,destination:spec.destination,observation:{stage:stage==='remove_source' ? 'source_removed':spec.operation==='delete' ? 'delete_ack':spec.operation==='mkdir' ? 'mkdir_ack':'link_ack',at:new Date().toISOString()}});}catch{}} }
          done(error,undefined);
        };
        if (stage === 'remove_source') { sent=true; task.stage='remove_sent'; control.sftp.unlink(spec.source!,callback); }
        else if (spec.operation === 'mkdir') { sent=true; task.stage='first_sent'; control.sftp.mkdir(spec.destination!,{mode:0o700},callback); }
        else if (spec.operation === 'delete') { sent=true; task.stage='first_sent'; if (spec.type === 'file') control.sftp.unlink(spec.source!,callback); else control.sftp.rmdir(spec.source!,callback); }
        else {
          // ssh2 throws synchronously when the advertised OpenSSH extension is absent.
          sent=true; task.stage='first_sent';
          try { control.sftp.ext_openssh_hardlink(spec.source!,spec.destination!,callback); }
          catch (error) {
            if (error instanceof Error && error.message === 'Server does not support this extended request') { sent=false; throw new Error('HARDLINK_UNSUPPORTED'); }
            throw error;
          }
        }
      });
      if (spec.operation === 'mkdir') {
        const created=await controlCall<Stats>(control,done => control.sftp.lstat(spec.destination!,done));
        if (!created.isDirectory() || created.isSymbolicLink()) throw new Error('PATH_CHANGED');
      }
      if (spec.operation === 'rename' && stage === 'first') { task.stage='first_ack'; return result('first_ack',null,'link_ack'); }
      task.stage='terminal'; return result('completed',null,stage === 'remove_source' ? 'source_removed' : spec.operation === 'mkdir' ? 'mkdir_ack' : 'delete_ack');
    } catch (error) {
      const code=(error as {code?:number}).code === 8 && task.spec.operation === 'rename' ? 'HARDLINK_UNSUPPORTED' : error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INTERNAL_ERROR';
      const confirmedFailure=typeof (error as {code?:number}).code === 'number';
      task.stage='terminal';
      const uncertain=sent && (!confirmedFailure || acknowledged);
      return result(uncertain ? 'result_unknown' : task.destinationCreated ? 'partial' : 'failed', uncertain ? 'RESULT_UNKNOWN' : task.destinationCreated ? 'PARTIAL_RENAME' : code, task.sourceRemovalConfirmed ? 'source_removed' : task.destinationCreated ? task.spec.operation === 'mkdir' ? 'mkdir_ack' : 'link_ack' : 'prepared');
    } finally { returned=true;task.busy=false; }
  }
  finish(taskId:string,keepRestriction:boolean):void { const task=this.tasks.get(taskId); if (task?.busy) throw new Error('REQUEST_BUSY'); this.tasks.delete(taskId); if (!keepRestriction) this.locks.release(taskId); }
}
