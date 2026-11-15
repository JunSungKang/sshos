import { createRequire } from 'node:module';
import { readFile,writeFile,realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join,dirname,relative,isAbsolute,sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root,localPath,runtimeEnvironment } from './environment.mjs';
Object.assign(process.env,runtimeEnvironment('packaging'));
for(const key of ['ELECTRON_BUILDER_NSIS_DIR','ELECTRON_BUILDER_NSIS_RESOURCES_DIR'])delete process.env[key];
const require=createRequire(import.meta.url),{getMakeNsisPath,getNsisPluginsPath}=require('app-builder-lib/out/toolsets/windows.js');
const manifest=JSON.parse(await readFile(join(root,'docs/developer/architecture/third-party/windows-launcher-manifest.json'),'utf8'));
const compiler=await getMakeNsisPath('1.2.1'),plugins=await getNsisPluginsPath('1.2.1');
for(const path of [compiler.path,plugins]){const actual=await realpath(path),rel=relative(root,actual);if(!rel || isAbsolute(rel) || rel==='..' || rel.startsWith(`..${sep}`))throw new Error('Windows toolset outside workspace');}
const version=spawnSync(compiler.path,['-VERSION'],{cwd:root,env:process.env,encoding:'utf8',shell:process.platform==='win32'});
if(version.status!==0 || !['v3.12','v23-May-2026.cvs'].includes(version.stdout.trim()))throw new Error('Unexpected NSIS compiler version');
const dll=await readFile(join(plugins,'x86-unicode/StdUtils.dll')),dllSHA256=createHash('sha256').update(dll).digest('hex');if(dllSHA256!==manifest.stdutils.dllSHA256)throw new Error('StdUtils DLL differs from reviewed original release');
for(const [name,hash]of Object.entries(manifest.files)){const bytes=await readFile(join(root,'docs/developer/architecture/third-party',name));if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Windows license/source checksum mismatch');}
const compilerLicense=await readFile(join(dirname(compiler.path),'LICENSE'));if(createHash('sha256').update(compilerLicense).digest('hex')!==manifest.files['NSIS-3.12-LICENSE.txt'])throw new Error('NSIS license differs from reviewed toolset');
const report={nsis:'3.12',compilerVersion:version.stdout.trim(),toolset:'1.2.1',toolsetSHA256:manifest.nsis.toolsetSHA256,stdutils:'1.14',stdutilsDllSHA256:dllSHA256,sourceArchive:manifest.stdutils.correspondingSource,sourceArchiveSHA256:manifest.files[manifest.stdutils.correspondingSource],compression:'NSIS built-in zlib with direct app files; no Nsis7z/nsisunz plugin',scope:'Build input verification, not a Windows native launch claim'};
await writeFile(join(localPath('build-resources'),'windows-tools.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
