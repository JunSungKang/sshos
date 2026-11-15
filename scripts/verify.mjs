import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir,readFile,readdir,writeFile,rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { root,localPath,runtimeEnvironment } from './environment.mjs';
const group=process.argv[2];
const suites={integration:['session-smoke','file-smoke','viewer-smoke','transfer-engine-smoke','transfer-gui-smoke','execution-engine-smoke','execution-gui-smoke','terminal-engine-smoke','terminal-gui-smoke','execution-recovery-smoke','lifecycle-gui-smoke','shutdown-gui-smoke','power-gui-smoke','probe-gui-smoke','memory-gui-smoke','settings-gui-smoke','desktop-ui-smoke'],security:['electron-smoke']};
if(!Object.hasOwn(suites,group))throw new Error('Unknown verification group');
const destination=localPath(`verification/${group}-${Date.now()}`);await mkdir(destination,{recursive:true});const env=runtimeEnvironment(`verify-${group}`),results=[];
async function hashTree(dir){const result={};for(const entry of await readdir(join(root,dir),{withFileTypes:true})){const name=`${dir}/${entry.name}`;if(entry.isDirectory())Object.assign(result,await hashTree(name));else if(entry.isFile())result[name]=createHash('sha256').update(await readFile(join(root,name))).digest('hex');}return result;}
const sourceHashes={...await hashTree('src'),...await hashTree('tests'),...await hashTree('scripts')};
for(const suite of suites[group]){console.log(`Starting ${suite}`);const start=performance.now(),chunks=[];const exit=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,`scripts/${suite}.mjs`)],{cwd:root,env,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{chunks.push(data);process.stdout.write(data);});child.on('error',reject);child.on('exit',resolve);});await writeFile(join(destination,`${suite}.txt`),Buffer.concat(chunks));results.push({suite,status:exit===0?'pass':'fail',exitCode:exit,durationMs:performance.now()-start});if(exit!==0){process.exitCode=1;break;}}
const currentHashes={...await hashTree('src'),...await hashTree('tests'),...await hashTree('scripts')},unchanged=JSON.stringify(sourceHashes)===JSON.stringify(currentHashes);if(!unchanged)process.exitCode=1;
await writeFile(join(destination,'report.json'),JSON.stringify({group,status:process.exitCode?'fail':'pass',results,sourceUnchanged:unchanged,sourceHashes,platform:process.platform,architecture:process.arch,limitation:'Current-host loopback development suite. No supported-native-target, real OpenSSH, signing or specified network/performance acceptance claim.'},null,2)+'\n');console.log(`Report: ${destination}`);await rmdir(env.SSHOS_RUNTIME_ROOT).catch(()=>{});
