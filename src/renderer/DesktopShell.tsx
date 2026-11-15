import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { WindowManager, windowModelSchema, resizeBounds, type ResizeEdge, type Bounds, type WindowKind, type WindowModel } from '../shared/windows';
import type { RuntimeSnapshot } from '../shared/contracts';
import type { SessionView } from '../shared/session-contracts';
import { ProfileManager } from './ProfileManager';
import { FileExplorer } from './FileExplorer';
import { ProbeStatus } from './ProbeStatus';
import { TerminalPane } from './TerminalPane';
import { TerminalCloseDialog } from './TerminalCloseDialog';
import type { TerminalClosePreview } from '../shared/terminal-ui';
import { ExecutionPane } from './ExecutionPane';
import { ExecutionActionDialog } from './ExecutionActionDialog';
import type { ExecutionActionPreview } from '../shared/execution-ui';
import { TransferShelf } from './TransferShelf';
import { TaskManager } from './TaskManager';
import { ViewerPane } from './ViewerPane';

const labels: Record<WindowKind, string> = { connections: '연결', files: '파일', text: '텍스트', image: '이미지', execution: '실행 출력', terminal: '터미널', tasks: '작업', settings: '설정' };
const icons: Record<WindowKind, string> = { connections: '▤', files: '▱', text: '≡', image: '▧', execution: '▷', terminal: '›_', tasks: '⇅', settings: '⚙' };
const getArea = (): Bounds => ({ x: 0, y: 44, width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight - 160) });

