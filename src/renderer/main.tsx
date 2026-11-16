import { useEffect, useRef, useState } from 'react';
import { applyTerminalDisplayLimit } from './terminal-display-guard';
import { createRoot } from 'react-dom/client';
import { runtimeSnapshotSchema, type DesktopBridge, type RuntimeSnapshot } from '../shared/contracts';
import './style.css';
import { DesktopShell } from './DesktopShell';
import {useAppearance} from './appearance';

declare global { interface Window { sshOS: DesktopBridge } }

function App() {
  useAppearance();
  const acknowledged=useRef<string|null>(null);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const update = () => { void window.sshOS.lifecycle.getSnapshot().then(value => { if (active){const parsed=runtimeSnapshotSchema.parse(value);if(parsed.displayLimitToken && acknowledged.current!==parsed.displayLimitToken){applyTerminalDisplayLimit(parsed.displayLimitToken);void window.sshOS.lifecycle.ackDisplayLimit(parsed.displayLimitToken).then(()=>{acknowledged.current=parsed.displayLimitToken;}).catch(()=>{});}setSnapshot(parsed);setError(false);} }).catch(() => { if (active) setError(true); }); };
    update(); const timer = setInterval(update, 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <DesktopShell snapshot={snapshot} error={error} />;
}
const root = document.getElementById('root');
if (!root) throw new Error('App root missing');
createRoot(root).render(<App />);
