import { describe,expect,it } from 'vitest';
import { executionCommand,executionSpecSchema,executionReceiptSchema,recoverExecution } from '../../src/shared/executions';
import { ExecutionSlots } from '../../src/worker/execution/slots';
import { spawn } from 'node:child_process';
import { mkdir,mkdtemp,writeFile,rm,access } from 'node:fs/promises';
import { resolve,join } from 'node:path';
const run=(command:string)=>new Promise<string>((done,reject)=>{const child=spawn('/bin/sh',['-c',command],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',bytes=>{output+=bytes.toString();});child.on('error',reject);child.on('exit',code=>code===0 ? done(output):reject(new Error('fixture exit '+code)));});
describe('GUI execution command boundary and shared slots',()=>{
 it('preserves metacharacters, empty arguments and Unicode as distinct argv in a real POSIX shell',async()=>{
   await mkdir(resolve('.local/tmp'),{recursive:true});const root=await mkdtemp(resolve('.local/tmp/exec-quote-'));
   try {const path=join(root,"runner ' ; $ ` 한글.sh"),marker=join(root,'injected');await writeFile(path,"printf '%s\\000' \"$@\"\n");const args=['','one two',"a'b",'; touch '+marker,'$(touch '+marker+')','`touch '+marker+'`','한글','--flag','a\\b'];const spec={path,cwd:root,mode:'sh' as const,argv:args};const output=await run(executionCommand(spec));expect(output.split('\0').slice(0,-1)).toEqual(args);await expect(access(marker)).rejects.toThrow();expect(executionCommand({...spec,mode:'direct'})).not.toContain("exec '/bin/sh'");}
   finally{await rm(root,{recursive:true});}
 });
 it('enforces byte/count/control limits without splitting shell input',()=>{
   const base={path:'/home/file',cwd:'/home',mode:'direct',argv:[]};for(const argv of [Array(65).fill('x'),['a\nb'],['a\0b'],['\u0085'],['\ud800'],['가'.repeat(1366)],Array(5).fill('x'.repeat(4096))])expect(executionSpecSchema.safeParse({...base,argv}).success).toBe(false);expect(executionSpecSchema.safeParse({...base,argv:['a;b','']}).success).toBe(true);expect(executionSpecSchema.safeParse({...base,command:'echo x'}).success).toBe(false);
 });
 it('keeps timed-out/closing slots reserved until actual channel/socket close',()=>{
   const pool=new ExecutionSlots();for(let i=0;i<4;i++)pool.reserve('a'+i,'server-a',1);expect(()=>pool.reserve('extra','server-a',1)).toThrow('SESSION_LIMIT');pool.reserve('b','server-b',1);pool.reserve('c','server-c',1);expect(()=>pool.reserve('d','server-d',1)).toThrow('SESSION_LIMIT');expect(()=>pool.require('a0','server-a',2)).toThrow('TOKEN_EXPIRED');pool.closed('a0');pool.reserve('new','server-a',2);expect(pool.count()).toBe(6);
 });
 it('rejects secret/output/argv fields and never infers successful remote termination after recovery',()=>{
   const id=crypto.randomUUID(),now=new Date().toISOString();const record={kind:'gui_exec' as const,taskId:id,executionId:id,terminalId:null,serverId:crypto.randomUUID(),generation:1,backendEpoch:crypto.randomUUID(),endpointSnapshot:{name:'fixture',host:'example.invalid',port:22,username:'fixture',endpoint:'example.invalid:22'},hostKeyFingerprint:'SHA256:fixture',source:'/home/file',cwd:'/home',destination:null,phase:'running' as const,lastConfirmedPhase:'channel_accepted',channelAccepted:true,channelClosed:false,exitObserved:false,exitCode:null,exitSignal:null,stopRequestedAt:null,errorCode:null,recoveryUncertain:false,recoveredFromPhase:null,acknowledgedAt:null,createdAt:now,updatedAt:now};
   expect(executionReceiptSchema.safeParse(record).success).toBe(true);for(const field of ['argv','stdin','stdout','stderr','commandHash','password'])expect(executionReceiptSchema.safeParse({...record,[field]:'sensitive'}).success).toBe(false);expect(recoverExecution(record,false)).toMatchObject({phase:'result_unknown',exitObserved:false});expect(recoverExecution({...record,phase:'prepared'},false).phase).toBe('cancelled_not_sent');expect(executionReceiptSchema.safeParse({...record,phase:'exited'}).success).toBe(false);expect(recoverExecution({...record,phase:'exited',exitObserved:true,exitCode:0,channelClosed:true},true)).toMatchObject({phase:'result_unknown',exitCode:0,recoveryUncertain:true});
 });
});
