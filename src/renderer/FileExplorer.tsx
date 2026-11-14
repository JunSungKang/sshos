import { useEffect, useRef, useState } from 'react';
import type { DirectoryPage, EntryView } from '../shared/files';
import type { SessionView } from '../shared/session-contracts';
import { MutationDialog } from './MutationDialog';
import { scheduleFilePage } from './file-page-scheduler';

const hiddenByServer = new Map<string, boolean>();
const explain = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const messages: Record<string,string> = { PATH_UNSUPPORTED: '링크 또는 특수파일 경로는 지원하지 않습니다.', PATH_CHANGED: '조회 중 경로가 변경됐습니다. 다시 열어 주세요.', SFTP_UNAVAILABLE: '이 연결에서 SFTP를 사용할 수 없습니다.', IO_TIMEOUT: '파일 조회 응답이 지연되어 연결을 종료했습니다.', TOKEN_EXPIRED: '조회 정보가 만료됐습니다. 파일 창을 다시 열어 주세요.', REQUEST_BUSY: '이 창의 조회가 진행 중입니다.', CONNECTION_LOST: 'SSH 연결이 끊겼습니다.' };
  return Object.entries(messages).find(([code]) => message.includes(code))?.[1] ?? '폴더를 읽지 못했습니다. 연결 상태와 경로 접근 권한을 확인하세요.';
};
type TreeRow = { path: string; name: string; token: string; parent: string | null };
export function FileExplorer({ windowId, session, generation, newWindow }: { windowId: string; session?: SessionView; generation: number; newWindow():void }) {
  const [page, setPage] = useState<DirectoryPage | null>(null);
  const [rows, setRows] = useState<EntryView[]>([]);
  const [tree, setTree] = useState<TreeRow[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(hiddenByServer.get(`${session?.serverId}:${generation}`) ?? true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [mutation,setMutation]=useState<{operation:'mkdir'|'rename'|'delete';token:string;name:string}|null>(null);
  const [treeScroll, setTreeScroll] = useState(0);
  const [scroll, setScroll] = useState(0); const [height, setHeight] = useState(300);
  const viewport = useRef<HTMLDivElement>(null); const request = useRef(0); const alive = useRef(true);
  const connected = session?.status === 'connected' && session.generation === generation;
  const writable=connected && (session.os === 'supported' || session.os === 'unknown' && session.osConfirmed);
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
    const id = ++request.current; setBusy(true); setError(''); setNotice(''); setSelected(null);
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
  useEffect(() => { alive.current = true; void load(() => window.sshOS.file.open(windowId)); return () => { alive.current = false; request.current++; }; }, [windowId]);
  useEffect(() => { const element = viewport.current; if (!element) return; const observer = new ResizeObserver(() => setHeight(element.clientHeight)); observer.observe(element); return () => observer.disconnect(); }, []);
  const filtered = rows.filter(row => (showHidden || !row.name.startsWith('.')) && row.name.includes(filter));
  const first = Math.max(0, Math.floor(scroll/34)-8); const visible = filtered.slice(first, first+Math.ceil(height/34)+16);
  const open = (row: EntryView) => {
    if (!connected || busy || !row.entryToken) return;
    if (row.type === 'directory') void load(() => window.sshOS.file.enter(row.entryToken!));
    else setNotice(`${row.name} · 일반 파일 · ${row.size ?? '?'} byte`);
  };
  const visibleTree = tree.filter(row => !collapsed.some(path => row.path !== path && row.path.startsWith(path === '/' ? '/' : path+'/'))).sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const treeFirst = Math.max(0, Math.floor(treeScroll/30)-8);
  return <section className="file-explorer" aria-label="파일 탐색기">
    <div className="file-toolbar"><button disabled={!connected} onClick={newWindow}>새 파일 창</button><button disabled={!writable || busy || !page} onClick={() => {if (page) setMutation({operation:'mkdir',token:page.directoryToken,name:''});}}>새 폴더</button><button disabled={!writable || busy || selectedRow?.type !== 'file' || !selected} onClick={() => {if (selectedRow && selected) setMutation({operation:'rename',token:selected,name:selectedRow.name});}}>이름 변경</button><button disabled={!writable || busy || !selected} onClick={() => {if (selectedRow && selected) setMutation({operation:'delete',token:selected,name:selectedRow.name});}}>삭제</button><button disabled={!connected || busy || !page?.parentToken} onClick={() => { if (page?.parentToken) void load(() => window.sshOS.file.list(page.parentToken!)); }}>상위 폴더</button><button disabled={!connected || busy || !page} onClick={() => { if (page) void load(() => window.sshOS.file.list(page.directoryToken)); }}>새로고침</button><input aria-label="현재 목록 이름 필터" value={filter} onChange={event => { setFilter(event.target.value); setScroll(0); if (viewport.current) viewport.current.scrollTop = 0; }} placeholder="현재 목록에서 이름 필터" /><label><input type="checkbox" checked={showHidden} onChange={event => { setShowHidden(event.target.checked); hiddenByServer.set(`${session?.serverId}:${generation}`,event.target.checked); }} />숨김 표시</label></div>
    <div className="file-location">{session ? `${session.username}@${session.host}:${session.port}` : '연결 끊김'}<code>{page?.path ?? '폴더 확인 중'}</code></div>
    {!connected && <p className="file-warning" role="status">연결 끊김 · 마지막 조회 {page?.listedAt ?? '없음'} · 다시 연결한 뒤 파일 창을 다시 여세요.</p>}
    {error && <p className="file-warning" role="alert">{error}</p>}
    <div className="file-panels">
      <nav className="file-tree" aria-label="폴더 트리" onScroll={event => setTreeScroll(event.currentTarget.scrollTop)}><div style={{height:visibleTree.length*30,position:'relative'}}>{visibleTree.slice(treeFirst,treeFirst+100).map((row,index) => <div key={row.path} style={{position:'absolute',top:(treeFirst+index)*30,left:Math.min(8,row.path.split('/').length-1)*10,height:30,display:'flex'}}><button aria-label={`${row.path} ${collapsed.includes(row.path) ? '펼치기' : '접기'}`} onClick={() => setCollapsed(value => value.includes(row.path) ? value.filter(path => path !== row.path) : [...value,row.path])}>{collapsed.includes(row.path) ? '▸' : '▾'}</button><button disabled={!connected || busy} title={row.path} onClick={() => { void load(() => window.sshOS.file.list(row.token)); }}>▱ {row.name}</button></div>)}</div></nav>
      <div className="file-table"><div className="file-columns"><span>이름</span><span>크기</span><span>종류</span></div><div ref={viewport} className="file-rows" onScroll={event => setScroll(event.currentTarget.scrollTop)} role="list" aria-label="파일 목록"><div style={{ height:filtered.length*34,position:'relative' }}>{visible.map((row,index) => <button key={row.entryToken ?? `${first+index}:${row.name}`} role="listitem" className={`file-row ${selected === row.entryToken && row.entryToken ? 'selected' : ''}`} style={{position:'absolute',top:(first+index)*34,height:34,left:0,right:0}} title={`${row.name} · mode ${row.mode === null ? '?' : (row.mode&0o777).toString(8)}`} onClick={() => setSelected(row.entryToken)} onDoubleClick={() => open(row)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); open(row); } }}><span>{row.type === 'directory' ? '▱' : row.type === 'file' ? '≡' : '⊘'} {row.name}</span><span>{row.size === null ? '?' : row.size.toLocaleString()}</span><span>{row.type === 'directory' ? '폴더' : row.type === 'file' ? '파일' : row.type === 'symlink' ? '링크 · 조회만' : '특수 · 조회만'}</span></button>)}</div></div></div>
    </div>
    {mutation && <MutationDialog operation={mutation.operation} targetToken={mutation.token} initialName={mutation.name} close={() => setMutation(null)} started={id => {void observeMutation(id);}} />}
    <output className="file-status" aria-live="polite">{busy ? `읽는 중 · ${rows.length}개` : `${filtered.length}개 표시 / ${rows.length}개 조회`}{page?.partial ? ' · 일부 목록: 개수 또는 용량 한도 도달' : ''} · 마지막 조회 {page?.listedAt ? new Date(page.listedAt).toLocaleTimeString() : '없음'}{notice ? ` · ${notice}` : ''}</output>
  </section>;
}
