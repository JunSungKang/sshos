import { displayName } from '../shared/files';
import { receiptUnresolved,type OperationReceipt } from '../shared/receipts';
export type ShutdownScope={serverId:string;generation:number}|null;
export const inShutdownScope=(row:OperationReceipt,scope:ShutdownScope):boolean=>!scope || row.serverId===scope.serverId && row.generation===scope.generation;
export function shutdownSummary(rows:OperationReceipt[],active:(id:string)=>boolean,scope:ShutdownScope):string {
 const selected=rows.filter(row=>inShutdownScope(row,scope)),live=selected.filter(row=>active(row.taskId)),counts={transfer:0,queued:0,mutation:0,exec:0,pty:0};for(const row of live){if(row.kind==='file_transfer'){if(row.phase==='queued')counts.queued++;else counts.transfer++;}else if(row.kind==='file_mutation')counts.mutation++;else if(row.kind==='gui_exec')counts.exec++;else counts.pty++;}
 const bounded=(value:string)=>Array.from(displayName(value)).slice(0,160).join('');const lines=live.slice(0,110).map(row=>`${row.kind==='file_transfer' ? row.direction:row.kind==='file_mutation' ? row.operation:row.kind==='pty' ? 'PTY':'실행'} · ${bounded(row.endpointSnapshot.name)} · ${bounded(row.source ?? row.destination ?? '대화형 셸')}`).map(line=>Array.from(line).slice(0,120).join(''));if(live.length>110)lines.push(`나머지 ${live.length-110}개는 전체 작업에서 확인하세요.`);return `전송 ${counts.transfer} · 대기 ${counts.queued} · 파일 변경 ${counts.mutation} · GUI 실행 ${counts.exec} · PTY ${counts.pty} · 미확인 ${selected.filter(receiptUnresolved).length}\n${lines.join('\n')}\n원격 프로세스 전체 종료는 보장하지 않습니다. 확인하지 못한 결과는 불명으로 보존합니다.`;
}
export type ShutdownPorts={interrupt():Promise<void>;finalizing():boolean;disconnect():Promise<void>;active():boolean;settled():Promise<void>};
/** One shared monotonic budget; a delayed cancellation cannot prevent socket-close dispatch. */
export async function runShutdown(ports:ShutdownPorts,budgetMs=10000):Promise<{timedOut:boolean}> {
 let expired=false,disconnecting:Promise<void>|null=null;const deadline=performance.now()+budgetMs;const disconnect=()=>disconnecting ??=Promise.resolve().then(()=>ports.disconnect()).catch(()=>{});let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<{timedOut:boolean}>(done=>{timer=setTimeout(()=>{expired=true;void disconnect();done({timedOut:true});},budgetMs);});
 const work=(async()=>{try{await ports.interrupt();}catch{}if(expired)return {timedOut:true};while(ports.finalizing() && performance.now()<deadline && !expired)await new Promise(done=>setTimeout(done,20));if(expired)return {timedOut:true};await disconnect();while(ports.active() && performance.now()<deadline && !expired)await new Promise(done=>setTimeout(done,20));if(expired)return {timedOut:true};await ports.settled();return {timedOut:false};})();
 try{return await Promise.race([work,timeout]);}finally{if(timer)clearTimeout(timer);}
}
