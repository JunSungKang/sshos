const {readFile,writeFile,realpath}=require('node:fs/promises');
const {resolve,relative,isAbsolute,sep,join}=require('node:path');
const {createHash}=require('node:crypto');
module.exports=async function(context){
 const root=await realpath(resolve(__dirname,'..')),output=await realpath(context.appOutDir),rel=relative(root,output);if(!rel || isAbsolute(rel) || rel==='..' || rel.startsWith(`..${sep}`))throw new Error('Package output outside workspace');
 const resources=context.packager.getResourcesDir(output),licenses=join(resources,'licenses'),manifest=JSON.parse(await readFile(join(licenses,'index.json'),'utf8'));
 // Use notices from the actual target Electron archive, never a host-target substitution.
 for(const [id,name]of [['electron','LICENSE.electron.txt'],['electron-third-party','LICENSES.chromium.html']]){
  const source=context.electronPlatformName==='darwin'?join(resources,name):join(output,name),bytes=await readFile(source),entry=manifest.entries.find(row=>row.id===id);if(!entry)throw new Error('Missing notice entry');await writeFile(join(licenses,entry.file),bytes);entry.bytes=bytes.length;entry.sha256=createHash('sha256').update(bytes).digest('hex');
 }
 await writeFile(join(licenses,'index.json'),JSON.stringify(manifest,null,2)+'\n');
 const sbom=JSON.parse(await readFile(join(licenses,'sbom.cdx.json'),'utf8'));sbom.metadata.properties=[{name:'sshos:electronPlatform',value:context.electronPlatformName},{name:'sshos:targetArch',value:context.arch===3?'arm64':context.arch===1?'x64':String(context.arch)}];await writeFile(join(licenses,'sbom.cdx.json'),JSON.stringify(sbom,null,2)+'\n');
};
