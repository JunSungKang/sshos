import { _electron as electron } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { root, localPath, runtimeEnvironment } from './environment.mjs';
const env = runtimeEnvironment('smoke');
Object.assign(process.env, env);
const { default: executablePath } = await import('electron');
const application = await electron.launch({ executablePath, args: [`--user-data-dir=${env.SSHOS_RUNTIME_ROOT}`, '--disable-background-networking', '--disable-component-update', root], cwd: root, env, timeout: 15000 });
application.process().stderr?.on('data', data => process.stderr.write(data));
try {
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  await page.getByTestId('engine-state').filter({ hasText: '연결 엔진 준비됨' }).waitFor();
  const snapshot = await page.evaluate(() => window.sshOS.lifecycle.getSnapshot());
  assert.equal(snapshot.engine, 'ready');
  assert.equal(snapshot.connectedServers, 0);
  const isolation = await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, keys: Object.keys(window.sshOS) }));
  assert.equal(isolation.require, 'undefined');
  assert.equal(isolation.process, 'undefined');
  assert.deepEqual([...isolation.keys].sort(), ['desktop', 'file', 'lifecycle', 'profile', 'session', 'settings', 'trust']);
  const savedId = await page.evaluate(async () => {
    const created = await window.sshOS.profile.create({ name: '로컬 저장 검사', host: 'example.invalid', port: 22, username: 'fixture', authentication: 'password' });
    const profiles = await window.sshOS.profile.list();
    if (!profiles.some(row => row.id === created.id)) throw new Error('Profile not saved');
    return created.id;
  });
  await page.reload();
  assert.equal(await page.evaluate(async id => (await window.sshOS.profile.list()).some(row => row.id === id), savedId), true);
  await page.evaluate(id => window.sshOS.profile.delete(id), savedId);
  await page.getByRole('navigation', { name: '앱 실행' }).getByRole('button', { name: '설정', exact: true }).dblclick();
  const settingsWindow = page.getByRole('region', { name: '설정', exact: true });
  await settingsWindow.waitFor();
  const initial = await settingsWindow.boundingBox(); assert.ok(initial);
  await page.mouse.move(initial.x + 180, initial.y + 20); await page.mouse.down(); await page.mouse.move(initial.x + 230, initial.y + 55, { steps: 5 }); await page.mouse.up();
  const moved = await settingsWindow.boundingBox(); assert.ok(moved); assert.ok(moved.x > initial.x);
  await page.getByRole('button', { name: '설정 최소화', exact: true }).click();
  assert.equal(await settingsWindow.isVisible(), false);
  await page.locator('.taskbar').getByRole('button', { name: '⚙ 설정', exact: true }).click();
  const restored = await settingsWindow.boundingBox(); assert.ok(restored); assert.equal(restored.x, moved.x); assert.equal(restored.y, moved.y);
  await page.getByRole('button', { name: '설정 최대화 또는 복원', exact: true }).click();
  const maximized = await settingsWindow.boundingBox(); assert.ok(maximized); assert.equal(maximized.y, 44);
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  const settings = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(settings.nodeIntegration, false);
  assert.equal(settings.contextIsolation, true);
  assert.equal(settings.sandbox, true);
  assert.equal(settings.webSecurity, true);
  const denied = await page.evaluate(async () => {
    try { await fetch('https://example.com'); return false; } catch { return true; }
  });
  assert.equal(denied, true);
  // DevTools evaluation can bypass the unsafe-eval CSP restriction. Inject an
  // actual page script to test inline blocking, then test eval in bundled code.
  const inlineBlocked = await page.evaluate(async () => {
    const script = document.createElement('script'); script.textContent = 'window.inlineSentinel = true'; document.body.append(script);
    await new Promise(resolve => setTimeout(resolve, 20));
    return window.inlineSentinel !== true;
  });
  assert.equal(inlineBlocked, true);
  await page.screenshot({ path: `${localPath('evidence')}/d01-desktop.png` });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].loadURL('app://ui/tests/xterm.html'));
  await page.getByTestId('xterm-ready').waitFor();
  assert.equal(await page.locator('.xterm-screen').count(), 1);
  assert.equal(await page.getByTestId('xterm-ready').getAttribute('data-eval-blocked'), 'true');
  const report = { status: 'pass', platform: process.platform, architecture: process.arch, versions: snapshot.versions, assertions: ['main/preload/renderer/utilityProcess handshake', 'sandbox, contextIsolation and Node isolation', 'profile persistence across UI reload', 'desktop window drag, minimize, restore and maximize', 'renderer external fetch and eval denied', 'xterm DOM renderer and addon-fit under production CSP'], limitation: 'Development executable on current machine only; no signing or Windows/Ubuntu result.' };
  writeFileSync(`${localPath('evidence')}/d01-smoke.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await application.close(); }
