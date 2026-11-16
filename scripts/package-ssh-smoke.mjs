import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { root, localPath, runtimeEnvironment, closeTestApplication } from './environment.mjs';
import { startSSHFixture } from './fixtures/ssh-server.mjs';

// Exercise the unmodified archived worker, not a copy of the development worker.
// The host development Electron supplies the parent/utility runtime; this is not
// a native launch of the fused target executable or an external OpenSSH test.
export async function checkPackagedSSH(path) {
  const archive = await realpath(path), part = relative(root, archive);
  if (!part || isAbsolute(part) || part === '..' || part.startsWith(`..${sep}`) || !archive.endsWith('.asar')) throw new Error('Workspace ASAR required');
  const id = randomUUID(), fixtureRoot = localPath(`fixtures/package-ssh-${id}`);
  const env = runtimeEnvironment(`package-ssh-${id}`);
  let fixture, application;
  try {
    await mkdir(join(fixtureRoot, 'etc'), { recursive: true });
    await mkdir(join(fixtureRoot, 'home/fixture/folder'), { recursive: true });
    await writeFile(join(fixtureRoot, 'etc/os-release'), 'ID=ubuntu\nVERSION_ID="24.04"\n');
    await writeFile(join(fixtureRoot, 'home/fixture/hello.txt'), 'fixture only\n');
    fixture = await startSSHFixture(fixtureRoot);
    const { default: executablePath } = await import('electron');
    application = await electron.launch({ executablePath, args: [`--user-data-dir=${env.SSHOS_RUNTIME_ROOT}`, root], cwd: root, env, timeout: 20000 });
    const page = await application.firstWindow();
    await page.getByTestId('engine-state').filter({ hasText: '연결 엔진 준비됨' }).waitFor({ timeout: 20000 });

    const run = (commands) => application.evaluate(async ({ utilityProcess }, { archive, epoch, commands }) => {
      const worker = utilityProcess.fork(`${archive}/dist/worker/index.js`, [epoch], { stdio: 'ignore', serviceName: 'sshOS archived SSH verification' });
      let index = 0;
      const results = [], finished = Promise.withResolvers();
      const timer = setTimeout(() => finished.reject(new Error('Archived SSH verification timed out')), 45000);
      worker.on('exit', () => finished.reject(new Error('Archived SSH worker exited before completion')));
      const send = () => worker.postMessage({ ...commands[index], backendEpoch: epoch });
      worker.on('message', event => {
        if (event.type === 'ready' && event.backendEpoch === epoch) { send(); return; }
        if (event.type !== 'response' || event.backendEpoch !== epoch || event.requestId !== commands[index]?.requestId) return;
        if (!event.ok) { finished.reject(new Error(`Archived SSH command failed: ${/^[A-Z_]{1,64}$/u.test(event.errorCode) ? event.errorCode : 'INTERNAL_ERROR'}`)); return; }
        results.push(event.result);
        if (++index === commands.length) finished.resolve(results); else send();
      });
      try { return await finished.promise; }
      finally { clearTimeout(timer); worker.kill(); }
    }, { archive, epoch: randomUUID(), commands });
    const serverId = randomUUID();
    const command = (value) => ({ serverId, generation: 1, requestId: randomUUID(), ...value });
    const payload = { host: '127.0.0.1', port: fixture.port, username: 'fixture', authentication: 'password', password: 'test-only', trustedHostKey: null };

    const [observed] = await run([command({ action: 'session:connect', payload })]);
    assert.equal(observed.status, 'awaiting_host_trust');
    assert.equal(observed.publicKey, fixture.publicKey.toString('base64'));
    assert.equal(fixture.metrics.authenticationRequests, 0, 'Unknown host must not receive credentials');

    const [connected, listing] = await run([
      command({ action: 'session:connect', payload: { ...payload, trustedHostKey: fixture.publicKey.toString('base64') } }),
      command({ action: 'file:list', browserId: randomUUID(), path: '/home/fixture' }),
      command({ action: 'session:disconnect' })
    ]);
    assert.equal(connected.status, 'connected');
    assert.equal(connected.snapshot.sftp, 'available');
    assert.equal(connected.snapshot.os, 'supported');
    assert.equal(connected.snapshot.homePath, '/home/fixture');
    assert.ok(fixture.metrics.authenticationRequests > 0);
    assert.deepEqual(listing.entries.map(row => [row.name, row.type]), [['folder', 'directory'], ['hello.txt', 'file']]);
    assert.equal(fixture.metrics.mutations.length, 0);
    return { status: 'pass', assertions: ['archived worker host-key observation without authentication', 'pinned password authentication', 'SFTP home/OS inspection and directory enumeration'], runtime: { platform: process.platform, architecture: process.arch }, scope: 'Host development Electron with actual target ASAR and loopback ssh2 fixture; target executable launch and real OpenSSH remain untested.' };
  } finally {
    try { if (application) await closeTestApplication(application); }
    finally {
      if (fixture) await fixture.close();
      await rm(fixtureRoot, { recursive: true, force: true });
      await rm(env.SSHOS_RUNTIME_ROOT, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/package-ssh-smoke.mjs <workspace-app.asar>');
  console.log(JSON.stringify(await checkPackagedSSH(process.argv[2])));
}
