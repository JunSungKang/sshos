import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { basename,join,posix } from 'node:path';
import { z } from 'zod';
import { validName } from '../shared/files';
import { transferStatSchema,type TransferStat } from '../shared/transfers';
import { stagedTransferSchema,type StagedTransfer } from '../shared/transfer-protocol';
import type { TransferPreviewPage,TransferPreviewRow } from '../shared/transfer-preview';
import { inspectLocalDirectory,localDownloadName,type LocalDirectory } from '../worker/transfers/local';
import type { TransferSelections } from './transfer-selections';
import type { FileController } from './files';
import type { ConnectionController } from './connections';
import type { EngineGateway } from './engine-gateway';
type Source=NonNullable<ReturnType<TransferSelections['file']>['source']>;
type Candidate={index:number;taskId:string;name:string;sourceName:string;sourcePath:string;parent:string;fileToken:string|null;nativeSource:Source|null;stat:TransferStat|null;status:TransferPreviewRow['status'];errorCode:string|null;desired:boolean;eligible:boolean};
type Preview={id:string;revision:number;direction:'upload'|'download';serverId:string;generation:number;sessionToken:string;epoch:string;identity:ReturnType<ConnectionController['sessionIdentity']>;originTokens:string[];folderToken:string|null;folder:LocalDirectory|null;folderName:string;rows:Candidate[];status:TransferPreviewPage['status'];errorCode:string|null;confirmation:string|null;deadline:number|null;expires:number};
export type ConfirmedTransfer={serverId:string;generation:number;sessionToken:string;epoch:string;specs:StagedTransfer[];selectionTokens:string[]};
const code=(error:unknown) => error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message) ? error.message : 'INTERNAL_ERROR';
const tokens=z.array(z.uuid()).min(1).max(100).refine(value => new Set(value).size === value.length);
export class TransferPreviews {
  private readonly previews=new Map<string,Preview>();
  private readonly confirmations=new Map<string,string>();
  constructor(private readonly files:FileController,private readonly connections:ConnectionController,private readonly gateway:EngineGateway,private readonly selections:TransferSelections,private readonly healthy:()=>void,private readonly downloadNameValid:(name:string)=>boolean=localDownloadName) {}
  invalidate():void {this.previews.clear();this.confirmations.clear();}
  private session(serverId:string,generation:number,sessionToken:string):void {
    const cap=this.connections.sessionCapability(sessionToken);if (cap.serverId !== serverId || cap.generation !== generation) throw new Error('TOKEN_EXPIRED');
    const row=this.connections.views().find(row => row.serverId === serverId && row.generation === generation);
    if (!row || row.sftp !== 'available') throw new Error('SFTP_UNAVAILABLE');if (row.os !== 'supported' && !(row.os === 'unknown' && row.osConfirmed)) throw new Error(row.os === 'unknown' ? 'OS_UNKNOWN' : 'OS_UNSUPPORTED');
  }
  private current(preview:Preview):void {
    if (this.previews.get(preview.id) !== preview || this.gateway.epoch !== preview.epoch || preview.expires<=performance.now()) throw new Error('TOKEN_EXPIRED');this.session(preview.serverId,preview.generation,preview.sessionToken);
    if (preview.direction === 'upload') this.files.resolveDirectory(preview.originTokens[0]!);else for (const token of preview.originTokens) this.files.resolveEntry(token);
    if (preview.folderToken) this.selections.directory(preview.folderToken);for (const row of preview.rows) if (row.fileToken) this.selections.file(row.fileToken);
  }
  private base(direction:Preview['direction'],browser:{serverId:string;generation:number;sessionToken:string}):Preview {
    this.healthy();this.session(browser.serverId,browser.generation,browser.sessionToken);for (const [id,value] of this.previews) if (value.expires<=performance.now() || value.deadline !== null && value.deadline<=performance.now()) this.release(id);if (this.previews.size>=6) throw new Error('REQUEST_BUSY');
    return {id:randomUUID(),revision:1,direction,serverId:browser.serverId,generation:browser.generation,sessionToken:browser.sessionToken,epoch:this.gateway.epoch,identity:this.connections.sessionIdentity(browser.serverId,browser.generation),originTokens:[],folderToken:null,folder:null,folderName:'',rows:[],status:'checking',errorCode:null,confirmation:null,deadline:null,expires:performance.now()+120000};
  }
  upload(payload:unknown):{previewId:string} {
    const input=z.object({fileTokens:tokens,directoryToken:z.uuid()}).strict().parse(payload);const directory=this.files.resolveDirectory(input.directoryToken);const preview=this.base('upload',directory.browser);preview.originTokens=[input.directoryToken];
    preview.rows=input.fileTokens.map((token,index) => {const selected=this.selections.file(token);preview.expires=Math.min(preview.expires,selected.deadline);const source=selected.source;return {index,taskId:randomUUID(),name:source ? basename(source.path) : selected.view.name,sourceName:selected.view.name,sourcePath:source?.path ?? '',parent:directory.path,fileToken:token,nativeSource:source,stat:source?.stat ?? null,status:source ? 'checking' : 'unsupported',errorCode:selected.view.errorCode,desired:source !== null,eligible:source !== null};});
    this.previews.set(preview.id,preview);void this.scan(preview);return {previewId:preview.id};
  }
  download(payload:unknown):{previewId:string} {
    const input=z.object({entryTokens:tokens,directoryToken:z.uuid()}).strict().parse(payload);const entries=input.entryTokens.map(token => this.files.resolveEntry(token)),first=entries[0]!;
    if (entries.some(row => row.browser.windowId !== first.browser.windowId || row.path !== first.path)) throw new Error('INPUT_INVALID');
    const selected=this.selections.directory(input.directoryToken);const preview=this.base('download',first.browser);preview.expires=Math.min(preview.expires,selected.deadline);preview.originTokens=input.entryTokens;preview.folderToken=input.directoryToken;preview.folder=selected.directory;preview.folderName=selected.view.name;
    preview.rows=entries.map((entry,index) => ({index,taskId:randomUUID(),name:entry.rawName,sourceName:entry.rawName,sourcePath:posix.join(entry.path,entry.rawName),parent:entry.path,fileToken:null,nativeSource:null,stat:null,status:entry.type === 'file' ? 'checking' : 'unsupported',errorCode:entry.type === 'file' ? null : 'PATH_UNSUPPORTED',desired:entry.type === 'file',eligible:entry.type === 'file'}));
    this.previews.set(preview.id,preview);void this.scan(preview);return {previewId:preview.id};
  }
  private destination(preview:Preview,row:Candidate):string {return preview.direction === 'upload' ? posix.join(row.parent,row.name) : join(preview.folder!.path,row.name);}
  private clearConfirmation(preview:Preview):void {if (preview.confirmation) this.confirmations.delete(preview.confirmation);preview.confirmation=null;preview.deadline=null;}
  private state(preview:Preview,row:Candidate):TransferPreviewRow['status'] {
    if (row.status !== 'valid') return row.status;
    if (row.desired && preview.rows.some(other => other !== row && other.desired && other.status === 'valid' && other.name === row.name)) return 'conflict';return 'valid';
  }
  private selected(preview:Preview):Candidate[] {return preview.rows.filter(row => row.desired && this.state(preview,row) === 'valid');}
  private spec(preview:Preview,row:Candidate):StagedTransfer {
    if (!row.stat) throw new Error('PATH_UNSUPPORTED');const directory=preview.direction === 'upload' ? row.nativeSource!.parent : preview.folder!;const now=new Date().toISOString();
    const spec=stagedTransferSchema.parse({localDirectory:directory,row:{kind:'file_transfer',taskId:row.taskId,serverId:preview.serverId,generation:preview.generation,backendEpoch:preview.epoch,direction:preview.direction,endpointSnapshot:preview.identity.endpointSnapshot,hostKeyFingerprint:preview.identity.hostKeyFingerprint,source:row.sourcePath,destination:this.destination(preview,row),tempPath:preview.direction === 'upload' ? posix.join(row.parent,`.sshos-${row.taskId}.part`) : join(directory.path,`.sshos-${row.taskId}.part`),remoteParent:row.parent,localParent:directory.path,sourceInitialStat:row.stat,totalBytes:row.stat.size,transferredBytes:0,verifiedBytes:0,streamSha256:null,phase:'queued',stage:'queued',cleanupState:'none',tempCreated:false,destinationCreated:false,dispatchAllowed:false,lastConfirmedPhase:'queued',errorCode:null,lateObservations:[],recoveryUncertain:false,recoveredFromPhase:null,acknowledgedAt:null,createdAt:now,updatedAt:now}});
    if (Buffer.byteLength(JSON.stringify(spec))>64000) throw new Error('PATH_UNSUPPORTED');return spec;
  }
  private async inspect(preview:Preview,row:Candidate):Promise<void> {
    if (!row.eligible) return;
    this.current(preview);row.status='checking';row.errorCode=null;
    try {
      if (!(preview.direction === 'upload' ? validName(row.name) : this.downloadNameValid(row.name))) throw new Error('PATH_UNSUPPORTED');
      const stat=transferStatSchema.nullable().parse(await this.gateway.request({action:'transfer:inspect',serverId:preview.serverId,generation:preview.generation,direction:preview.direction,path:preview.direction === 'upload' ? this.destination(preview,row) : row.sourcePath,parent:row.parent}));this.current(preview);
      if (preview.direction === 'upload') {if (stat !== null) throw new Error('INPUT_INVALID');}
      else {
        if (!stat) throw new Error('PATH_UNSUPPORTED');row.stat=stat;const directory=await inspectLocalDirectory(preview.folder!.path);this.current(preview);if (directory.path !== preview.folder!.path || directory.identity !== preview.folder!.identity) throw new Error('PATH_UNSUPPORTED');
        try {await lstat(this.destination(preview,row));throw new Error('NAME_CONFLICT');} catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
      }
      this.spec(preview,row);row.status='valid';
    } catch (error) {row.errorCode=code(error);row.status=row.errorCode === 'NAME_CONFLICT' ? 'conflict' : 'unsupported';}
    preview.revision++;
  }
  private mint(preview:Preview):void {
    this.current(preview);this.clearConfirmation(preview);const selected=this.selected(preview);if (!selected.length) return;
    let deadline=performance.now()+60000;if (preview.folderToken) deadline=Math.min(deadline,this.selections.directory(preview.folderToken).deadline);
    for (const row of selected) if (row.fileToken) deadline=Math.min(deadline,this.selections.file(row.fileToken).deadline);if (deadline<=performance.now()) throw new Error('TOKEN_EXPIRED');
    preview.confirmation=randomUUID();preview.deadline=deadline;this.confirmations.set(preview.confirmation,preview.id);
  }
  private async scan(preview:Preview):Promise<void> {
    try {for (const row of preview.rows) {this.current(preview);await this.inspect(preview,row);}this.current(preview);preview.status='ready';preview.revision++;this.mint(preview);}
    catch (error) {if (this.previews.get(preview.id) !== preview) return;preview.status='error';preview.errorCode=code(error);this.clearConfirmation(preview);}
  }
  get(id:string,offset:number):TransferPreviewPage {
    const preview=this.previews.get(id);if (!preview || !Number.isSafeInteger(offset) || offset<0 || offset>preview.rows.length) throw new Error('TOKEN_EXPIRED');
    try {this.current(preview);if (preview.deadline !== null && preview.deadline<=performance.now()) throw new Error('TOKEN_EXPIRED');} catch (error) {preview.status='error';preview.errorCode=code(error);this.clearConfirmation(preview);}
    const rows:TransferPreviewRow[]=[];let bytes=0;
    for (const row of preview.rows.slice(offset,offset+100)) {
      const status=this.state(preview,row),view:TransferPreviewRow={index:row.index,name:row.name,sourceLabel:preview.direction === 'upload' ? `로컬 · ${row.sourceName}` : row.sourcePath,destinationLabel:preview.direction === 'upload' ? this.destination(preview,row) : `로컬 ${preview.folderName} · ${row.name}`,size:row.stat?.size ?? null,status,selected:row.desired,errorCode:status === 'conflict' ? 'NAME_CONFLICT' : row.errorCode};const size=Buffer.byteLength(JSON.stringify(view));if (bytes+size>60000) break;rows.push(view);bytes+=size;
    }
    return {previewId:id,revision:preview.revision,direction:preview.direction,status:preview.status,serverName:preview.identity.endpointSnapshot.name,endpoint:`${preview.identity.endpointSnapshot.username}@${preview.identity.endpointSnapshot.endpoint}`,hostKeyFingerprint:preview.identity.hostKeyFingerprint,rows,total:preview.rows.length,nextOffset:offset+rows.length<preview.rows.length ? offset+rows.length : null,selectedCount:this.selected(preview).length,confirmationToken:preview.confirmation,expiresAt:preview.deadline === null ? null : new Date(Date.now()+Math.max(0,preview.deadline-performance.now())).toISOString(),errorCode:preview.errorCode};
  }
  async update(id:string,index:number,change:{name?:string;selected?:boolean}):Promise<void> {
    const input=z.object({name:z.string().max(1024).optional(),selected:z.boolean().optional()}).strict().refine(value => value.name !== undefined || value.selected !== undefined).parse(change);
    const preview=this.previews.get(id);if (!preview || preview.status !== 'ready') throw new Error('REQUEST_BUSY');this.current(preview);const row=preview.rows[index];if (!row || row.index !== index) throw new Error('INPUT_INVALID');this.clearConfirmation(preview);preview.revision++;
    if (input.name !== undefined) {row.name=input.name;preview.status='checking';await this.inspect(preview,row);preview.status='ready';}
    if (input.selected !== undefined) {if (input.selected && !row.eligible) throw new Error('PATH_UNSUPPORTED');row.desired=input.selected;}
    this.mint(preview);
  }
  consume(token:string):ConfirmedTransfer {
    const id=this.confirmations.get(token);const preview=id ? this.previews.get(id) : null;
    if (!preview || preview.confirmation !== token || preview.deadline === null || preview.deadline<=performance.now() || preview.status !== 'ready') throw new Error('TOKEN_EXPIRED');this.healthy();this.current(preview);
    const selected=this.selected(preview);if (!selected.length) throw new Error('INPUT_INVALID');const specs=selected.map(row => this.spec(preview,row));this.confirmations.delete(token);this.previews.delete(preview.id);
    return {serverId:preview.serverId,generation:preview.generation,sessionToken:preview.sessionToken,epoch:preview.epoch,specs,selectionTokens:[...preview.rows.flatMap(row => row.fileToken ? [row.fileToken] : []),...(preview.folderToken ? [preview.folderToken] : [])]};
  }
  release(id:string):void {const preview=this.previews.get(id);if (!preview) return;this.clearConfirmation(preview);this.previews.delete(id);}
}
