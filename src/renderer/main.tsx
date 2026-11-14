import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { runtimeSnapshotSchema, type DesktopBridge, type RuntimeSnapshot } from '../shared/contracts';
import './style.css';
import { ProfileManager } from './ProfileManager';

declare global { interface Window { sshOS: DesktopBridge } }

function App() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const update = () => { void window.sshOS.lifecycle.getSnapshot().then(value => { if (active) setSnapshot(runtimeSnapshotSchema.parse(value)); }).catch(() => { if (active) setError(true); }); };
    update(); const timer = setInterval(update, 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <main className="desktop">
    <header><strong>sshOS <small>시오스</small></strong><span>데스크톱</span><span className="connection">○ 연결 없음</span></header>
    <section className="workspace" aria-label="시오스 작업 공간">
      <ProfileManager disabled={!snapshot || snapshot.storage.status === 'unavailable'} />
      {snapshot?.storage.status === 'unavailable' && <div className="storage-error" role="alert"><p>앱 데이터 저장소를 확인하지 못했습니다. 기존 파일을 초기화하지 않고 연결 기능을 잠갔습니다.</p><p>{snapshot.storage.path}</p><button onClick={() => { void window.sshOS.settings.retryStorage().catch(() => setError(true)); }}>저장소 다시 확인</button></div>}
      {snapshot?.storage.status === 'recovered' && <p className="storage-notice">백업 데이터를 복구했습니다. 연결할 때 서버 지문을 다시 확인하세요.</p>}
      <output aria-live="polite" data-testid="engine-state">{error ? '앱 상태를 확인하지 못했습니다.' : snapshot?.engine === 'ready' ? '연결 엔진 준비됨' : snapshot?.engine === 'stopped' ? '연결 엔진이 종료됐습니다.' : '연결 엔진 시작 중'}</output>
    </section>
    <aside className="transfers" aria-label="전송 상태"><strong>전송</strong><span>진행 중인 전송 없음</span><span>0개</span></aside>
    <footer><strong>sshOS</strong><span>0.1.0 · 개발 빌드</span><span>연결 0</span></footer>
  </main>;
}
const root = document.getElementById('root');
if (!root) throw new Error('App root missing');
createRoot(root).render(<App />);
