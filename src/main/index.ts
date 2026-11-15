import { app, BrowserWindow, ipcMain, Menu, protocol, session, utilityProcess, safeStorage } from 'electron';
import { readFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { CSP, isAppOrigin, RequestBudget, resolveAsset } from './security';
import { runtimeSnapshotSchema, workerEventSchema, type RuntimeSnapshot } from '../shared/contracts';
import { StateRepository } from './persistence/state-repository';
import { ProfileController } from './profiles';
import { ConnectionController } from './connections';
import { EngineGateway } from './engine-gateway';
import { SecretVault } from './persistence/secrets';
import { DesktopController } from './desktop';
import { FileController } from './files';
import { ReceiptRepository } from './persistence/receipts';
import { MutationController } from './mutations';
import { ViewerController } from './viewers';

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
  const dataRoot = resolve(app.getPath('userData'), 'data');
  let repository: StateRepository | null = null;
  let profiles: ProfileController | null = null;
  let connections: ConnectionController | null = null;
  let repositoryOpening: Promise<void> | null = null;
  const openRepository = (): Promise<void> => {
    if (repositoryOpening) return repositoryOpening;
    repositoryOpening = (async () => {
      if (repository) await repository.retryStorage(); else repository = await StateRepository.open(dataRoot);
      profiles = new ProfileController(repository, () => win, id => connections?.isBusy(id) ?? false);
    })().finally(() => { repositoryOpening = null; });
    return repositoryOpening;
  };
  try { await openRepository(); } catch { /* Keep a locked, visible recovery UI instead of resetting data. */ }
  let receipts:ReceiptRepository|null=null;
  try { receipts=await ReceiptRepository.open(dataRoot); } catch { /* Keep changes locked and reads available. */ }
  const epoch = randomUUID();
  let engine: RuntimeSnapshot['engine'] = 'starting';
  const worker = utilityProcess.fork(resolve(__dirname, '../worker/index.js'), [epoch], { stdio: 'ignore', serviceName: 'sshOS connection engine' });
  const gateway = new EngineGateway(worker, epoch, snapshot => connections?.observe(snapshot));
  connections = new ConnectionController(() => repository, gateway, new SecretVault(safeStorage),() => Boolean(receipts && !receipts.faulted));
  const desktop = new DesktopController(connections);
  const files = new FileController(desktop, connections, gateway);
  const viewers=new ViewerController(files,connections,desktop,gateway);
  const mutations=new MutationController(files,connections,gateway,() => receipts,() => Boolean(repository && !repository.store.faulted));
  worker.on('message', (message: unknown) => {
    const parsed = workerEventSchema.safeParse(message);
    if (parsed.success && parsed.data.backendEpoch === epoch) engine = 'ready';
  });
  worker.on('exit', () => { engine = 'stopped'; connections?.engineStopped(); });
  const budget = new RequestBudget();
  const viewerDataBudget=new RequestBudget(undefined,32,128);
  const validateSender = (event: Electron.IpcMainInvokeEvent,requestBudget=budget) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !isAppOrigin(event.senderFrame.url)) throw new Error('IPC_DENIED');
    if (!requestBudget.take()) throw new Error('INPUT_INVALID');
  };
  for (const action of ['profile:list', 'profile:create', 'profile:update', 'profile:delete', 'profile:pickKey']) {
    ipcMain.handle(action, async (event, payload: unknown) => {
      validateSender(event);
      try {
        if (!profiles) throw new Error('STORAGE_FAILED');
        if (payload !== undefined && Buffer.byteLength(JSON.stringify(payload)) > 65536) throw new Error('INPUT_INVALID');
        return await profiles.handle(action, payload);
      }
      catch (error) { throw new Error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INPUT_INVALID'); }
    });
  }
  for (const action of ['session:list', 'session:connect', 'session:disconnect', 'session:confirmOS', 'trust:approve', 'trust:reject']) {
    ipcMain.handle(action, async (event, payload: unknown) => {
      validateSender(event);
      try {
        if (!connections || engine !== 'ready') throw new Error('ENGINE_STOPPED');
        if (payload !== undefined && Buffer.byteLength(JSON.stringify(payload)) > 65536) throw new Error('INPUT_INVALID');
        return await connections.handle(action, payload);
      } catch (error) { throw new Error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INPUT_INVALID'); }
    });
  }
  for (const action of ['desktop:getWindowSnapshot', 'desktop:registerWindow', 'desktop:updateWindowLayout', 'desktop:closeWindow']) {
    ipcMain.handle(action, async (event, payload: unknown) => {
      validateSender(event);
      try {
        if (payload !== undefined && Buffer.byteLength(JSON.stringify(payload)) > 65536) throw new Error('INPUT_INVALID');
        const result = desktop.handle(action, payload);
        if (action === 'desktop:closeWindow' && typeof payload === 'string') {await viewers.closeWindow(payload);await files.closeWindow(payload).catch(() => {});}
        return result;
      } catch (error) { throw new Error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INPUT_INVALID'); }
    });
  }
  for (const action of ['file:open', 'file:list', 'file:enter', 'file:page']) {
    ipcMain.handle(action, async (event, payload: unknown) => {
      validateSender(event);
      try {
        if (engine !== 'ready') throw new Error('ENGINE_STOPPED');
        if (payload !== undefined && Buffer.byteLength(JSON.stringify(payload)) > 65536) throw new Error('INPUT_INVALID');
        return await files.handle(action, payload);
      } catch (error) { throw new Error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INPUT_INVALID'); }
    });
  }
  for (const action of ['file:previewMutation','file:startMutation','task:list','task:inspect','task:previewRecordAction','task:applyRecordAction']) {
    ipcMain.handle(action,async (event,payload:unknown) => {
      validateSender(event);
      try {
        if (payload !== undefined && Buffer.byteLength(JSON.stringify(payload))>65536) throw new Error('INPUT_INVALID');
        return await mutations.handle(action,payload);
      } catch (error) { throw new Error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INPUT_INVALID'); }
    });
  }
  for (const action of ['viewer:probe','viewer:next','viewer:releaseProbe','viewer:open','viewer:get','viewer:reread','viewer:stopRead']) {
    ipcMain.handle(action,async (event,payload:unknown) => {
      validateSender(event,action === 'viewer:next' ? viewerDataBudget : budget);
      try {
        if (payload !== undefined && Buffer.byteLength(JSON.stringify(payload))>(action === 'viewer:next' ? 256 : 65536)) throw new Error('INPUT_INVALID');
        return await viewers.handle(action,payload);
      } catch (error) {throw new Error(error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message) ? error.message : 'INPUT_INVALID');}
    });
  }
  ipcMain.handle('settings:retryStorage', async (event, payload: unknown) => {
    validateSender(event); if (payload !== undefined) throw new Error('INPUT_INVALID');
    try { await mutations.settled(); await receipts?.settled(); await openRepository(); receipts=await ReceiptRepository.open(dataRoot); } catch { throw new Error('STORAGE_FAILED'); }
  });
  ipcMain.handle('lifecycle:getSnapshot', (event, payload: unknown) => {
    validateSender(event);
    if (payload !== undefined) throw new Error('INPUT_INVALID');
    return runtimeSnapshotSchema.parse({ backendEpoch: epoch, engine, connectedServers: connections.views().filter(row => row.status === 'connected').length,
      storage: { status: !repository || repository.store.faulted || !receipts || receipts.faulted ? 'unavailable' : repository.recovered ? 'recovered' : 'ready', path: dataRoot },
      appVersion: app.getVersion(), versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome } });
  });
  const createWindow = (): void => {
    win = new BrowserWindow({ width: 1400, height: 900, minWidth: 1120, minHeight: 760, show: false, backgroundColor: '#123C47', webPreferences: { preload: resolve(__dirname, '../preload/index.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: !app.isPackaged } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    let loaded=false;
    win.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame) => {if (loaded && isMainFrame) viewers.interruptRenderer();});
    win.webContents.on('did-finish-load',() => {loaded=true;});
    win.webContents.on('render-process-gone',() => viewers.interruptRenderer());
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
