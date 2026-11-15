import { constants,type BigIntStats } from 'node:fs';
import { open,lstat,realpath,link,unlink,type FileHandle } from 'node:fs/promises';
import { isAbsolute,resolve,dirname,basename,join } from 'node:path';
import { validName } from '../../shared/files';
import { MAX_TRANSFER_BYTES,transferStatSchema,type TransferReceipt,type TransferStat } from '../../shared/transfers';
import { TransferIOFailure,type TransferSource } from './runner';
import { TransferScope,transferFailure } from './scope';
import type { WritePort } from './io';

export type LocalDirectory={path:string;identity:string};
export function supportedLocalPath(path:string):boolean {
  return isAbsolute(path) && !path.includes('\0') && !path.startsWith('//') && !path.startsWith('\\\\') && (process.platform !== 'win32' || /^[A-Za-z]:[\\/]/u.test(path));
}
export function localDownloadName(name:string,platform:NodeJS.Platform=process.platform):boolean {
  if (!validName(name)) return false;
  return platform !== 'win32' || !/[<>:"\\|?*]/u.test(name) && !/[. ]$/u.test(name) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(name);
}
const identity=(stat:BigIntStats) => `${stat.dev}:${stat.ino}`;
function fileStat(stat:BigIntStats):TransferStat {
  if (!stat.isFile() || stat.isSymbolicLink()) throw new TransferIOFailure('PATH_UNSUPPORTED');
  if (stat.size<0n || stat.size>BigInt(MAX_TRANSFER_BYTES)) throw new TransferIOFailure('FILE_LIMIT');
  return transferStatSchema.parse({size:Number(stat.size),mtime:stat.mtimeNs.toString(),identity:identity(stat)});
}
/** Main uses this only for a native selection; renderer paths never reach here. */
export async function inspectLocalDirectory(selected:string):Promise<LocalDirectory> {
  if (!supportedLocalPath(selected)) throw new TransferIOFailure('PATH_UNSUPPORTED');
  try {
    const before=await lstat(selected,{bigint:true});if (!before.isDirectory() || before.isSymbolicLink()) throw new TransferIOFailure('PATH_UNSUPPORTED');
    const path=await realpath(selected);const stat=await lstat(path,{bigint:true});if (!stat.isDirectory() || stat.isSymbolicLink() || identity(before) !== identity(stat)) throw new TransferIOFailure('PATH_UNSUPPORTED');return {path,identity:identity(stat)};
  } catch (error) {throw transferFailure(error);}
}
export async function inspectLocalFile(selected:string):Promise<{path:string;parent:LocalDirectory;stat:TransferStat}> {
  if (!supportedLocalPath(selected)) throw new TransferIOFailure('PATH_UNSUPPORTED');let handle:FileHandle|null=null;
  try {
    const before=await lstat(selected,{bigint:true});fileStat(before);const parent=await inspectLocalDirectory(dirname(selected));const path=join(parent.path,basename(selected));
    handle=await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));const stat=await handle.stat({bigint:true});if (identity(before) !== identity(stat)) throw new TransferIOFailure('SOURCE_CHANGED');return {path,parent,stat:fileStat(stat)};
  } catch (error) {throw transferFailure(error);}
  finally {await handle?.close();}
}

