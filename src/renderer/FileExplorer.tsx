import { useEffect, useRef, useState } from 'react';
import type { DirectoryPage, EntryView } from '../shared/files';
import type { SessionView } from '../shared/session-contracts';
import { TransferDialog } from './TransferDialog';
import { MutationDialog } from './MutationDialog';
import { scheduleFilePage } from './file-page-scheduler';
import { imageSignature } from '../shared/viewers/image-header';
import { FileOpenChoice } from './FileOpenChoice';
import { scheduleViewerFrame } from './viewer-stream-scheduler';

const hiddenByServer = new Map<string, boolean>();
const explain = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const messages: Record<string,string> = { PATH_UNSUPPORTED: '링크 또는 특수파일 경로는 지원하지 않습니다.', PATH_CHANGED: '조회 중 경로가 변경됐습니다. 다시 열어 주세요.', SFTP_UNAVAILABLE: '이 연결에서 SFTP를 사용할 수 없습니다.', IO_TIMEOUT: '파일 조회 응답이 지연되어 연결을 종료했습니다.', TOKEN_EXPIRED: '조회 정보가 만료됐습니다. 파일 창을 다시 열어 주세요.', REQUEST_BUSY: '이 창의 조회가 진행 중입니다.', CONNECTION_LOST: 'SSH 연결이 끊겼습니다.', WINDOW_LIMIT: '열린 창 한도에 도달했습니다. 기존 창을 닫고 다시 여세요.', VIEW_LIMIT: '지원하는 읽기 크기 또는 읽기 요청 한도를 초과했습니다.' };
  return Object.entries(messages).find(([code]) => message.includes(code))?.[1] ?? '폴더를 읽지 못했습니다. 연결 상태와 경로 접근 권한을 확인하세요.';
};
type TreeRow = { path: string; name: string; token: string; parent: string | null };
export function FileExplorer({ windowId, session, generation, newWindow,openViewer,storageHealthy }: { storageHealthy:boolean;windowId: string; session?: SessionView; generation: number; newWindow():void;openViewer(entryToken:string,kind:'text'|'image'):Promise<void> }) {
  const [page, setPage] = useState<DirectoryPage | null>(null);
  const [rows, setRows] = useState<EntryView[]>([]);
  const [tree, setTree] = useState<TreeRow[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(hiddenByServer.get(`${session?.serverId}:${generation}`) ?? true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [selection,setSelection]=useState<string[]>([]);const selected=selection.length === 1 ? selection[0]! : null;const anchor=useRef<string|null>(null);
  const [transferId,setTransferId]=useState<string|null>(null),[picking,setPicking]=useState(false);const nativeBusy=useRef(false);
  const [mutation,setMutation]=useState<{operation:'mkdir'|'rename'|'delete';token:string;name:string}|null>(null);
  const [opening,setOpening]=useState(false);const openingRequest=useRef(0);const openingBusy=useRef(false);const probeToken=useRef<string|null>(null);
  const [choice,setChoice]=useState<{entryToken:string;name:string;path:string;server:string}|null>(null);
  const [treeScroll, setTreeScroll] = useState(0);
  const [scroll, setScroll] = useState(0); const [height, setHeight] = useState(300);
  const viewport = useRef<HTMLDivElement>(null); const request = useRef(0); const alive = useRef(true);
  const connected = session?.status === 'connected' && session.generation === generation;
  const writable=storageHealthy && connected && (session.os === 'supported' || session.os === 'unknown' && session.osConfirmed);
  const currentView=useRef({page,connected});currentView.current={page,connected};
  const selectedRow=rows.find(row => row.entryToken === selected);
  const observeMutation=async (id:string) => {
    const origin=page;setNotice('작업을 시작했습니다. 전체 작업에서 기록을 확인할 수 있습니다.');
    try {
      while (alive.current) { const result=await window.sshOS.task.inspect(id); if (!alive.current) return;
        if (['completed','failed','partial','result_unknown'].includes(result.phase)) {
          setNotice(result.phase === 'completed' ? '작업 완료' : result.phase === 'partial' || result.phase === 'result_unknown' ? '결과 확인 필요 · 전체 작업에서 확인하세요.' : '작업 실패 · 전체 작업에서 오류 코드를 확인하세요.');
          if (result.phase === 'completed' && currentView.current.connected && currentView.current.page?.path === origin?.path && origin) await load(() => window.sshOS.file.list(origin.directoryToken));
          return;
        }
        await new Promise(resolve => setTimeout(resolve,500));
      }
    } catch {if (alive.current) setNotice('전체 작업에서 처리 상태를 확인하세요.');}
  };
  const load = async (action: () => Promise<DirectoryPage>) => {
    const id = ++request.current; setBusy(true); setError(''); setNotice(''); setSelection([]);anchor.current=null;
    try {
      let result = await action(); if (!alive.current || request.current !== id) return;
      let collected = result.entries; setPage(result); setRows(collected); setScroll(0); if (viewport.current) viewport.current.scrollTop = 0;
      while (result.nextOffset !== null) {
        result = await scheduleFilePage(() => { if (!alive.current || request.current !== id) throw new Error('REQUEST_CANCELLED'); return window.sshOS.file.page(result.pageToken,result.nextOffset!); });
        if (!alive.current || request.current !== id) return;
        collected = collected.concat(result.entries); setRows(collected); setPage(result);
      }
      const parts = result.path.split('/').filter(Boolean);
      const parent = result.path === '/' ? null : '/' + parts.slice(0,-1).join('/');
      setTree(previous => {
        const entries = new Map(previous.map(row => [row.path,row]));
        entries.set(result.path, { path:result.path, name:parts.at(-1) ?? '/', token:result.directoryToken, parent });
        if (result.parentToken && parent !== null) entries.set(parent, { path:parent, name:parts.at(-2) ?? '/', token:result.parentToken, parent:parent === '/' ? null : '/' + parts.slice(0,-2).join('/') });
        for (const row of collected) if (row.directoryToken) { const path = (result.path === '/' ? '' : result.path) + '/' + row.name; entries.set(path, { path, name:row.name, token:row.directoryToken, parent:result.path }); }
        return [...entries.values()].slice(-20000);
      });
    } catch (failure) { if (alive.current && request.current === id) setError(explain(failure)); }
    finally { if (alive.current && request.current === id) setBusy(false); }
  };
  useEffect(() => { alive.current = true; void load(() => window.sshOS.file.open(windowId)); return () => { alive.current = false; request.current++;openingRequest.current++;if (probeToken.current) void window.sshOS.viewer.releaseProbe(probeToken.current).catch(() => {}); }; }, [windowId]);
  useEffect(() => { const element = viewport.current; if (!element) return; const observer = new ResizeObserver(() => setHeight(element.clientHeight)); observer.observe(element); return () => observer.disconnect(); }, []);
  const filtered = rows.filter(row => (showHidden || !row.name.startsWith('.')) && row.name.includes(filter));
  const first = Math.max(0, Math.floor(scroll/34)-8); const visible = filtered.slice(first, first+Math.ceil(height/34)+16);
  const select=(token:string|null,event:{ctrlKey:boolean;metaKey:boolean;shiftKey:boolean}) => {
    if (!token) return;
    let next:string[];
    if (event.shiftKey && anchor.current) {const a=filtered.findIndex(row => row.entryToken === anchor.current),b=filtered.findIndex(row => row.entryToken === token);next=a<0 || b<0 ? [token] : filtered.slice(Math.min(a,b),Math.max(a,b)+1).flatMap(row => row.entryToken ? [row.entryToken] : []);}
    else if (event.ctrlKey || event.metaKey) next=selection.includes(token) ? selection.filter(value => value !== token) : [...selection,token];
    else next=[token];
    if (next.length>100) {setNotice('한 번에 최대100개를 선택할 수 있습니다.');return;}setSelection(next);if (!event.shiftKey) anchor.current=token;
  };
  const transfer=async (direction:'upload'|'download',entryTokens=selection) => {
    if (!writable || !page || nativeBusy.current) return;nativeBusy.current=true;setPicking(true);setError('');
    try {let result:{previewId:string}|null=null;
      if (direction === 'upload') {const choices=await window.sshOS.transfer.pickUploadFiles();if (choices && alive.current) result=await window.sshOS.transfer.previewUpload({fileTokens:choices.map(row => row.token),directoryToken:page.directoryToken});}
      else {const directory=await window.sshOS.transfer.pickDownloadDirectory();if (directory && alive.current) result=await window.sshOS.transfer.previewDownload({entryTokens,directoryToken:directory.token});}
      if (result) {if (alive.current) setTransferId(result.previewId);else await window.sshOS.transfer.releasePreview(result.previewId);}
    }catch (failure) {if (alive.current) setError('전송 선택을 완료하지 못했습니다. '+(failure instanceof Error ? failure.message : 'INPUT_INVALID'));}finally {nativeBusy.current=false;if (alive.current) setPicking(false);}
  };
  const observeTransfers=async (ids:string[]) => {
    const origin=page;setNotice(`${ids.length}개 전송을 등록했습니다. 창을 닫아도 전송 선반과 전체 작업에서 확인할 수 있습니다.`);
    try {while (alive.current) {let offset:number|null=0;const states=new Map<string,string>();while (offset !== null) {const tasks=await window.sshOS.task.list(offset);for (const row of tasks.rows) if (ids.includes(row.taskId)) states.set(row.taskId,row.phase);offset=tasks.nextOffset;}
      if (!alive.current) return;if (ids.every(id => ['completed','failed','cancelled','interrupted','result_unknown','skipped'].includes(states.get(id) ?? ''))) {if (ids.some(id => states.get(id) === 'completed') && currentView.current.connected && currentView.current.page?.path === origin?.path && origin) await load(() => window.sshOS.file.list(origin.directoryToken));return;}await new Promise(resolve => setTimeout(resolve,1000));}
    }catch { /* Tasks remain owned by main; closing this observer does not cancel them. */ }
  };
  const cancelOpen=() => {openingRequest.current++;openingBusy.current=false;setOpening(false);const token=probeToken.current;probeToken.current=null;if (token) void window.sshOS.viewer.releaseProbe(token).catch(() => {});};
  const open = async (row: EntryView) => {
    if (!connected || busy || opening || openingBusy.current || !row.entryToken) return;
    if (row.type === 'directory') {void load(() => window.sshOS.file.enter(row.entryToken!));return;}
    openingBusy.current=true;setOpening(true);setError('');const id=++openingRequest.current;let token:string|null=null;
    try {
      const probe=await window.sshOS.viewer.probe(row.entryToken);token=probe.probeToken;
      if (!alive.current || id !== openingRequest.current) return;probeToken.current=token;
      const samples:Uint8Array[]=[];let count=0,sequence=0,path='';
      while (alive.current && id === openingRequest.current) {
        const frame=await scheduleViewerFrame(() => {if (!alive.current || id !== openingRequest.current) throw new Error('REQUEST_CANCELLED');return window.sshOS.viewer.next(token!,probe.readGeneration,sequence);});if (!alive.current || id !== openingRequest.current) return;
        if (frame.status === 'waiting') {await new Promise(resolve => setTimeout(resolve,250));continue;}
        path=frame.metadata.path;
        if (frame.status === 'end') break;count+=frame.bytes.length;if (count>4096) throw new Error('INPUT_INVALID');samples.push(frame.bytes);sequence++;
      }
      if (!alive.current || id !== openingRequest.current) return;
      const signature=new Uint8Array(count);let offset=0;for (const bytes of samples) {signature.set(bytes,offset);offset+=bytes.length;}
      if (imageSignature(signature)) await openViewer(row.entryToken,'image');
      else if (/\.(txt|md|log|json|yaml|yml|ini|conf|csv|sh)$/iu.test(row.name)) await openViewer(row.entryToken,'text');
      else setChoice({entryToken:row.entryToken,name:row.name,path,server:session ? `${session.serverName} · ${session.username}@${session.host}:${session.port}` : '연결 끊김'});
    } catch (failure) {if (alive.current && id === openingRequest.current) setError(explain(failure));}
    finally {if (token) await window.sshOS.viewer.releaseProbe(token).catch(() => {});if (probeToken.current === token) probeToken.current=null;if (alive.current && id === openingRequest.current) {openingBusy.current=false;setOpening(false);}}
  };
  const visibleTree = tree.filter(row => !collapsed.some(path => row.path !== path && row.path.startsWith(path === '/' ? '/' : path+'/'))).sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const treeFirst = Math.max(0, Math.floor(treeScroll/30)-8);
  return <section className="file-explorer" aria-label="파일 탐색기">
    <div className="file-toolbar"><button disabled={!writable || busy || opening || picking || !page} onClick={() => {void transfer('upload');}}>업로드</button><button disabled={!writable || busy || opening || picking || selection.length === 0} onClick={() => {void transfer('download');}}>다운로드</button>{opening && <button onClick={cancelOpen}>열기 취소</button>}<button disabled={!connected || opening} onClick={newWindow}>새 파일 창</button><button disabled={!writable || busy || opening || !page} onClick={() => {if (page) setMutation({operation:'mkdir',token:page.directoryToken,name:''});}}>새 폴더</button><button disabled={!writable || busy || opening || selectedRow?.type !== 'file' || !selected} onClick={() => {if (selectedRow && selected) setMutation({operation:'rename',token:selected,name:selectedRow.name});}}>이름 변경</button><button disabled={!writable || busy || opening || !selected} onClick={() => {if (selectedRow && selected) setMutation({operation:'delete',token:selected,name:selectedRow.name});}}>삭제</button><button disabled={!connected || busy || opening || !page?.parentToken} onClick={() => { if (page?.parentToken) void load(() => window.sshOS.file.list(page.parentToken!)); }}>상위 폴더</button><button disabled={!connected || busy || opening} onClick={() => { void load(() => page ? window.sshOS.file.list(page.directoryToken) : window.sshOS.file.open(windowId)); }}>새로고침</button><input aria-label="현재 목록 이름 필터" value={filter} onChange={event => { setFilter(event.target.value);setSelection([]);anchor.current=null; setScroll(0); if (viewport.current) viewport.current.scrollTop = 0; }} placeholder="현재 목록에서 이름 필터" /><label><input type="checkbox" checked={showHidden} onChange={event => { setShowHidden(event.target.checked);setSelection([]);anchor.current=null; hiddenByServer.set(`${session?.serverId}:${generation}`,event.target.checked); }} />숨김 표시</label></div>
    <div className="file-location">{session ? `${session.username}@${session.host}:${session.port}` : '연결 끊김'}<code>{page?.path ?? '폴더 확인 중'}</code></div>
    {!connected && <p className="file-warning" role="status">연결 끊김 · 마지막 조회 {page?.listedAt ?? '없음'} · 다시 연결한 뒤 파일 창을 다시 여세요.</p>}
    {error && <p className="file-warning" role="alert">{error}</p>}
    <div className="file-panels">
      <nav className="file-tree" aria-label="폴더 트리" onScroll={event => setTreeScroll(event.currentTarget.scrollTop)}><div style={{height:visibleTree.length*30,position:'relative'}}>{visibleTree.slice(treeFirst,treeFirst+100).map((row,index) => <div key={row.path} style={{position:'absolute',top:(treeFirst+index)*30,left:Math.min(8,row.path.split('/').length-1)*10,height:30,display:'flex'}}><button aria-label={`${row.path} ${collapsed.includes(row.path) ? '펼치기' : '접기'}`} onClick={() => setCollapsed(value => value.includes(row.path) ? value.filter(path => path !== row.path) : [...value,row.path])}>{collapsed.includes(row.path) ? '▸' : '▾'}</button><button disabled={!connected || busy || opening} title={row.path} onClick={() => { void load(() => window.sshOS.file.list(row.token)); }}>▱ {row.name}</button></div>)}</div></nav>
      <div className="file-table"><div className="file-columns"><span>이름</span><span>크기</span><span>종류</span></div><div ref={viewport} className="file-rows" onScroll={event => setScroll(event.currentTarget.scrollTop)} role="list" aria-label="파일 목록"><div style={{ height:filtered.length*34,position:'relative' }}>{visible.map((row,index) => <button key={row.entryToken ?? `${first+index}:${row.name}`} role="listitem" className={`file-row ${row.entryToken && selection.includes(row.entryToken) ? 'selected' : ''}`} style={{position:'absolute',top:(first+index)*34,height:34,left:0,right:0}} title={`${row.name} · mode ${row.mode === null ? '?' : (row.mode&0o777).toString(8)}`} aria-selected={Boolean(row.entryToken && selection.includes(row.entryToken))} onClick={event => select(row.entryToken,event)} onDoubleClick={() => open(row)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); open(row); } }}><span>{row.type === 'directory' ? '▱' : row.type === 'file' ? '≡' : '⊘'} {row.name}</span><span>{row.size === null ? '?' : row.size.toLocaleString()}</span><span>{!row.operable && ['file','directory'].includes(row.type) ? '이름 미지원 · 조회만' : row.type === 'directory' ? '폴더' : row.type === 'file' ? '파일' : row.type === 'symlink' ? '링크 · 조회만' : '특수 · 조회만'}</span></button>)}</div></div></div>
    </div>
    {transferId && <TransferDialog id={transferId} close={() => setTransferId(null)} started={ids => {void observeTransfers(ids);}}/>}
    {mutation && <MutationDialog operation={mutation.operation} targetToken={mutation.token} initialName={mutation.name} close={() => setMutation(null)} started={id => {void observeMutation(id);}} />}
    {choice && <FileOpenChoice name={choice.name} path={choice.path} server={choice.server} downloadEnabled={Boolean(writable && !picking)} download={() => {const token=choice.entryToken;setChoice(null);void transfer('download',[token]);}} close={() => setChoice(null)} openText={() => {const token=choice.entryToken;setChoice(null);void openViewer(token,'text').catch(failure => {if (alive.current) setError(explain(failure));});}} />}
    <output className="file-status" aria-live="polite">{opening ? '열기 형식 확인 중' : busy ? `읽는 중 · ${rows.length}개` : `${filtered.length}개 표시 / ${rows.length}개 조회 · ${selection.length}개 선택`}{page?.partial ? ' · 일부 목록: 개수 또는 용량 한도 도달' : ''} · 마지막 조회 {page?.listedAt ? new Date(page.listedAt).toLocaleTimeString() : '없음'}{notice ? ` · ${notice}` : ''}</output>
  </section>;
}
