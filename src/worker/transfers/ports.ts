import type { SFTPWrapper,Stats } from 'ssh2';
import { MAX_TRANSFER_BYTES,transferStatSchema,type TransferReceipt,type TransferStat } from '../../shared/transfers';
import type { SessionManager } from '../connection/session-manager';
import { TransferIOFailure,type TransferPorts,type TransferSource } from './runner';
import { TransferScope,type MutationACK } from './scope';
import { LocalTransferFiles,type LocalDirectory } from './local';
import type { WritePort } from './io';

export function remoteTransferStat(stat:Stats):TransferStat {
  if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(stat.size) || stat.size<0 || !Number.isSafeInteger(stat.mtime) || stat.mtime<0) throw new TransferIOFailure('PATH_UNSUPPORTED');
  if (stat.size>MAX_TRANSFER_BYTES) throw new TransferIOFailure('FILE_LIMIT');return transferStatSchema.parse({size:stat.size,mtime:String(stat.mtime),identity:''});
}
export class SFTPTransferPorts implements TransferPorts {
  private readonly scope:TransferScope;
  private readonly local:LocalTransferFiles;
  private sftp:SFTPWrapper|null=null;
  private writeHandle:Buffer|null=null;
  private readonly handles=new Set<Buffer>();
  private tempFingerprint:TransferStat|null=null;
  constructor(private readonly row:TransferReceipt,directory:LocalDirectory,private readonly sessions:Pick<SessionManager,'auxiliary'|'control'>,signal:AbortSignal,late:(stage:MutationACK)=>void) {
    this.scope=new TransferScope(signal,() => sessions.control(row.serverId,row.generation,true).check(),late);this.local=new LocalTransferFiles(row,directory,this.scope);
  }
  private remote():SFTPWrapper {this.scope.check();if (!this.sftp) throw new TransferIOFailure('SFTP_UNAVAILABLE');return this.sftp;}
  private async verifyParent():Promise<void> {
    const sftp=this.remote();const stat=await this.scope.remote<Stats>(done => sftp.lstat(this.row.remoteParent,done));
    if (!stat.isDirectory() || stat.isSymbolicLink() || await this.scope.remote<string>(done => sftp.realpath(this.row.remoteParent,done)) !== this.row.remoteParent) throw new TransferIOFailure('PATH_UNSUPPORTED');
  }
  private async absentDestination():Promise<void> {
    const sftp=this.remote();try {await this.scope.remote<Stats>(done => sftp.lstat(this.row.destination,done));} catch (error) {if (error instanceof TransferIOFailure && error.statusCode === 2) return;throw error;}throw new TransferIOFailure('NAME_CONFLICT');
  }
  private async openRead(path:string,verification=false):Promise<TransferSource> {
    const sftp=this.remote();
    const mapError=(error:unknown):never => {if (verification && error instanceof TransferIOFailure && error.message === 'PERMISSION_DENIED') throw new TransferIOFailure('VERIFY_READ_DENIED');throw error;};
    try {
      const before=await this.scope.remote<Stats>(done => sftp.lstat(path,done));remoteTransferStat(before);
      const handle=await this.scope.remote<Buffer>(done => sftp.open(path,'r',(error,value) => {if (!error) this.handles.add(value);done(error,value);}));
      return {
        read:(bytes,offset,length,position) => this.scope.remote<number>(done => sftp.read(handle,bytes,offset,length,position,(error,count) => done(error,count)),null,null).catch(mapError),
        stat:async () => remoteTransferStat(await this.scope.remote<Stats>(done => sftp.fstat(handle,done))),
        close:async () => {if (!this.handles.has(handle)) return;await this.scope.remote<void>(done => sftp.close(handle,error => done(error,undefined)));this.handles.delete(handle);}
      };
    } catch (error) {return mapError(error);}
  }
  async prepare():Promise<TransferSource> {
    await this.local.verifyParent();this.scope.check();const lease=this.sessions.auxiliary(this.row.serverId,this.row.generation,'transfer');this.scope.attach(lease);
    const client=await this.scope.wait(lease.ready);this.sftp=await this.scope.remote<SFTPWrapper>(done => client.sftp(done));await this.verifyParent();
    if (this.row.direction === 'upload') {await this.absentDestination();return this.local.openSource();}
    await this.local.absentDestination();return this.openRead(this.row.source);
  }
  async createTemp():Promise<WritePort> {
    if (this.row.direction === 'download') return this.local.createTemp();
    await this.verifyParent();const sftp=this.remote();
    const handle=await this.scope.remote<Buffer>(done => sftp.open(this.row.tempPath,'wx',0o600,(error,value) => {if (!error) {this.handles.add(value);this.writeHandle=value;}done(error,value);}), 'temp_create_ack');
    return {write:async (bytes,offset,length,position) => {await this.scope.remote<void>(done => sftp.write(handle,bytes,offset,length,position,error => done(error,undefined)),null,null);return length;}};
  }
  async finishWrite():Promise<void> {
    if (this.row.direction === 'download') return this.local.finishWrite();
    const sftp=this.remote(),handle=this.writeHandle;if (!handle) throw new TransferIOFailure('INTERNAL_ERROR');
    await this.scope.remote<void>(done => sftp.close(handle,error => done(error,undefined)));this.handles.delete(handle);this.writeHandle=null;
  }
  async tempStat():Promise<TransferStat> {
    if (this.row.direction === 'download') return this.local.tempStat();
    await this.verifyParent();const value=remoteTransferStat(await this.scope.remote<Stats>(done => this.remote().lstat(this.row.tempPath,done)));
    if (this.tempFingerprint && (value.size !== this.tempFingerprint.size || value.mtime !== this.tempFingerprint.mtime)) throw new TransferIOFailure('VERIFY_MISMATCH');this.tempFingerprint ??=value;return value;
  }
  async openVerification():Promise<TransferSource> {if (this.row.direction === 'download') return this.local.openVerification();await this.tempStat();return this.openRead(this.row.tempPath,true);}
  async linkDestination():Promise<void> {
    if (this.row.direction === 'download') return this.local.linkDestination();
    await this.tempStat();const sftp=this.remote();await this.scope.remote<void>(done => sftp.ext_openssh_hardlink(this.row.tempPath,this.row.destination,error => done(error,undefined)),'final_link_ack');
  }
  async confirmDestination():Promise<void> {
    if (this.row.direction === 'download') return this.local.confirmDestination();
    await this.verifyParent();const stat=remoteTransferStat(await this.scope.remote<Stats>(done => this.remote().lstat(this.row.destination,done)));if (stat.size !== this.row.totalBytes) throw new TransferIOFailure('VERIFY_MISMATCH');
  }
  async removeTemp():Promise<void> {
    if (this.row.direction === 'download') return this.local.removeTemp();
    await this.tempStat();await this.scope.remote<void>(done => this.remote().unlink(this.row.tempPath,error => done(error,undefined)),'temp_remove_ack');
  }
  async shutdown():Promise<void> {await this.scope.shutdown();await this.local.shutdown();this.handles.clear();this.writeHandle=null;this.sftp=null;}
}
