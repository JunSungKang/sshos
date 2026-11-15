import { constants } from 'node:fs';
import { mkdir,open,realpath,rename,unlink } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { z } from 'zod';
import { errorMessages } from '../shared/errors';
const phases=['starting','ready','stopped','connecting','authenticating','awaiting_host_trust','connected','disconnecting','disconnected','failed','idle','prepared','dispatching','running','rejected','exited','result_unknown','cancelled_not_sent','stop_requested','stop_unconfirmed','queued','preparing','skipped','created','transferring','verifying','finalize_intent_pending','finalizing','cancel_requested','cancelled','completed','interrupted','partial_rename','dispatched','intent','pending','first_done','source_removed'] as const;
export const logEntrySchema=z.object({time:z.iso.datetime(),appVersion:z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u).max(32),taskId:z.uuid().optional(),errorCode:z.enum(Object.keys(errorMessages) as [string,...string[]]).optional(),from:z.enum(phases).optional(),to:z.enum(phases).optional()}).strict();
export type LogEntry=z.infer<typeof logEntrySchema>;
const LIMIT=1024**2;
/** No generic message, error stack, arbitrary metadata or SSH debug argument. */
export class DiagnosticLog {
 private tail:Promise<void>=Promise.resolve();private pending=0;private failed=false;private readonly lastStates=new Map<string,string>();
 private constructor(private readonly directory:string,private readonly version:string) {}
 static async create(directory:string,version:string):Promise<DiagnosticLog> {await mkdir(directory,{recursive:true,mode:0o700});if(await realpath(directory)!==resolve(directory))throw new Error('STORAGE_FAILED');logEntrySchema.parse({time:new Date().toISOString(),appVersion:version});return new DiagnosticLog(directory,version);}
 record(input:Omit<LogEntry,'time'|'appVersion'>):void {const parsed=logEntrySchema.safeParse({...input,time:new Date().toISOString(),appVersion:this.version});if(!parsed.success || this.pending>=128)return;const key=parsed.data.taskId ?? 'connection',signature=JSON.stringify(input);if(this.lastStates.get(key)===signature)return;this.lastStates.delete(key);this.lastStates.set(key,signature);if(this.lastStates.size>1000)this.lastStates.delete(this.lastStates.keys().next().value!);const bytes=Buffer.from(JSON.stringify(parsed.data)+'\n');this.pending++;this.tail=this.tail.then(()=>this.append(bytes)).catch(()=>{this.failed=true;}).finally(()=>{bytes.fill(0);this.pending--;});}
 get unavailable():boolean {return this.failed;}
 async settled():Promise<void> {await this.tail;}
 private path(index:number):string {return join(this.directory,`events${index ? '.'+index:''}.jsonl`);}
 private async read(index:number):Promise<Buffer> {let file;try{file=await open(this.path(index),constants.O_RDONLY|(constants.O_NOFOLLOW ?? 0));const stat=await file.stat();if(!stat.isFile() || stat.size>LIMIT)throw new Error('STORAGE_FAILED');const bytes=Buffer.alloc(LIMIT+1);let at=0;while(at<bytes.length){const read=await file.read(bytes,at,Math.min(32768,bytes.length-at),at);if(!read.bytesRead)break;at+=read.bytesRead;}if(at>LIMIT)throw new Error('STORAGE_FAILED');return bytes.subarray(0,at);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return Buffer.alloc(0);throw error;}finally{await file?.close();}}
 private async append(bytes:Buffer):Promise<void> {
  let file=await open(this.path(0),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|(constants.O_NOFOLLOW ?? 0),0o600);
  try{const stat=await file.stat();if(!stat.isFile() || stat.size>LIMIT)throw new Error('STORAGE_FAILED');if(stat.size+bytes.length>LIMIT){await file.close();await unlink(this.path(2)).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});for(const index of [1,0])await rename(this.path(index),this.path(index+1)).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});file=await open(this.path(0),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW ?? 0),0o600);}await file.writeFile(bytes);}
  finally {await file.close();}
 }
 async recent():Promise<LogEntry[]> {await this.tail;const rows:LogEntry[]=[];for(const index of [2,1,0]){const bytes=await this.read(index);try{for(const line of bytes.toString('utf8').split('\n')){if(!line || Buffer.byteLength(line)>512)continue;try{const parsed=logEntrySchema.safeParse(JSON.parse(line));if(parsed.success){rows.push(parsed.data);if(rows.length>100)rows.shift();}}catch{}}}finally{bytes.fill(0);}}return rows;}
}
