import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import { dialog,type BrowserWindow } from 'electron';
import type { DiagnosticPreview } from '../shared/diagnostics';
import { DiagnosticLog } from './diagnostic-log';
import { NativeDialogGate } from './native-dialogs';
const metadataSchema=z.object({appVersion:z.string().max(32),electron:z.string().max(32),node:z.string().max(32),chrome:z.string().max(32),platform:z.enum(['darwin','win32','linux']),architecture:z.enum(['arm64','x64']),engine:z.enum(['starting','ready','stopped']),connectedServers:z.int().min(0).max(3),activeTasks:z.int().nonnegative().max(10000)}).strict();
export class DiagnosticsController {
 private generation=0;private readonly previews=new Map<string,{bytes:Buffer;deadline:number}>();
 constructor(private readonly log:DiagnosticLog|null,private readonly metadata:()=>z.infer<typeof metadataSchema>,private readonly window:()=>BrowserWindow|null,private readonly gate:NativeDialogGate) {}
 invalidate():void {this.generation++;for(const row of this.previews.values())row.bytes.fill(0);this.previews.clear();}
 private prune():void {for(const [id,row] of this.previews)if(row.deadline<=performance.now()){row.bytes.fill(0);this.previews.delete(id);}}
 async preview():Promise<DiagnosticPreview> {this.prune();if(this.previews.size>=4)throw new Error('REQUEST_BUSY');const generation=this.generation;let logs:Awaited<ReturnType<DiagnosticLog['recent']>>=[],logsAvailable=Boolean(this.log && !this.log.unavailable);try{logs=await this.log?.recent() ?? [];}catch{logsAvailable=false;}if(generation!==this.generation)throw new Error('TOKEN_EXPIRED');const json=JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),...metadataSchema.parse(this.metadata()),logsAvailable,logs},null,2);if(Buffer.byteLength(json)>60*1024)throw new Error('INTERNAL_ERROR');if(this.previews.size>=4)throw new Error('REQUEST_BUSY');const token=randomUUID();this.previews.set(token,{bytes:Buffer.from(json+'\n'),deadline:performance.now()+60000});return {token,json:json+'\n',expiresAt:new Date(Date.now()+60000).toISOString()};}
 release(token:string):void {z.uuid().parse(token);const row=this.previews.get(token);row?.bytes.fill(0);this.previews.delete(token);}
 async export(token:string):Promise<{saved:boolean}> {
  z.uuid().parse(token);this.prune();const row=this.previews.get(token),owner=this.window(),generation=this.generation;if(!row)throw new Error('TOKEN_EXPIRED');if(!owner || owner.isDestroyed())throw new Error('IPC_DENIED');this.previews.delete(token);
  try{return await this.gate.run(owner.webContents.id,async()=>{const choice=await dialog.showSaveDialog(owner,{title:'개인정보를 제외한 진단 저장',defaultPath:'sshos-diagnostics.json',filters:[{name:'JSON',extensions:['json']}],properties:['showOverwriteConfirmation']});if(choice.canceled || !choice.filePath)return {saved:false};if(generation!==this.generation || this.window()!==owner || owner.isDestroyed() || performance.now()>=row.deadline)throw new Error('TOKEN_EXPIRED');const file=await open(choice.filePath,'wx',0o600);try{await file.writeFile(row.bytes);await file.sync();}finally{await file.close();}return {saved:true};});}finally{row.bytes.fill(0);}
 }
}
