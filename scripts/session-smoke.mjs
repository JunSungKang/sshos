import { fixtureKey } from './fixtures/keys.mjs';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { _electron as electron, expect } from '@playwright/test';
import ssh2 from 'ssh2';
import { strict as assert } from 'node:assert';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, localPath, runtimeEnvironment,closeTestApplication } from './environment.mjs';

const env = runtimeEnvironment(`session-${randomUUID()}`); Object.assign(process.env, env);
const { Server, utils } = ssh2;
const { default: executablePath } = await import('electron');
// Ephemeral fixture keys never leave process memory or get written to the repo.
const host = fixtureKey();
const connections = new Set(); let authenticationRequests = 0;
const server = new Server({ hostKeys: [host.private] }, connection => {
  connections.add(connection); connection.on('close', () => connections.delete(connection)); connection.on('error', () => {});
  connection.on('authentication', ctx => {
    authenticationRequests++;
    if (ctx.method === 'password' && ctx.username === 'fixture' && ctx.password === 'test-only') ctx.accept(); else ctx.reject(['password']);
  });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
let application;
try {
  application = await electron.launch({ executablePath, args: [`--user-data-dir=${env.SSHOS_RUNTIME_ROOT}`, root], cwd: root, env, timeout: 15000 });
  const page = await application.firstWindow(); page.setDefaultTimeout(15000);
  await page.getByTestId('engine-state').filter({ hasText: '연결 엔진 준비됨' }).waitFor();
  const id = await page.evaluate(async port => {
    const profile = await window.sshOS.profile.create({ name: 'SSH 연결 검사', host: '127.0.0.1', port, username: 'fixture', authentication: 'password' });
    await window.sshOS.session.connect(profile.id, { password: 'test-only', saveSecret: false });
    return profile.id;
  }, port);
  assert.equal(authenticationRequests, 0);
  await page.getByRole('heading', { name: '서버 지문 확인' }).waitFor();
  await page.getByRole('button', { name: '지문을 확인하고 연결' }).click();
  await expect.poll(() => page.evaluate(async id => (await window.sshOS.session.list()).sessions.some(row => row.serverId === id && row.status === 'connected' && row.sessionToken !== null),id),{timeout:15000}).toBe(true);
  assert.equal(authenticationRequests, 1);
  const snapshot = await page.evaluate(() => window.sshOS.lifecycle.getSnapshot()); assert.equal(snapshot.connectedServers, 1);
  const connection = await page.evaluate(async id => (await window.sshOS.session.list()).sessions.find(row => row.serverId === id), id);
  assert.equal(connection.sftp, 'unavailable');
  // Capability rejection must not turn a valid SSH connection into a failure.
  await page.evaluate(id => window.sshOS.session.confirmOS(id, 2), id);
  await page.screenshot({ path: `${localPath('evidence')}/d03-session.png` });
  await application.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
  await page.evaluate(async id => { await window.sshOS.session.disconnect(id); await window.sshOS.profile.delete(id); }, id);
  const dataPath = join(env.SSHOS_RUNTIME_ROOT, 'data');
  for (const name of readdirSync(dataPath)) if (name.endsWith('.json') || name.endsWith('.bak')) assert.equal(readFileSync(join(dataPath, name), 'utf8').includes('test-only'), false);
  const report = { status: 'pass', host: process.platform, architecture: process.arch, authenticationRequests, assertions: ['unknown host rejected before authentication', 'native GUI host trust confirmation', 'fresh verified SSH password authentication', 'SFTP rejection leaves SSH connected', 'session-specific OS confirmation', 'disconnect and profile cleanup'], limitation: 'Loopback ssh2 fixture, not a manual Ubuntu/OpenSSH target acceptance result.' };
  writeFileSync(`${localPath('evidence')}/d03-session.json`, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} finally {
  if (application) await closeTestApplication(application);
  for (const connection of connections) connection.end();
  await new Promise(resolve => server.close(resolve));
  await rm(env.SSHOS_RUNTIME_ROOT,{recursive:true,force:true});
}
