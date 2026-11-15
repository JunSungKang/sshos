import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Repository-local, human-owned metadata operation. No review, merge, ref,
// protection, credential or global configuration mutation is supported.
export function validateUpdate(plan,repository,pr,human,head,input){
  if(!input || Object.getPrototypeOf(input)!==Object.prototype || Object.keys(input).sort().join(',')!=='body,title' || typeof input.title!=='string' || !input.title.trim() || input.title.length>256 || /[\r\n\0]/u.test(input.title) || typeof input.body!=='string' || !input.body.trim() || Buffer.byteLength(input.body)>60000 || input.body.includes('\0'))throw new Error('Invalid PR metadata');
  if(!/^[a-f0-9]{40}$/u.test(head) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository))throw new Error('Invalid canonical repository/head');
  if(human!==plan.governance.prAuthorLogin || human!==plan.governance.pushActorLogin || pr.user?.login!==human || !pr.assignees?.some(row=>row.login===plan.governance.assigneeLogin))throw new Error('Human author/assignee mismatch');
  if(pr.state!=='open' || pr.head?.sha!==head || pr.head?.ref!==plan.branch || pr.head?.repo?.full_name!==repository || pr.base?.ref!==plan.targetBranch || pr.base?.repo?.full_name!==repository)throw new Error('PR repository/branch/head mismatch');
  return {title:input.title,body:input.body};
}

export async function updatePR({planPath,number,apply,input},dependencies){
  if(!Number.isSafeInteger(number) || number<1)throw new Error('Invalid PR number');
  const {plan,repository,head,human,readPR,verifyGuard,patch}=dependencies;
  await verifyGuard();
  const content=validateUpdate(plan,repository,await readPR(),human,head,input);
  if(!apply)return {dryRun:true,number,repository,head,title:content.title,bodyBytes:Buffer.byteLength(content.body)};
  // Recheck the guard and exact PR immediately before the narrow metadata write.
  await verifyGuard();validateUpdate(plan,repository,await readPR(),human,head,content);
  const changed=await patch(content);
  validateUpdate(plan,repository,changed,human,head,content);
  if(changed.title!==content.title || changed.body!==content.body)throw new Error('PR metadata verification failed');
  return {updated:true,number,repository,head,url:changed.html_url};
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [mode,planPath,rawNumber]=process.argv.slice(2);
  if(!['--dry-run','--apply'].includes(mode) || !planPath || !/^[1-9][0-9]*$/u.test(rawNumber??'') || process.argv.length!==5)throw new Error('Usage: update-pr.mjs <--dry-run|--apply> <plan> <PR> (JSON title/body on stdin)');
  const scripts=join(homedir(),'.codex/scripts'),{loadPlan}=await import(pathToFileURL(join(scripts,'github-app-contract.mjs')).href),{verifyServerGuard}=await import(pathToFileURL(join(scripts,'github-app-workflow-guard.mjs')).href),plan=loadPlan(planPath),verified=await verifyServerGuard(planPath);
  const gh=(args,input)=>JSON.parse(execFileSync('gh',args,{cwd:verified.repository.root,encoding:'utf8',input,stdio:['pipe','pipe','pipe']}));
  const repository=verified.repository.fullName,number=Number(rawNumber),head=execFileSync('git',['rev-parse','HEAD'],{cwd:verified.repository.root,encoding:'utf8'}).trim(),human=gh(['api','user']).login,endpoint=`repos/${repository}/pulls/${number}`;
  const result=await updatePR({planPath,number,apply:mode==='--apply',input:JSON.parse(readFileSync(0,'utf8'))},{plan,repository,head,human,verifyGuard:()=>verifyServerGuard(planPath),readPR:async()=>gh(['api',endpoint]),patch:async content=>gh(['api',endpoint,'--method','PATCH','--input','-'],JSON.stringify(content))});
  console.log(JSON.stringify(result,null,2));
}
