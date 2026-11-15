import { presentError } from '../shared/error-presentation';
export function ErrorPanel({error,phase=null,target=null,outcome}:{error:unknown;phase?:string|null;target?:string|null;outcome?:'unknown'|'partial_rename'}){
 const value=presentError(error,{confirmedPhase:phase,affectedTarget:target,...(outcome?{outcome}:{})});
 return <section role="alert" className="error-panel" aria-label="요청 오류"><strong>{value.userMessage}</strong><dl><dt>마지막 확인 단계</dt><dd>{value.confirmedPhase ?? '확인된 단계 없음'}</dd><dt>영향 대상</dt><dd>{value.affectedTarget ?? '대상 정보 없음'}</dd></dl><ul>{value.actions.map(action=><li key={action}>{action}</li>)}</ul><details><summary tabIndex={0}>기술 상세</summary><code>{value.technicalDetails.code}</code><p>원문 stack·SSH debug·인증정보를 포함하지 않습니다.</p></details></section>;
}
