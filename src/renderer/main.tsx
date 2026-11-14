import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { runtimeSnapshotSchema, type DesktopBridge, type RuntimeSnapshot } from '../shared/contracts';
import './style.css';

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
    <section className="welcome" aria-label="시오스 시작 화면">
      <div className="mark" aria-hidden="true">S</div>
      <p className="eyebrow">SSH DESKTOP WORKSPACE</p><h1>서버 작업을 하나의 공간에서.</h1>
      <p>Linux 서버의 파일과 실행을 연결하는 시오스입니다.</p>
      <p className="notice">개발 빌드 · 실행 기반 구성 단계입니다. 서버 연결 기능은 아직 제공하지 않습니다.</p>
      <output aria-live="polite" data-testid="engine-state">{error ? '앱 상태를 확인하지 못했습니다.' : snapshot?.engine === 'ready' ? '연결 엔진 준비됨' : snapshot?.engine === 'stopped' ? '연결 엔진이 종료됐습니다.' : '연결 엔진 시작 중'}</output>
    </section>
    <aside className="transfers" aria-label="전송 상태"><strong>전송</strong><span>진행 중인 전송 없음</span><span>0개</span></aside>
    <footer><strong>sshOS</strong><span>0.1.0 · 개발 빌드</span><span>연결 0</span></footer>
  </main>;
}
const root = document.getElementById('root');
if (!root) throw new Error('App root missing');
createRoot(root).render(<App />);