export function DesktopShell({ snapshot, error }: { snapshot: RuntimeSnapshot | null; error: boolean }) {
  const nextId = useRef('');
  const manager = useRef<WindowManager | null>(null);
  if (!manager.current) manager.current = new WindowManager(getArea(), () => nextId.current);
  const [windows, setWindows] = useState<WindowModel[]>([]);
  const [titles,setTitles]=useState<Record<string,{name:string;serverName:string}>>({});
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [activeServer, setActiveServer] = useState<string | null>(null);
  const [terminalClose,setTerminalClose]=useState<{preview:TerminalClosePreview;windowId:string}|null>(null);
  const [executionClose,setExecutionClose]=useState<{preview:ExecutionActionPreview;windowId:string}|null>(null);
  const [engineBusy,setEngineBusy]=useState(false);
  const [notice, setNotice] = useState('');
  useEffect(()=>{if(snapshot && snapshot.powerSequence>0)setNotice('절전 전 연결을 종료했습니다. 서버에 다시 연결하세요.');},[snapshot?.powerSequence]);
  useEffect(()=>{let alive=true;void window.sshOS.session.selectActiveServer(activeServer).catch(async()=>{if(!alive)return;await window.sshOS.session.selectActiveServer(null).catch(()=>{});if(alive && activeServer)setNotice('활성 서버의 응답시간 측정을 시작하지 못했습니다. 서버를 다시 선택하세요.');});return()=>{alive=false;};},[activeServer]);
  const [startMenu, setStartMenu] = useState(false);
  const [picker, setPicker] = useState<WindowKind | null>(null);
  const [chosenServer, setChosenServer] = useState('');
  const pickerDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (picker) pickerDialog.current?.showModal(); }, [picker]);
  const mirrored = useRef(new Map<string, string>());
  const update = () => { const rows = manager.current!.snapshot(); setWindows(rows); const focused = rows.find(row => row.focused && row.serverId); if (focused?.serverId) setActiveServer(focused.serverId); };
  const openFor = async (kind: WindowKind, session?: SessionView, newWindow=false) => {
    try {
      if (kind === 'files' && session && !newWindow) {
        const previous = manager.current!.snapshot().filter(row => row.kind === 'files' && row.serverId === session.serverId && row.sessionGeneration === session.generation).sort((a,b) => b.lastFocusedSequence-a.lastFocusedSequence)[0];
        if (previous) { manager.current!.restore(previous.windowId); update(); return; }
      }
      const registered = windowModelSchema.parse(await (kind === 'terminal' && session?.sessionToken ? window.sshOS.terminal.open(session.sessionToken):window.sshOS.desktop.registerWindow(kind,session?.sessionToken ?? undefined)));
      if (manager.current!.snapshot().some(row => row.windowId === registered.windowId)) manager.current!.restore(registered.windowId);
      else { nextId.current = registered.windowId; manager.current!.open(kind, registered.serverId, registered.sessionGeneration, registered.resourceId); }
      setNotice(''); update();
    } catch { setNotice('창을 열지 못했습니다. 연결 상태 또는 열린 창 수를 확인하세요.'); }
  };
  const openViewer=async (entryToken:string,kind:'text'|'image') => {
    const registered=windowModelSchema.parse(await window.sshOS.viewer.open(entryToken,kind));
    try {
      if (manager.current!.snapshot().some(row => row.windowId === registered.windowId)) manager.current!.restore(registered.windowId);
      else {nextId.current=registered.windowId;manager.current!.open(kind,registered.serverId,registered.sessionGeneration,registered.resourceId);}
      update();
    } catch (error) {if (!manager.current!.snapshot().some(row => row.windowId === registered.windowId)) await window.sshOS.desktop.closeWindow(registered.windowId).catch(() => {});throw error;}
  };
  const addExecutionWindow=(registered:WindowModel)=>{if(manager.current!.snapshot().some(row=>row.windowId === registered.windowId))manager.current!.restore(registered.windowId);else{nextId.current=registered.windowId;manager.current!.open('execution',registered.serverId,registered.sessionGeneration,registered.resourceId);}update();};
  const reopenExecution=(id:string)=>{void window.sshOS.execution.reopen(id).then(addExecutionWindow).catch(()=>setNotice('출력 창을 열지 못했습니다. 열린 창 한도와 기록 상태를 확인하세요.'));};
  const removeWindow=(id:string)=>{manager.current!.close(id);mirrored.current.delete(id);setTitles(value=>{const next={...value};delete next[id];return next;});update();};
  const closeWindow=async(row:WindowModel)=>{try{if(row.kind === 'terminal'){const preview=await window.sshOS.terminal.previewClose(row.windowId);if(preview.active){setTerminalClose({preview,windowId:row.windowId});return;}}if(row.kind === 'execution'){const preview=await window.sshOS.execution.previewAction(row.windowId,'close_window');if(preview.active){setExecutionClose({preview,windowId:row.windowId});return;}}await window.sshOS.desktop.closeWindow(row.windowId);removeWindow(row.windowId);}catch{setNotice('창을 닫지 못했습니다. 실행 상태를 확인한 뒤 다시 시도하세요.');}};
  const launch = async (kind: WindowKind) => {
    setStartMenu(false);
    if (!['files','terminal'].includes(kind)) {await openFor(kind);return;}
    try {
      const current=await window.sshOS.session.list();setSessions(current.sessions);
      const available=current.sessions.filter(session => session.status === 'connected' && session.sessionToken);
      if (available.length === 1) {await openFor(kind,available[0]);return;}
      if (available.length === 0) {await openFor('connections');return;}
      setChosenServer(available.some(row=>row.serverId===activeServer) ? activeServer!:'');setPicker(kind);
    } catch {setNotice('연결 상태를 읽지 못했습니다. 연결 화면에서 확인하세요.');}
  };
  useEffect(() => {
    let alive = true;
    void window.sshOS.desktop.getWindowSnapshot().then(rows => {
      if (!alive) return;
      if (rows.length) { manager.current!.restoreSnapshot(rows.map(row => windowModelSchema.parse(row))); update(); }
      else void openFor('connections');
    }).catch(() => setNotice('작업 공간 상태를 불러오지 못했습니다.'));
    const resized = () => { manager.current!.resizeArea(getArea()); update(); };
    window.addEventListener('resize', resized);
    const timer = setInterval(() => {
      const rows = manager.current!.snapshot();
      for (const row of rows) {
        const { kind: _kind, serverId: _server, sessionGeneration: _generation, resourceId: _resource, ...layout } = row;
        const serialized = JSON.stringify(layout); if (mirrored.current.get(row.windowId) === serialized) continue;
        mirrored.current.set(row.windowId, serialized);
        void window.sshOS.desktop.updateWindowLayout(layout).catch(() => { mirrored.current.delete(row.windowId); });
      }
    }, 250);
    const pollSessions=()=>{void window.sshOS.session.list().then(value=>{if(alive)setSessions(value.sessions);}).catch(()=>{});};pollSessions();const poll=setInterval(pollSessions,1000);
    return () => { alive = false; clearInterval(timer); clearInterval(poll); window.removeEventListener('resize', resized); };
  }, []);
  const selected = sessions.find(row => row.serverId === activeServer);
  return <main className="desktop">
    <header><strong>sshOS <small>시오스</small></strong><span>데스크톱</span><span className="connection"><select className="active-server-select" aria-label="활성 서버" value={activeServer ?? ''} onChange={event=>setActiveServer(event.target.value || null)} disabled={sessions.length===0}><option value="">활성 서버 선택</option>{sessions.map(row=><option key={row.serverId} value={row.serverId}>{row.serverName}</option>)}</select>{selected ? <><span>{{idle:'연결 대기',connecting:'연결 중',authenticating:'인증 중',connected:'연결됨',awaiting_host_trust:'지문 확인 대기',disconnecting:'연결 해제 중',disconnected:'연결 끊김',failed:'연결 실패'}[selected.status]}</span>{selected.status==='connected' && <ProbeStatus value={snapshot?.probe} serverId={selected.serverId} generation={selected.generation}/>}</> : <span>연결 {snapshot?.connectedServers ?? 0}</span>}</span></header>
    <div className="desktop-area">
      <nav className="desktop-icons" aria-label="앱 실행">{(['connections','files','terminal','settings'] as WindowKind[]).map(kind => <button key={kind} onDoubleClick={() => launch(kind)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); launch(kind); } }}><span aria-hidden="true">{icons[kind]}</span>{labels[kind]}</button>)}</nav>
      {windows.map(row => <WindowFrame key={row.windowId} model={row} title={`${row.kind === 'terminal' ? titles[row.windowId]?.name ?? labels[row.kind]:labels[row.kind]}${row.kind !== 'terminal' && titles[row.windowId] ? ` / ${titles[row.windowId]!.name}` : ''}${row.serverId ? ` · ${sessions.find(session => session.serverId === row.serverId)?.serverName ?? titles[row.windowId]?.serverName ?? '연결 끊김'}` : ''}`}
        focus={() => { manager.current!.focus(row.windowId); update(); }}
        minimize={() => { manager.current!.minimize(row.windowId); update(); }}
        maximize={() => { manager.current!.toggleMaximize(row.windowId); update(); }}
        move={bounds => { manager.current!.moveResize(row.windowId, bounds); update(); }}
        close={() => {void closeWindow(row);}}>
        {row.kind === 'terminal' ? <TerminalPane windowId={row.windowId} visible={row.mode !== 'minimized'} onName={(name,serverName)=>setTitles(value=>({...value,[row.windowId]:{name,serverName}}))}/> : row.kind === 'execution' ? <ExecutionPane windowId={row.windowId} visible={row.mode !== 'minimized'} onName={(name,serverName)=>setTitles(value=>({...value,[row.windowId]:{name,serverName}}))}/> : row.kind === 'text' || row.kind === 'image' ? <ViewerPane windowId={row.windowId} kind={row.kind} onName={(name,serverName) => setTitles(value => ({...value,[row.windowId]:{name,serverName}}))} {...(sessions.find(session => session.serverId === row.serverId) ? {session:sessions.find(session => session.serverId === row.serverId)!} : {})} /> : row.kind === 'files' ? <FileExplorer openExecution={addExecutionWindow} storageHealthy={Boolean(snapshot && snapshot.storage.status !== 'unavailable')} openViewer={openViewer} newWindow={() => {const session=sessions.find(value => value.serverId === row.serverId);if (session) void openFor('files',session,true);}} windowId={row.windowId} generation={row.sessionGeneration!} {...(sessions.find(session => session.serverId === row.serverId) ? {session:sessions.find(session => session.serverId === row.serverId)!} : {})} /> : row.kind === 'connections' ? <ProfileManager disabled={!snapshot || snapshot.storage.status === 'unavailable'} /> : row.kind === 'settings' ? <section className="app-content"><h2>sshOS(시오스)</h2><p>버전 {snapshot?.appVersion ?? '0.1.0'}</p><p>프로젝트 라이선스 AGPL-3.0-only</p><p>인증 정보는 연결 시 저장을 선택한 경우에만 OS 암호화로 보관합니다.</p></section> : row.kind === 'tasks' ? <TaskManager openExecution={reopenExecution} /> : <section className="app-content"><h2>{labels[row.kind]}</h2><p>서버 연결과 기능 지원 상태를 확인하세요.</p></section>}
      </WindowFrame>)}
      {notice && <p className="desktop-notice" role="alert">{notice}</p>}
      {snapshot?.storage.status === 'unavailable' && <div className="storage-error" role="alert"><p>앱 데이터를 읽지 못했습니다. 기존 데이터를 초기화하지 않고 변경 기능을 잠갔습니다.</p><p>{snapshot.storage.path}</p><button onClick={() => { void window.sshOS.settings.retryStorage().catch(() => setNotice('저장소를 다시 확인하지 못했습니다.')); }}>저장소 다시 확인</button></div>}
      <div className="engine-state"><output aria-live="polite" data-testid="engine-state">{error ? '앱 상태를 확인하지 못했습니다.' : snapshot?.engine === 'ready' ? '연결 엔진 준비됨' : snapshot?.engine === 'stopped' ? '연결 엔진이 종료됐습니다.' : '연결 엔진 시작 중'}</output>{snapshot?.engine === 'stopped' && <button disabled={engineBusy} onClick={()=>{setEngineBusy(true);void window.sshOS.lifecycle.restartEngine().catch(()=>setNotice('연결 엔진을 다시 시작하지 못했습니다. 다시 시도하세요.')).finally(()=>setEngineBusy(false));}}>연결 엔진 다시 시작</button>}</div>
      {picker && <dialog ref={pickerDialog} className="server-picker" aria-label="서버 선택" onCancel={() => setPicker(null)}><h2>작업할 서버 선택</h2><select aria-label="대상 서버" value={chosenServer} onChange={event => setChosenServer(event.target.value)}><option value="">선택하세요</option>{sessions.filter(row => row.status === 'connected').map(row => <option key={row.serverId} value={row.serverId}>{row.serverName}</option>)}</select><button disabled={!chosenServer} onClick={() => { const server = sessions.find(row => row.serverId === chosenServer); const kind = picker; setPicker(null); if (server) void openFor(kind, server); }}>열기</button><button onClick={() => setPicker(null)}>취소</button></dialog>}
    </div>
    {snapshot?.closing && <div className="shutdown-overlay" role="status">작업 정리 후 종료 중 · 승인 후 최대10초</div>}
    {terminalClose && <TerminalCloseDialog preview={terminalClose.preview} close={()=>setTerminalClose(null)} done={()=>removeWindow(terminalClose.windowId)}/>}
    {executionClose && <ExecutionActionDialog preview={executionClose.preview} close={()=>setExecutionClose(null)} hidden={()=>removeWindow(executionClose.windowId)}/>}
    <TransferShelf openTasks={() => {void launch('tasks');}}/>
    <footer className="taskbar"><button aria-label="시작" onClick={() => setStartMenu(!startMenu)}>▦</button>{windows.map(row => <button className={row.focused ? 'active' : ''} aria-pressed={row.focused} data-window-id={row.windowId} key={row.windowId} onClick={() => { manager.current!.restore(row.windowId); update(); }}>{icons[row.kind]} {titles[row.windowId]?.name ?? labels[row.kind]}</button>)}<span>연결 {snapshot?.connectedServers ?? 0}</span></footer>
    {startMenu && <nav className="start-menu" aria-label="시작 메뉴">{(['connections','files','terminal','tasks','settings'] as WindowKind[]).map(kind => <button key={kind} onClick={() => launch(kind)}>{icons[kind]} {labels[kind]}</button>)}</nav>}
  </main>;
}

