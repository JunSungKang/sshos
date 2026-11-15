const {readFile,writeFile,realpath,mkdir,copyFile}=require('node:fs/promises');
const {resolve,relative,isAbsolute,sep,join}=require('node:path');
const {createHash}=require('node:crypto');
module.exports=async function(context){
 const root=await realpath(resolve(__dirname,'..')),output=await realpath(context.appOutDir),rel=relative(root,output);if(!rel || isAbsolute(rel) || rel==='..' || rel.startsWith(`..${sep}`))throw new Error('Package output outside workspace');
 const resources=context.packager.getResourcesDir(output),licenses=join(resources,'licenses'),manifest=JSON.parse(await readFile(join(licenses,'index.json'),'utf8'));
 // Use notices from the actual target Electron archive, never a host-target substitution.
 for(const [id,name]of [['electron','LICENSE.electron.txt'],['electron-third-party','LICENSES.chromium.html']]){
  const source=context.electronPlatformName==='darwin'?join(resources,name):join(output,name),bytes=await readFile(source),entry=manifest.entries.find(row=>row.id===id);if(!entry)throw new Error('Missing notice entry');await writeFile(join(licenses,entry.file),bytes);entry.bytes=bytes.length;entry.sha256=createHash('sha256').update(bytes).digest('hex');
 }
 const additional=[];
 if(context.electronPlatformName==='win32'){
  const vendor=join(root,'docs/third-party'),review=JSON.parse(await readFile(join(vendor,'windows-launcher-manifest.json'),'utf8'));
  const notices=[['nsis','NSIS3.12','Zlib','NSIS-3.12-LICENSE.txt'],['stdutils','StdUtils1.14','LGPL-2.1-or-later','StdUtils-LGPL.txt'],['stdutils-clarification','StdUtils author clarification','LGPL-2.1-or-later','StdUtils-LGPL-clarification.txt'],['stdutils-readme','StdUtils copyright and source','LGPL-2.1-or-later','StdUtils-README.txt'],['stdutils-blake2','StdUtils bundled BLAKE2 notice','CC0-1.0','StdUtils-blake2-COPYING.txt'],['stdutils-rhash','StdUtils bundled RHash notice','MIT','StdUtils-rhash-COPYING.txt']];
  for(const [id,title,license,name]of notices){const bytes=await readFile(join(vendor,name)),sha256=createHash('sha256').update(bytes).digest('hex');if(sha256!==review.files[name])throw new Error('Windows notice mismatch');const file=id+'.txt';await writeFile(join(licenses,file),bytes);manifest.entries.push({id,title,license,file,bytes:bytes.length,sha256});}
  const sourceDirectory=join(resources,'third-party-source');await mkdir(sourceDirectory,{recursive:true});await copyFile(join(vendor,review.stdutils.correspondingSource),join(sourceDirectory,review.stdutils.correspondingSource));
  additional.push({type:'framework',name:'NSIS',version:'3.12','bom-ref':'nsis@3.12',licenses:[{license:{id:'Zlib'}}],properties:[{name:'sshos:toolset',value:'1.2.1'},{name:'sshos:compression',value:'zlib direct files; no Nsis7z/nsisunz plugin'}]},{type:'library',name:'StdUtils',version:'1.14','bom-ref':'stdutils@1.14',licenses:[{license:{id:'LGPL-2.1-or-later'}}],hashes:[{alg:'SHA-256',content:review.stdutils.dllSHA256}],properties:[{name:'sshos:fileVersion',value:'1.1.4.0'},{name:'sshos:clarification',value:'licenses/stdutils-clarification.txt'},{name:'sshos:correspondingSource',value:'third-party-source/'+review.stdutils.correspondingSource},{name:'sshos:sourceSHA256',value:review.files[review.stdutils.correspondingSource]}]});
 }
 await writeFile(join(licenses,'index.json'),JSON.stringify(manifest,null,2)+'\n');
 const sbom=JSON.parse(await readFile(join(licenses,'sbom.cdx.json'),'utf8'));sbom.components.push(...additional);sbom.metadata.properties=[{name:'sshos:electronPlatform',value:context.electronPlatformName},{name:'sshos:targetArch',value:context.arch===3?'arm64':context.arch===1?'x64':String(context.arch)}];await writeFile(join(licenses,'sbom.cdx.json'),JSON.stringify(sbom,null,2)+'\n');
};
