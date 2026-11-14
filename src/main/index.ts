import { app, BrowserWindow, ipcMain, Menu, protocol, session, utilityProcess } from 'electron';
import { readFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { CSP, isAppOrigin, RequestBudget, resolveAsset } from './security';
import { runtimeSnapshotSchema, workerEventSchema, type RuntimeSnapshot } from '../shared/contracts';

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('sshOS');

async function main(): Promise<void> {
  // Development must never choose an implicit home-directory userData path.
  if (!app.isPackaged) {
    const root = await realpath(resolve(__dirname, '../..'));
    const requested = process.env['SSHOS_RUNTIME_ROOT'];
    if (!requested) throw new Error('Development runtime root is required');
    const dir = resolve(requested);
    const rel = relative(root, dir);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Runtime path outside workspace');
    let ancestor = dir;
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    const parentRel = relative(root, await realpath(ancestor));
    if (isAbsolute(parentRel) || parentRel === '..' || parentRel.startsWith(`..${sep}`)) throw new Error('Runtime parent symlink outside workspace');
    await mkdir(dir, { recursive: true });
    const actual = await realpath(dir);
    const realRel = relative(root, actual);
    if (isAbsolute(realRel) || realRel === '..' || realRel.startsWith(`..${sep}`)) throw new Error('Runtime symlink outside workspace');
    const children: Record<string, string> = {};
    for (const name of ['runtime', 'crashes', 'logs']) {
      const target = resolve(actual, name);
      if (existsSync(target)) {
        const childRel = relative(actual, await realpath(target));
        if (isAbsolute(childRel) || childRel === '..' || childRel.startsWith(`..${sep}`)) throw new Error('Runtime child symlink outside workspace');
      }
      await mkdir(target, { recursive: true });
      children[name] = target;
    }
    app.setPath('userData', actual);
    app.setPath('sessionData', children['runtime']!);
    app.setPath('crashDumps', children['crashes']!);
    app.setAppLogsPath(children['logs']!);
  }
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  await app.whenReady();
  Menu.setApplicationMenu(null);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', event => event.preventDefault());
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAppOrigin(details.url) }));
  ses.protocol.handle('app', async request => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    try {
      if (app.isPackaged && new URL(request.url).pathname.startsWith('/tests/')) return new Response(null, { status: 404 });
      const asset = await resolveAsset(resolve(__dirname, '../renderer'), request.url);
      const data = await readFile(asset.path);
      return new Response(new Uint8Array(data), { headers: { 'Content-Type': asset.mime, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
    } catch { return new Response(null, { status: 404 }); }
  });
  let win: BrowserWindow | null = null;
  const epoch = randomUUID();
  let engine: RuntimeSnapshot['engine'] = 'starting';
  const worker = utilityProcess.fork(resolve(__dirname, '../worker/index.js'), [epoch], { stdio: 'ignore', serviceName: 'sshOS connection engine' });
  worker.on('message', (message: unknown) => {
    const parsed = workerEventSchema.safeParse(message);
    if (parsed.success && parsed.data.backendEpoch === epoch) engine = 'ready';
  });
  worker.on('exit', () => { engine = 'stopped'; });
  const budget = new RequestBudget();
  ipcMain.handle('lifecycle:getSnapshot', (event, payload: unknown) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !isAppOrigin(event.senderFrame.url)) throw new Error('IPC_DENIED');
    if (payload !== undefined || !budget.take()) throw new Error('INPUT_INVALID');
    return runtimeSnapshotSchema.parse({ backendEpoch: epoch, engine, connectedServers: 0, appVersion: app.getVersion(), versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome } });
  });
  const createWindow = (): void => {
    win = new BrowserWindow({ width: 1400, height: 900, minWidth: 1120, minHeight: 760, show: false, backgroundColor: '#123C47', webPreferences: { preload: resolve(__dirname, '../preload/index.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: !app.isPackaged } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.on('ready-to-show', () => win?.show());
    win.on('closed', () => { win = null; });
    void win.loadURL('app://ui/');
  };
  app.on('second-instance', () => { if (win?.isMinimized()) win.restore(); win?.focus(); });
  app.on('activate', () => { if (!win) createWindow(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { worker.kill(); });
  createWindow();
}

void main().catch(() => { console.error('STARTUP_FAILED'); app.exit(1); });