/** Local authority is one canonical parent plus the immutable row's source/name. */
export class LocalTransferFiles {
  private readonly handles=new Set<FileHandle>();
  private writeHandle:FileHandle|null=null;
  private tempIdentity:string|null=null;
  constructor(private readonly row:TransferReceipt,private readonly directory:LocalDirectory,private readonly scope:TransferScope) {
    if (row.localParent !== directory.path || !supportedLocalPath(directory.path) || resolve(directory.path) !== directory.path) throw new TransferIOFailure('PATH_UNSUPPORTED');
    const local=row.direction === 'upload' ? row.source : row.destination;
    if (!supportedLocalPath(local) || dirname(local) !== directory.path || !localDownloadName(basename(local))) throw new TransferIOFailure('PATH_UNSUPPORTED');
    if (row.direction === 'download' && (dirname(row.tempPath) !== directory.path || basename(row.tempPath) !== `.sshos-${row.taskId}.part` || row.destination === row.tempPath)) throw new TransferIOFailure('PATH_UNSUPPORTED');
  }
  async verifyParent():Promise<void> {
    this.scope.check();const stat=await this.scope.native(() => lstat(this.directory.path,{bigint:true}));
    if (!stat.isDirectory() || stat.isSymbolicLink() || identity(stat) !== this.directory.identity || await this.scope.native(() => realpath(this.directory.path)) !== this.directory.path) throw new TransferIOFailure('PATH_UNSUPPORTED');
  }
  async absentDestination():Promise<void> {
    try {await this.scope.native(() => lstat(this.row.destination));} catch (error) {if (error instanceof TransferIOFailure && error.statusCode === 'ENOENT') return;throw error;}throw new TransferIOFailure('NAME_CONFLICT');
  }
  private async acquire(path:string,flags:number,mode?:number,mutation:'temp_create_ack'|null=null):Promise<FileHandle> {
    return this.scope.native(async () => {const handle=await open(path,flags,mode);this.handles.add(handle);return handle;},mutation);
  }
  private async close(handle:FileHandle):Promise<void> {if (!this.handles.has(handle)) return;await this.scope.native(() => handle.close());this.handles.delete(handle);}
  private source(handle:FileHandle):TransferSource {
    return {read:(bytes,offset,length,position) => this.scope.native(async () => (await handle.read(bytes,offset,length,position)).bytesRead),stat:async () => fileStat(await this.scope.native(() => handle.stat({bigint:true}))),close:() => this.close(handle)};
  }
  async openSource():Promise<TransferSource> {
    await this.verifyParent();const before=await this.scope.native(() => lstat(this.row.source,{bigint:true}));fileStat(before);
    const handle=await this.acquire(this.row.source,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));const stat=await this.scope.native(() => handle.stat({bigint:true}));
    if (identity(before) !== identity(stat)) throw new TransferIOFailure('SOURCE_CHANGED');fileStat(stat);return this.source(handle);
  }
  async createTemp():Promise<WritePort> {
    await this.verifyParent();const handle=await this.acquire(this.row.tempPath,constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),0o600,'temp_create_ack');
    this.writeHandle=handle;
    return {write:async (bytes,offset,length,position) => {await this.captureTempIdentity(handle);return this.scope.native(async () => (await handle.write(bytes,offset,length,position)).bytesWritten);}};
  }
  private async captureTempIdentity(handle:FileHandle):Promise<void> {if (this.tempIdentity) return;const stat=await this.scope.native(() => handle.stat({bigint:true}));fileStat(stat);this.tempIdentity=identity(stat);}
  async finishWrite():Promise<void> {const handle=this.writeHandle;if (!handle) throw new TransferIOFailure('INTERNAL_ERROR');await this.captureTempIdentity(handle);await this.scope.native(() => handle.sync());await this.close(handle);this.writeHandle=null;}
  async tempStat():Promise<TransferStat> {
    await this.verifyParent();const stat=await this.scope.native(() => lstat(this.row.tempPath,{bigint:true}));
    if (!this.tempIdentity || identity(stat) !== this.tempIdentity) throw new TransferIOFailure('PATH_UNSUPPORTED');return fileStat(stat);
  }
  async openVerification():Promise<TransferSource> {
    await this.tempStat();
    try {
      const handle=await this.acquire(this.row.tempPath,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));const stat=await this.scope.native(() => handle.stat({bigint:true}));
      if (identity(stat) !== this.tempIdentity) throw new TransferIOFailure('PATH_UNSUPPORTED');fileStat(stat);return this.source(handle);
    } catch (error) {if (error instanceof TransferIOFailure && error.message === 'PERMISSION_DENIED') throw new TransferIOFailure('VERIFY_READ_DENIED');throw error;}
  }
  async linkDestination():Promise<void> {await this.tempStat();await this.scope.native(() => link(this.row.tempPath,this.row.destination),'final_link_ack');}
  async confirmDestination():Promise<void> {
    await this.verifyParent();const stat=await this.scope.native(() => lstat(this.row.destination,{bigint:true}));const value=fileStat(stat);
    if (identity(stat) !== this.tempIdentity || value.size !== this.row.totalBytes) throw new TransferIOFailure('VERIFY_MISMATCH');
  }
  async removeTemp():Promise<void> {await this.tempStat();await this.scope.native(() => unlink(this.row.tempPath),'temp_remove_ack');}
  async shutdown():Promise<void> {
    // Scope.shutdown has already waited for late native acquisitions/writes.
    const outcomes=await Promise.allSettled([...this.handles].map(handle => handle.close()));this.handles.clear();this.writeHandle=null;
    if (outcomes.some(result => result.status === 'rejected')) throw new TransferIOFailure('INTERNAL_ERROR');
  }
}
