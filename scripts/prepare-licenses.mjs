import { readFile, writeFile, copyFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { root,localPath } from './environment.mjs';
// These optional build accelerators are deliberately excluded from every package.
export const excludedRuntimePackages=new Set(['buildcheck','cpu-features','nan']);
export async function prepareLicenses(){
 const destination=localPath('build-resources/licenses'),lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8')),app=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 const entries=[];const components=[];
 const add=async(id,title,license,source)=>{const bytes=await readFile(source),file=`${id}.txt`;await writeFile(join(destination,file),bytes,{mode:0o644});entries.push({id,title,license,file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});};
 await add('project',`sshOS ${app.version}`,'AGPL-3.0-only',join(root,'LICENSE'));
 for(const [location,row]of Object.entries(lock.packages).sort(([a],[b])=>a.localeCompare(b))){
  if(!location || row.dev || row.devOptional)continue;
  const metadata=JSON.parse(await readFile(join(root,location,'package.json'),'utf8'));if(excludedRuntimePackages.has(metadata.name))continue;
  const license=metadata.license ?? metadata.licenses?.[0]?.type;
  if(!['MIT','BSD-3-Clause','Unlicense'].includes(license))throw new Error(`Unreviewed runtime license: ${metadata.name}`);
  const names=await readdir(join(root,location));const name=names.find(value=>/^(LICENSE|LICENCE|COPYING)(\.(txt|md))?$/iu.test(value));if(!name || !(await stat(join(root,location,name))).isFile())throw new Error(`Missing license: ${metadata.name}`);
  const id=`npm-${metadata.name.replace(/[^a-z0-9-]/gu,'-')}`;await add(id,`${metadata.name} ${row.version}`,license,join(root,location,name));
  components.push({type:'library',name:metadata.name,version:row.version,'bom-ref':`pkg:npm/${metadata.name.replace('@','%40')}@${row.version}`,purl:`pkg:npm/${metadata.name.replace('@','%40')}@${row.version}`,licenses:[{license:{id:license}}],properties:[{name:'sshos:lockIntegrity',value:row.integrity ?? ''}]});
 }
 const electron=JSON.parse(await readFile(join(root,'node_modules/electron/package.json'),'utf8'));
 await add('electron',`Electron ${electron.version}`,'MIT',join(root,'node_modules/electron/LICENSE'));
 await add('electron-third-party',`Electron ${electron.version} bundled third-party notices`,'LicenseRef-Electron-Third-Party',join(root,'node_modules/electron/dist/LICENSES.chromium.html'));
 components.push({type:'framework',name:'electron',version:electron.version,'bom-ref':`electron@${electron.version}`,licenses:[{license:{id:'MIT'}}],properties:[{name:'sshos:thirdPartyNotices',value:'electron-third-party.txt'}]});
 // Preserve upstream notice bytes, including HTML, but display them only as plain text.
 await writeFile(join(destination,'index.json'),JSON.stringify({schemaVersion:1,entries},null,2)+'\n');
 await writeFile(join(destination,'sbom.cdx.json'),JSON.stringify({bomFormat:'CycloneDX',specVersion:'1.6',version:1,metadata:{component:{type:'application',name:'sshOS',version:app.version,licenses:[{license:{id:'AGPL-3.0-only'}}]}},components},null,2)+'\n');
 return {destination,entries};
}
if(process.argv[1]===new URL(import.meta.url).pathname){const result=await prepareLicenses();console.log(`Prepared ${result.entries.length} local license documents.`);}