function WindowFrame({ model, title, focus, minimize, maximize, close, move, children }: { model: WindowModel; title: string; focus(): void; minimize(): void; maximize(): void; close(): void; move(bounds: Bounds): void; children: React.ReactNode }) {
  const drag = useRef<{ x: number; y: number; bounds: Bounds; edge: ResizeEdge | null; pointer: number } | null>(null);
  const frame = useRef<number | null>(null); const latest = useRef<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState(false); const [keyboard, setKeyboard] = useState<{ kind: 'move' | 'resize'; start: Bounds } | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {if (model.focused && root.current && !root.current.contains(document.activeElement)) root.current.focus();},[model.focused]);
  const begin = (event: PointerEvent<HTMLElement>, edge: ResizeEdge | null) => {
    if (model.mode !== 'normal' || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault(); event.stopPropagation(); focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, bounds: { ...model.bounds }, edge, pointer: event.pointerId };
  };
  const flush = () => {
    frame.current = null; const current = drag.current; const point = latest.current; if (!current || !point) return;
    const dx = point.x-current.x; const dy = point.y-current.y;
    move(current.edge ? resizeBounds(current.bounds, current.edge, dx, dy, model.kind, getArea()) : { ...current.bounds, x: current.bounds.x+dx, y: current.bounds.y+dy });
  };
  const pointerMove = (event: PointerEvent<HTMLElement>) => { if (drag.current?.pointer !== event.pointerId) return; latest.current = { x: event.clientX, y: event.clientY }; if (frame.current === null) frame.current = requestAnimationFrame(flush); };
  const end = () => { if (frame.current !== null) { cancelAnimationFrame(frame.current); flush(); } drag.current = null; latest.current = null; };
  useEffect(() => { window.addEventListener('blur', end); return () => { window.removeEventListener('blur', end); if (frame.current !== null) cancelAnimationFrame(frame.current); }; }, []);
  const key = (event: KeyboardEvent) => {
    if (!keyboard) return;
    if (event.key === 'Escape') { event.preventDefault(); move(keyboard.start); setKeyboard(null); return; }
    if (event.key === 'Enter') { event.preventDefault(); setKeyboard(null); return; }
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault(); const amount = event.shiftKey ? 1 : 10; const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0; const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
    move(keyboard.kind === 'move' ? { ...model.bounds, x: model.bounds.x+dx, y: model.bounds.y+dy } : { ...model.bounds, width: Math.max(1,model.bounds.width+dx), height: Math.max(1,model.bounds.height+dy) });
  };
  return <section ref={root} data-window-id={model.windowId} className={`internal-window ${model.focused ? 'focused' : ''}`} aria-label={title} role="region" tabIndex={-1} hidden={model.mode === 'minimized'} onKeyDown={key} onFocusCapture={()=>{if(!model.focused)focus();}} onPointerDown={focus} style={{ position: 'fixed', left: model.bounds.x, top: model.bounds.y, width: model.bounds.width, height: model.bounds.height, zIndex: 10+model.lastFocusedSequence }}>
    <div className="window-title" onPointerDown={event => begin(event,null)} onPointerMove={pointerMove} onPointerUp={end} onPointerCancel={end} onDoubleClick={event => { if (!(event.target as HTMLElement).closest('button')) maximize(); }}><button aria-label={`${title} 창 메뉴`} onClick={() => setMenu(!menu)}>⋮</button><strong>{title}</strong><button aria-label={`${title} 최소화`} onClick={minimize}>−</button><button aria-label={`${title} 최대화 또는 복원`} onClick={maximize}>□</button><button aria-label={`${title} 닫기`} onClick={close}>×</button></div>
    {menu && <menu className="window-menu"><li><button onClick={() => { setKeyboard({ kind:'move', start:{...model.bounds} }); setMenu(false); root.current?.focus(); }}>이동</button></li><li><button onClick={() => { setKeyboard({ kind:'resize', start:{...model.bounds} }); setMenu(false); root.current?.focus(); }}>크기 조절</button></li></menu>}
    <div className="window-body">{children}</div>{model.mode === 'normal' && (['n','s','e','w','ne','nw','se','sw'] as ResizeEdge[]).map(edge => <div key={edge} className={`window-resize edge-${edge}`} aria-hidden="true" onPointerDown={event => begin(event,edge)} onPointerMove={pointerMove} onPointerUp={end} onPointerCancel={end} />)}
  </section>;
}
