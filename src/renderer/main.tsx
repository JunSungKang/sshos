import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { runtimeSnapshotSchema, type DesktopBridge, type RuntimeSnapshot } from '../shared/contracts';
import './style.css';
import { DesktopShell } from './DesktopShell';

declare global { interface Window { sshOS: DesktopBridge } }

function App() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const update = () => { void window.sshOS.lifecycle.getSnapshot().then(value => { if (active){setSnapshot(runtimeSnapshotSchema.parse(value));setError(false);} }).catch(() => { if (active) setError(true); }); };
    update(); const timer = setInterval(update, 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <DesktopShell snapshot={snapshot} error={error} />;
}
const root = document.getElementById('root');
if (!root) throw new Error('App root missing');
createRoot(root).render(<App />);
