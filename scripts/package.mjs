import { readFile,writeFile,stat,readdir } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join,relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentFuseWire,FuseV1Options,FuseState } from '@electron/fuses';
import { listPackage,extractFile } from '@electron/asar';
import { root,runtimeEnvironment,localPath } from './environment.mjs';
import { inspectPackage } from './inspect-package.mjs';
import { prepareLicenses } from './prepare-licenses.mjs';
import { checkPackagedSSH } from './package-ssh-smoke.mjs';
const target=process.argv[2];if(!['win','mac'].includes(target) || process.argv.length!==3)throw new Error('Use package:win or package:mac; this command makes development packages only.');
if(target==='mac' && process.platform!=='darwin')throw new Error('macOS packaging requires a macOS build host.');
const git=(args)=>{const run=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(run.status!==0)throw new Error('Source revision unavailable');return run.stdout.trim();};
const revision=git(['rev-parse','HEAD']);if(git(['status','--porcelain']).length)throw new Error('Commit tracked source and remove untracked task artifacts before packaging. Ignored build/cache directories are allowed.');
const packageData=JSON.parse(await readFile(join(root,'package.json'),'utf8')),lock=await readFile(join(root,'package-lock.json'));
const output=localPath(`packages/${revision.slice(0,12)}-${target}-${randomUUID()}`),resources=localPath('build-resources');
const env={...runtimeEnvironment('packaging'),npm_config_devdir:localPath('node-gyp'),npm_config_update_notifier:'false',CSC_IDENTITY_AUTO_DISCOVERY:'false',SSHOS_PRODUCTION_BUILD:'1',WINEPREFIX:localPath('wine')};
for(const key of ['CSC_LINK','CSC_KEY_PASSWORD','CSC_NAME','WIN_CSC_LINK','WIN_CSC_KEY_PASSWORD','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_API_KEY','APPLE_API_KEY_ID','APPLE_API_ISSUER','ELECTRON_BUILDER_NSIS_DIR','ELECTRON_BUILDER_NSIS_RESOURCES_DIR'])delete env[key];
const run=(args)=>{const child=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});if(child.status!==0)throw new Error(`Build step failed (${child.status ?? 'signal'})`);};
if(target==='win')run([join(root,'scripts/windows-toolset.mjs')]);
await prepareLicenses();const windowsTools=target==='win'?JSON.parse(await readFile(join(resources,'windows-tools.json'),'utf8')):null;const buildInfo={schemaVersion:1,version:packageData.version,sourceRevision:revision,sourceDirty:false,packageLockSHA256:createHash('sha256').update(lock).digest('hex'),node:process.versions.node,electron:packageData.devDependencies.electron,kind:'development',...(windowsTools?{windowsTools}:{}),publisherSigned:false,notarized:false,releaseReady:false,buildHost:{platform:process.platform,architecture:process.arch},reproductionCommands:['node scripts/install.mjs','npm run typecheck','npm run test:unit',`npm run package:${target}`],executedBuildSteps:['prepareLicenses','tsc -p tsconfig.json','vite build',`electron-builder ${target} development targets`],builtAt:new Date().toISOString()};
await writeFile(join(resources,'build-info.json'),JSON.stringify(buildInfo,null,2)+'\n');
run([join(root,'node_modules/typescript/bin/tsc'),'-p','tsconfig.json']);run([join(root,'node_modules/vite/bin/vite.js'),'build']);
run([join(root,'node_modules/electron-builder/cli.js'),...(target==='win'?['--win','portable','--x64']:['--mac','zip','--arm64','--x64']),`--config.directories.output=${output}`,`--config.electronDownload.cache=${env.electron_config_cache}`,'--publish','never']);
const expected=new Map([[FuseV1Options.RunAsNode,FuseState.DISABLE],[FuseV1Options.EnableNodeOptionsEnvironmentVariable,FuseState.DISABLE],[FuseV1Options.EnableNodeCliInspectArguments,FuseState.DISABLE],[FuseV1Options.EnableEmbeddedAsarIntegrityValidation,FuseState.ENABLE],[FuseV1Options.OnlyLoadAppFromAsar,FuseState.ENABLE],[FuseV1Options.GrantFileProtocolExtraPrivileges,FuseState.DISABLE]]);
const packageChecks=[];
for(const [folder,arch]of target==='win'?[['win-unpacked','x64']]:[['mac-arm64','arm64'],['mac','x64']]){
 const directory=join(output,folder),application=target==='win'?join(directory,'sshOS.exe'):join(directory,'sshOS.app'),resourceRoot=target==='win'?join(directory,'resources'):join(application,'Contents/Resources'),archive=join(resourceRoot,'app.asar');const wire=await getCurrentFuseWire(application);for(const [key,value]of expected)if(wire[key]!==value)throw new Error(`Fuse mismatch: ${key}`);
 const entries=listPackage(archive);if(entries.some(name=>/\.(node|exe|dll|so|dylib)$|[/\\]tests?[/\\]|cpu-features|[/\\]nan[/\\]|buildcheck/u.test(name)))throw new Error('Production archive contains a native accelerator or test fixture');
 for(const path of ['node_modules/ssh2/lib/protocol/crypto.js','node_modules/ssh2/lib/protocol/crypto/poly1305.js'])if(!entries.includes('/'+path))throw new Error('Production archive is missing required SSH cryptography');
 const packaged=JSON.parse(extractFile(archive,'package.json').toString());if(packaged.version!==packageData.version)throw new Error('Packaged version mismatch');const notices=JSON.parse(await readFile(join(resourceRoot,'licenses/index.json'),'utf8'));for(const row of notices.entries){const bytes=await readFile(join(resourceRoot,'licenses',row.file));if(bytes.length!==row.bytes || createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw new Error('Packaged notice mismatch');}
 if(target==='win'){const source=await readFile(join(resourceRoot,'third-party-source',windowsTools.sourceArchive));if(createHash('sha256').update(source).digest('hex')!==windowsTools.sourceArchiveSHA256)throw new Error('Packaged corresponding source hash mismatch');}
 if(target==='mac'){const result=spawnSync('/usr/bin/codesign',['--verify','--deep','--strict',application],{cwd:root,env,encoding:'utf8'});if(result.status!==0)throw new Error(`Ad-hoc signature verification failed: ${result.stderr}`);}
 const integrity=await inspectPackage(target==='mac'?application:directory,target);
 const archivedSSH=await checkPackagedSSH(archive);
 packageChecks.push({...integrity,architecture:arch,archivedSSH,fuses:'pass',testFixturesAbsent:true,nativeAcceleratorsAbsent:true,noticesVerified:notices.entries.length,publisherSignature:target==='mac'?'ad-hoc only':'unsigned',nativeLaunch:'untested'});
}
const hashFile=async path=>{const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex');};
const artifacts=[];for(const name of await readdir(output)){if(!/\.(exe|zip)$/u.test(name))continue;const path=join(output,name),info=await stat(path);artifacts.push({name,bytes:info.size,sha256:await hashFile(path),compressedSizeWithin250MiB:info.size<=250*1024*1024});}
if(artifacts.some(row=>!row.compressedSizeWithin250MiB))throw new Error('Compressed artifact exceeds250MiB');
if(artifacts.length!==(target==='win'?1:2))throw new Error('Missing target artifacts');
if(git(['rev-parse','HEAD'])!==revision || git(['status','--porcelain']).length)throw new Error('Source changed during packaging; artifacts cannot be attributed to the captured revision');
const archivePath=join(output,`sshOS-${packageData.version}-${revision.slice(0,12)}-source.tar`),source=spawnSync('git',['archive','--format=tar',`--output=${archivePath}`,revision],{cwd:root,env,encoding:'utf8'});if(source.status!==0)throw new Error('Corresponding source archive failed');
await writeFile(join(output,'SHA256SUMS'),artifacts.map(row=>`${row.sha256}  ${row.name}`).join('\n')+`\n${await hashFile(archivePath)}  ${relative(output,archivePath)}\n`);
await writeFile(join(output,'build-report.json'),JSON.stringify({...buildInfo,artifacts,packageChecks,sourceArchive:{name:relative(output,archivePath),sha256:await hashFile(archivePath)},limitations:['Development artifacts only; no publisher certificate/notarization.','Cross-built files do not prove target OS launch, OpenSSH matrix, performance or accessibility.','Production inspector fuse is disabled; Playwright automation build is not distributed.']},null,2)+'\n');
console.log(`Development package evidence: ${relative(root,output)}/build-report.json`);
