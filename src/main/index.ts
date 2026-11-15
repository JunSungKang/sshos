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
import { MainReceiptChannel } from './receipt-channel';
import { NativeDialogGate } from './native-dialogs';
import { MutationController } from './mutations';
import { ViewerController } from './viewers';
import { TransferSelections } from './transfer-selections';
import { TransferPreviews } from './transfer-previews';
import { ExecutionPreviews } from './execution-previews';
import { ExecutionController } from './executions';
import { MainStorageRecovery } from './storage-recovery';
import { TransferController } from './transfers';

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
  const dialogGate=new NativeDialogGate();
  let connections: ConnectionController | null = null;
  let storageRecovering=false;
  let recoveryLocked=false;
  let repositoryOpening: Promise<void> | null = null;
  const openRepository = (): Promise<void> => {
    if (repositoryOpening) return repositoryOpening;
    repositoryOpening = (async () => {
      if (repository) await repository.retryStorage(); else repository = await StateRepository.open(dataRoot);
      profiles = new ProfileController(repository, () => win, id => connections?.isBusy(id) ?? false,dialogGate);
    })().finally(() => { repositoryOpening = null; });
    return repositoryOpening;
  };
  try { await openRepository(); } catch { /* Keep a locked, visible recovery UI instead of resetting data. */ }
  let receipts:ReceiptRepository|null=null;
  try { receipts=await ReceiptRepository.open(dataRoot); } catch { /* Keep changes locked and reads available. */ }
  const epoch = randomUUID();
  let engine: RuntimeSnapshot['engine'] = 'starting';
  const worker = utilityProcess.fork(resolve(__dirname, '../worker/index.js'), [epoch], { stdio: 'ignore', serviceName: 'sshOS connection engine' });
  const storageRecovery=new MainStorageRecovery(epoch,worker);
  const receiptChannel=new MainReceiptChannel(epoch,() => receipts,() => Boolean(repository && !repository.store.faulted && !storageRecovering && !recoveryLocked),message => worker.postMessage(message));
  let transfers:TransferController|null=null;
  let executions:ExecutionController|null=null;
  const gateway = new EngineGateway(worker, epoch, snapshot => connections?.observe(snapshot),receiptChannel,(snapshot,gap,sequence) => transfers?.observe(snapshot,gap,sequence),(snapshot,gap,sequence)=>executions?.observe(snapshot,gap,sequence));
  connections = new ConnectionController(() => repository, gateway, new SecretVault(safeStorage),() => Boolean(receipts && !receipts.faulted && !storageRecovering && !recoveryLocked));
  const desktop = new DesktopController(connections);
  const files = new FileController(desktop, connections, gateway);
  const viewers=new ViewerController(files,connections,desktop,gateway);
  const selections=new TransferSelections(dialogGate,() => win);
  const transferPreviews=new TransferPreviews(files,connections,gateway,selections,() => {if (!repository || repository.store.faulted || !receipts || receipts.faulted || storageRecovering || recoveryLocked) throw new Error('STORAGE_FAILED');});
  transfers=new TransferController(transferPreviews,selections,connections,gateway,() => receipts,() => Boolean(repository && !repository.store.faulted && !storageRecovering && !recoveryLocked),() => receiptChannel.settled());
  const executionPreviews=new ExecutionPreviews(files,connections,gateway,()=>{if(!repository || repository.store.faulted || !receipts || receipts.faulted || storageRecovering || recoveryLocked)throw new Error('STORAGE_FAILED');});
  executions=new ExecutionController(executionPreviews,connections,desktop,gateway,()=>receipts,()=>Boolean(repository && !repository.store.faulted && !storageRecovering && !recoveryLocked),()=>receiptChannel.settled());
  const mutations=new MutationController(files,connections,gateway,() => receipts,() => Boolean(repository && !repository.store.faulted && !storageRecovering && !recoveryLocked),id => transfers!.isActive(id) || executions!.isActive(id),async row => {if(row.kind === 'file_transfer')await transfers!.acknowledge(row);else if('exitObserved' in row)await executions!.releaseRecord(row);},() => [...transfers!.overlays(),...executions!.overlays()],id => transfers!.taskState(id));
  worker.on('message', (message: unknown) => {
    const parsed = workerEventSchema.safeParse(message);
    if (parsed.success && parsed.data.backendEpoch === epoch) engine = 'ready';
  });
  worker.on('exit', () => { engine = 'stopped'; connections?.engineStopped();void transfers?.engineStopped();void executions?.engineStopped(); });
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
        if (!profiles || action !== 'profile:list' && (!receipts || receipts.faulted || storageRecovering || recoveryLocked)) throw new Error('STORAGE_FAILED');
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
        if(action === 'desktop:closeWindow' && typeof payload === 'string' && desktop.findWindow(payload)?.kind === 'execution' && executions!.needsCloseConfirmation(payload))throw new Error('CLOSE_CONFIRM_REQUIRED');
        const result = desktop.handle(action, payload);
        if (action === 'desktop:closeWindow' && typeof payload === 'string') {executions?.detachWindow(payload);await viewers.closeWindow(payload);await files.closeWindow(payload).catch(() => {});}
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
  for (const action of ['transfer:pickUploadFiles','transfer:pickDownloadDirectory','transfer:previewUpload','transfer:previewDownload','transfer:getPreview','transfer:updatePreview','transfer:releasePreview','transfer:start','transfer:cancel','transfer:shelf']) {
    ipcMain.handle(action,async (event,payload:unknown) => {
      validateSender(event);
      try {if (payload !== undefined && Buffer.byteLength(JSON.stringify(payload))>65536) throw new Error('INPUT_INVALID');return await transfers!.handle(action,payload);}
      catch (error) {throw new Error(error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message) ? error.message : 'INPUT_INVALID');}
    });
  }
  for(const action of ['execution:context','execution:preview','execution:releasePreview','execution:start','execution:get','execution:reopen','execution:next','execution:previewAction','execution:applyAction']) {
    ipcMain.handle(action,async(event,payload:unknown)=>{validateSender(event,action === 'execution:next' ? viewerDataBudget:budget);try{if(payload !== undefined && Buffer.byteLength(JSON.stringify(payload))>65536)throw new Error('INPUT_INVALID');return await executions!.handle(action,payload);}catch(error){throw new Error(error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message) ? error.message:'INPUT_INVALID');}});
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
    if (storageRecovering) throw new Error('REQUEST_BUSY');
    const faulted=!repository || repository.store.faulted || !receipts || receipts.faulted || recoveryLocked;
    if (!faulted && (executions!.hasActive || mutations.hasRunning || transfers!.isRegistering || transfers!.overlays().some(row=>transfers!.isActive(row.taskId)))) throw new Error('REQUEST_BUSY');
    storageRecovering=true;let barrier:string|null=null;
    try {
      await transfers!.settled();await mutations.settled();barrier=await storageRecovery.barrier(faulted);recoveryLocked=true;
      await receiptChannel.settled();await receipts?.settled();await repository?.store.settled();await openRepository();receipts=await ReceiptRepository.open(dataRoot);
      await storageRecovery.reset(barrier);recoveryLocked=false;
    } catch (error) {if (barrier || faulted || !(error instanceof Error) || error.message !== 'REQUEST_BUSY') recoveryLocked=true;throw new Error(error instanceof Error && error.message === 'REQUEST_BUSY' ? 'REQUEST_BUSY' : 'STORAGE_FAILED');}
    finally {storageRecovering=false;}

  });
  ipcMain.handle('lifecycle:getSnapshot', (event, payload: unknown) => {
    validateSender(event);
    if (payload !== undefined) throw new Error('INPUT_INVALID');
    return runtimeSnapshotSchema.parse({ backendEpoch: epoch, engine, connectedServers: connections.views().filter(row => row.status === 'connected').length,
      storage: { status: !repository || repository.store.faulted || !receipts || receipts.faulted || storageRecovering || recoveryLocked ? 'unavailable' : repository.recovered ? 'recovered' : 'ready', path: dataRoot },
      appVersion: app.getVersion(), versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome } });
  });
  const createWindow = (): void => {
    win = new BrowserWindow({ width: 1400, height: 900, minWidth: 1120, minHeight: 760, show: false, backgroundColor: '#123C47', webPreferences: { preload: resolve(__dirname, '../preload/index.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: !app.isPackaged } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    let loaded=false;
    win.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame) => {if (loaded && isMainFrame) {viewers.interruptRenderer();transfers?.invalidateRenderer();executions?.invalidateRenderer();}});
    win.webContents.on('did-finish-load',() => {loaded=true;});
    win.webContents.on('render-process-gone',() => {viewers.interruptRenderer();transfers?.invalidateRenderer();executions?.invalidateRenderer();});
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
