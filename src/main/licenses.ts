import { readFile,open,lstat,realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { licenseEntrySchema,type LicenseEntry,type LicensePage } from '../shared/licenses';
const manifestSchema=z.object({schemaVersion:z.literal(1),entries:z.array(licenseEntrySchema.extend({file:z.string().regex(/^[a-z0-9-]+\.txt$/u)})).min(2).max(1000)}).strict();
/** Fixed packaged documents only. No renderer-controlled filesystem path or HTML. */
export class LicensesController {
 private manifest:Promise<z.infer<typeof manifestSchema>>|undefined;
 constructor(private readonly directory:string){}
 private async index(){this.manifest??=(async()=>{const path=resolve(this.directory,'index.json');if(!(await lstat(path)).isFile() || (await lstat(path)).size>1024*1024)throw new Error('INTERNAL_ERROR');const parsed=manifestSchema.parse(JSON.parse(await readFile(path,'utf8')));if(new Set(parsed.entries.map(row=>row.id)).size!==parsed.entries.length)throw new Error('INTERNAL_ERROR');return parsed;})();try{return await this.manifest;}catch{this.manifest=undefined;throw new Error('INTERNAL_ERROR');}}
 async list():Promise<LicenseEntry[]>{return(await this.index()).entries.map(({file:_file,...entry})=>entry);}
 async page(raw:unknown):Promise<LicensePage>{const input=z.object({id:z.string().max(100),offset:z.number().int().min(0).max(16*1024*1024)}).strict().parse(raw),entry=(await this.index()).entries.find(row=>row.id===input.id);if(!entry || input.offset>=entry.bytes)throw new Error('INPUT_INVALID');const path=resolve(this.directory,entry.file);if(await realpath(path)!==path)throw new Error('INTERNAL_ERROR');const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await handle.stat();if(!info.isFile() || info.size!==entry.bytes)throw new Error('INTERNAL_ERROR');const bytes=await handle.readFile();if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('INTERNAL_ERROR');let end=Math.min(input.offset+32768,bytes.length);if(end<bytes.length)while(end>input.offset && (bytes[end]!&0xc0)===0x80)end--;if(input.offset>0 && (bytes[input.offset]!&0xc0)===0x80)throw new Error('INPUT_INVALID');return {id:entry.id,offset:input.offset,nextOffset:end<bytes.length?end:null,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(input.offset,end))};}finally{await handle.close();}}
}
