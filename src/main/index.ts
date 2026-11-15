import { LicensesController } from './licenses';
import { DiagnosticLog } from './diagnostic-log';
import { DiagnosticsController } from './diagnostics';
import { errorCodeOf } from '../shared/errors';
import { SettingsController } from './settings';
import { RendererMemoryGuard } from './renderer-memory';
import { ResponseProbe } from './probes';
import { z } from 'zod';
import { inShutdownScope,shutdownSummary,runShutdown,type ShutdownScope } from './shutdown';
import { app, BrowserWindow, ipcMain, Menu, dialog, powerMonitor, protocol, session, utilityProcess, safeStorage } from 'electron';
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
import { TerminalController } from './terminals';
import { TerminalPasteGesture } from './terminal-gestures';
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
  let win: BrowserWindow | null = null;let replacingRenderer=false,uiReady=false;let lifecycleClosing=false,quitFinal=false,quitPrompt=false;let powerTransition=false,powerSequence=0;
  const dataRoot = resolve(app.getPath('userData'), 'data');
  const diagnosticLog=await DiagnosticLog.create(resolve(app.getPath('logs'),'events'),app.getVersion()).catch(()=>null);diagnosticLog?.record({to:'starting'});
  let repository: StateRepository | null = null;
  let profiles: ProfileController | null = null;
  const dialogGate=new NativeDialogGate();
  const pasteGesture=new TerminalPasteGesture();
  let connections: ConnectionController | null = null;
  let storageRecovering=false;let recoveryAccepting=false;
  let recoveryLocked=false;
  let repositoryOpening: Promise<void> | null = null;
  const openRepository = (): Promise<void> => {
    if (repositoryOpening) return repositoryOpening;
    repositoryOpening = (async () => {
      if (repository) await repository.retryStorage(); else repository = await StateRepository.open(dataRoot);
      profiles?.invalidate();profiles = new ProfileController(repository, () => win, id => connections?.isBusy(id) ?? false,dialogGate);
    })().finally(() => { repositoryOpening = null; });
    return repositoryOpening;
  };
  try { await openRepository(); } catch { /* Keep a locked, visible recovery UI instead of resetting data. */ }
  let receipts:ReceiptRepository|null=null;
  try { receipts=await ReceiptRepository.open(dataRoot); } catch { /* Keep changes locked and reads available. */ }
  let epoch = randomUUID();
  let engine: RuntimeSnapshot['engine'] = 'starting';
  let worker = utilityProcess.fork(resolve(__dirname, '../worker/index.js'), [epoch], { stdio: 'ignore', serviceName: 'sshOS connection engine' });
  let storageRecovery=new MainStorageRecovery(epoch,worker);
  let receiptChannel=new MainReceiptChannel(epoch,() => receipts,() => Boolean(repository && !repository.store.faulted && (recoveryAccepting || !storageRecovering && !recoveryLocked)),message => worker.postMessage(message));
  let transfers:TransferController|null=null;
  let executions:ExecutionController|null=null;
  let terminals:TerminalController|null=null;let responseProbe:ResponseProbe|null=null;
  const gateway = new EngineGateway(worker, epoch, snapshot => {diagnosticLog?.record({to:snapshot.status,...(snapshot.errorCode ? {errorCode:errorCodeOf(snapshot.errorCode)}:{})});connections?.observe(snapshot);responseProbe?.refresh();executions?.sessionChanged(snapshot.serverId,snapshot.generation,snapshot.status === 'connected');terminals?.sessionChanged(snapshot.serverId,snapshot.generation,snapshot.status === 'connected');},receiptChannel,(snapshot,gap,sequence) => {diagnosticLog?.record({taskId:snapshot.taskId,to:snapshot.phase,...(snapshot.errorCode ? {errorCode:errorCodeOf(snapshot.errorCode)}:{})});transfers?.observe(snapshot,gap,sequence);},(snapshot,gap,sequence)=>{diagnosticLog?.record({taskId:snapshot.receipt.taskId,to:snapshot.receipt.phase,...(snapshot.receipt.errorCode ? {errorCode:errorCodeOf(snapshot.receipt.errorCode)}:{})});executions?.observe(snapshot,gap,sequence);},(snapshot,gap,sequence)=>{diagnosticLog?.record({taskId:snapshot.execution.receipt.taskId,to:snapshot.execution.receipt.phase,...(snapshot.execution.receipt.errorCode ? {errorCode:errorCodeOf(snapshot.execution.receipt.errorCode)}:{})});terminals?.observe(snapshot,gap,sequence);},value=>mutations.observe(value));
  connections = new ConnectionController(() => repository, gateway, new SecretVault(safeStorage),() => Boolean(receipts && !receipts.faulted && !storageRecovering && !recoveryLocked && !lifecycleClosing && !powerTransition));
  const desktop = new DesktopController(connections);
  const files = new FileController(desktop, connections, gateway);
  const viewers=new ViewerController(files,connections,desktop,gateway);
  const selections=new TransferSelections(dialogGate,() => win);
  const transferPreviews=new TransferPreviews(files,connections,gateway,selections,() => {if (!repository || repository.store.faulted || !receipts || receipts.faulted || storageRecovering || recoveryLocked || lifecycleClosing || powerTransition) throw new Error('STORAGE_FAILED');});
  transfers=new TransferController(transferPreviews,selections,connections,gateway,() => receipts,() => Boolean(repository && !repository.store.faulted && !storageRecovering && !recoveryLocked && !lifecycleClosing && !powerTransition),() => receiptChannel.settled());
  const executionPreviews=new ExecutionPreviews(files,connections,gateway,()=>{if(!repository || repository.store.faulted || !receipts || receipts.faulted || storageRecovering || recoveryLocked || lifecycleClosing || powerTransition)throw new Error('STORAGE_FAILED');});
  executions=new ExecutionController(executionPreviews,connections,desktop,gateway,()=>receipts,()=>Boolean(repository && !repository.store.faulted && !storageRecovering && !recoveryLocked && !lifecycleClosing && !powerTransition),()=>receiptChannel.settled());
  terminals=new TerminalController(connections,desktop,gateway,()=>receipts,()=>Boolean(repository && !repository.store.faulted && !storageRecovering && !recoveryLocked && !lifecycleClosing && !powerTransition),()=>win,pasteGesture,()=>receiptChannel.settled());
  const mutations=new MutationController(files,connections,gateway,() => receipts,() => Boolean(repository && !repository.store.faulted && !storageRecovering && !recoveryLocked && !lifecycleClosing && !powerTransition),id => transfers!.isActive(id) || executions!.isActive(id) || terminals!.isActive(id),async row => {if(row.kind === 'file_transfer')await transfers!.acknowledge(row);else if(row.kind === 'gui_exec')await executions!.releaseRecord(row);else if(row.kind === 'pty')await terminals!.releaseRecord(row);},() => [...transfers!.overlays(),...executions!.overlays(),...terminals!.overlays()],id => transfers!.taskState(id));
  responseProbe=new ResponseProbe(gateway,()=>connections!.views(),()=>Boolean(uiReady && win && !win.isDestroyed() && !win.isMinimized() && win.isFocused() && !lifecycleClosing && !powerTransition),id=>transfers!.overlays().some(row=>row.serverId===id && transfers!.isActive(row.taskId)));
  let engineStopping:Promise<void>=Promise.resolve(),engineRestarting=false;
  const observeEngine=(observed:Electron.UtilityProcess,observedEpoch:string):Promise<void>=>new Promise((resolveReady,rejectReady)=>{
    let ready=false;const timer=setTimeout(()=>{if(!ready){observed.kill();rejectReady(new Error('ENGINE_STOPPED'));}},10000);timer.unref();
    observed.on('message',(message:unknown)=>{if(worker !== observed || epoch !== observedEpoch)return;const parsed=workerEventSchema.safeParse(message);if(parsed.success && parsed.data.backendEpoch === observedEpoch){ready=true;clearTimeout(timer);engine='ready';resolveReady();}});
    observed.on('exit',()=>{clearTimeout(timer);if(!ready)rejectReady(new Error('ENGINE_STOPPED'));if(worker !== observed || epoch !== observedEpoch)return;engine='stopped';diagnosticLog?.record({to:'stopped',errorCode:'ENGINE_STOPPED'});const previous=connections!.views();connections!.engineStopped();responseProbe?.invalidate();for(const row of previous){executions!.sessionChanged(row.serverId,row.generation,false);terminals!.sessionChanged(row.serverId,row.generation,false);}viewers.interruptRenderer();transfers!.invalidateRenderer();executionPreviews.invalidate();profiles?.invalidate();engineStopping=Promise.allSettled([mutations.settled(),transfers!.engineStopped(),executions!.engineStopped(),terminals!.engineStopped()]).then(()=>{});});
  });
  void observeEngine(worker,epoch).catch(()=>{});
  const activeOperation=(id:string)=>mutations.isActive(id) || transfers!.isActive(id) || executions!.isActive(id) || terminals!.isActive(id);
  const shutdown=async(scope:ShutdownScope,budgetMs=10000)=>{
    const targets=connections!.views().filter(row=>!scope || row.serverId===scope.serverId && row.generation===scope.generation);for(const row of targets)connections!.beginDisconnect(row.serverId,row.generation);
    return runShutdown({interrupt:()=>Promise.allSettled([transfers!.cancelForShutdown(scope?.serverId,scope?.generation),executions!.closeForShutdown(scope?.serverId,scope?.generation),terminals!.closeForShutdown(scope?.serverId,scope?.generation)]).then(()=>{}),finalizing:()=>transfers!.hasFinalizing(scope?.serverId,scope?.generation),disconnect:()=>Promise.allSettled(targets.map(row=>connections!.disconnect(row.serverId,row.generation))).then(()=>{}),active:()=>mutations.snapshots().some(row=>inShutdownScope(row,scope) && activeOperation(row.taskId)),settled:async()=>{await receiptChannel.settled();await receipts?.settled();await repository?.store.settled();}},budgetMs);
  };
  let powerWork:Promise<void>|null=null;
  const invalidatePower=()=>{
    if(quitFinal || lifecycleClosing)return;powerSequence++;powerTransition=true;responseProbe?.invalidate();profiles?.invalidate();executionPreviews.invalidate();transfers!.invalidateRenderer();viewers.interruptRenderer();
    const targets=connections!.views().filter(row=>!['idle','disconnected','failed'].includes(row.status));for(const row of targets){connections!.beginDisconnect(row.serverId,row.generation);executions!.sessionChanged(row.serverId,row.generation,false);terminals!.sessionChanged(row.serverId,row.generation,false);}if(powerWork)return;
    // Dispatch disconnect immediately: an OS suspend cannot wait for a final link.
    const draining=Promise.allSettled([transfers!.cancelForShutdown(),executions!.closeForShutdown(),terminals!.closeForShutdown(),...targets.map(row=>connections!.disconnect(row.serverId,row.generation))]).then(()=>{});let timer:ReturnType<typeof setTimeout>;
    powerWork=Promise.race([draining,new Promise<void>(done=>{timer=setTimeout(done,10000);})]).finally(()=>{clearTimeout(timer!);powerTransition=false;powerWork=null;});
  };
  powerMonitor.on('suspend',invalidatePower);powerMonitor.on('resume',invalidatePower);
  const disconnectPrompts=new Set<string>();
  const confirmDisconnect=async(id:string)=>{const current=connections!.views().find(row=>row.serverId===id);if(!current || ['idle','disconnected'].includes(current.status))return;if(disconnectPrompts.has(id) || quitPrompt || lifecycleClosing)throw new Error('REQUEST_BUSY');disconnectPrompts.add(id);try{const owner=win;if(!owner || owner.isDestroyed())throw new Error('IPC_DENIED');const scope={serverId:id,generation:current.generation},answer=await dialog.showMessageBox(owner,{type:'question',title:'서버 연결 해제',message:`${current.serverName} 연결을 해제할까요?`,detail:`${current.username}@${current.host}:${current.port}\n${shutdownSummary(mutations.snapshots(),activeOperation,scope)}`,buttons:['연결 유지','작업 중단 후 연결 해제'],defaultId:0,cancelId:0,noLink:true});if(answer.response!==1)return;const latest=connections!.views().find(row=>row.serverId===id);if(!latest || latest.generation!==scope.generation)throw new Error('TOKEN_EXPIRED');const result=await shutdown(scope);if(result.timedOut)throw new Error('IO_TIMEOUT');}finally{disconnectPrompts.delete(id);}};
  const requestQuit=async()=>{if(quitFinal || quitPrompt || lifecycleClosing)return;quitPrompt=true;try{const options:Electron.MessageBoxOptions={type:'question',title:'sshOS 종료',message:'작업을 중단하고 sshOS를 종료할까요?',detail:shutdownSummary(mutations.snapshots(),activeOperation,null),buttons:['계속 실행','작업 중단 후 종료'],defaultId:0,cancelId:0,noLink:true};const owner=win,answer=owner && !owner.isDestroyed() ? await dialog.showMessageBox(owner,options):await dialog.showMessageBox(options);if(answer.response!==1)return;lifecycleClosing=true;profiles?.invalidate();executionPreviews.invalidate();transfers!.invalidateRenderer();const hard=setTimeout(()=>{quitFinal=true;worker.kill();app.exit(0);},9500);try{await shutdown(null,9500);}finally{clearTimeout(hard);quitFinal=true;worker.kill();app.quit();}}catch{if(lifecycleClosing){quitFinal=true;worker.kill();app.exit(0);}}finally{quitPrompt=false;}};
  const budget = new RequestBudget();
  const terminalInputBudget=new RequestBudget(undefined,240,720);
  const viewerDataBudget=new RequestBudget(undefined,32,128);
  const validateSender = (event: Electron.IpcMainInvokeEvent,requestBudget=budget) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !isAppOrigin(event.senderFrame.url)) throw new Error('IPC_DENIED');
    if (!requestBudget.take()) throw new Error('INPUT_INVALID');
  };
  const licenses=new LicensesController(app.isPackaged ? resolve(process.resourcesPath,'licenses'):resolve(__dirname,'../../.local/build-resources/licenses'));
  for(const action of ['settings:showLicenses','settings:licensePage'])ipcMain.handle(action,async(event,payload:unknown)=>{validateSender(event);try{if(action==='settings:showLicenses'){if(payload!==undefined)throw new Error('INPUT_INVALID');return await licenses.list();}return await licenses.page(payload);}catch(error){throw new Error(error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message)?error.message:'INPUT_INVALID');}});
  const diagnostics=new DiagnosticsController(diagnosticLog,()=>({appVersion:app.getVersion(),electron:process.versions.electron,node:process.versions.node,chrome:process.versions.chrome,platform:process.platform as 'darwin'|'win32'|'linux',architecture:process.arch as 'arm64'|'x64',engine,connectedServers:connections!.views().filter(row=>row.status==='connected').length,activeTasks:mutations.snapshots().filter(row=>activeOperation(row.taskId)).length}),()=>win,dialogGate);
  for(const action of ['settings:previewDiagnostics','settings:exportRedactedDiagnostics','settings:releaseDiagnostics'])ipcMain.handle(action,async(event,payload:unknown)=>{validateSender(event);try{if(action==='settings:previewDiagnostics'){if(payload!==undefined)throw new Error('INPUT_INVALID');return await diagnostics.preview();}const token=z.uuid().parse(payload);return action==='settings:releaseDiagnostics' ? diagnostics.release(token):await diagnostics.export(token);}catch(error){diagnosticLog?.record({errorCode:errorCodeOf(error)});throw new Error(error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message) ? error.message:'INTERNAL_ERROR');}});
  const settings=new SettingsController(()=>repository,()=>Boolean(receipts && !receipts.faulted && !storageRecovering && !recoveryLocked && !lifecycleClosing && !powerTransition),async target=>{const owner=win;if(!owner || owner.isDestroyed())throw new Error('IPC_DENIED');return dialogGate.run(owner.webContents.id,async()=>{const answer=await dialog.showMessageBox(owner,{type:'warning',title:target.kind==='trust' ? '저장 지문 삭제':'저장 인증정보 삭제',message:target.kind==='trust' ? '이 endpoint의 모든 연결과 작업을 종료하고 지문을 삭제할까요?':'이 프로필의 작업과 연결을 종료하고 저장 인증정보를 삭제할까요?',detail:target.kind==='trust' ? `${target.endpoint}\n${target.fingerprint}\n다음 연결에는 신규 지문 승인이 필요합니다.`:`${target.username}@${target.endpoint}\n로컬 암호문만 삭제하며 서버 계정을 삭제하지 않습니다.`,buttons:['유지','연결 해제 후 삭제'],defaultId:0,cancelId:0,noLink:true});if(owner!==win || owner.isDestroyed())throw new Error('REQUEST_CANCELLED');return answer.response===1;});},async ids=>{const targets=connections!.views().filter(row=>ids.includes(row.serverId) && !['idle','disconnected','failed'].includes(row.status));for(const row of targets)connections!.beginDisconnect(row.serverId,row.generation);const results=await Promise.all(targets.map(row=>shutdown({serverId:row.serverId,generation:row.generation})));if(results.some(row=>row.timedOut))throw new Error('IO_TIMEOUT');},id=>connections!.isBusy(id) || mutations.snapshots().some(row=>row.serverId===id && activeOperation(row.taskId)));
  for(const action of ['settings:get','settings:update','settings:removeTrust','settings:removeSecret'])ipcMain.handle(action,async(event,payload:unknown)=>{validateSender(event);try{if(payload!==undefined && Buffer.byteLength(JSON.stringify(payload))>65536)throw new Error('INPUT_INVALID');return await settings.handle(action,payload);}catch(error){throw new Error(error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message) ? error.message:'INPUT_INVALID');}});
  for (const action of ['profile:list', 'profile:create', 'profile:update', 'profile:delete', 'profile:pickKey']) {
    ipcMain.handle(action, async (event, payload: unknown) => {
      validateSender(event);
      try {
        if((powerTransition || settings.writing) && action!=='profile:list')throw new Error('REQUEST_BUSY');
        if (!profiles || action !== 'profile:list' && (!receipts || receipts.faulted || storageRecovering || recoveryLocked || lifecycleClosing)) throw new Error('STORAGE_FAILED');
        if (payload !== undefined && Buffer.byteLength(JSON.stringify(payload)) > 65536) throw new Error('INPUT_INVALID');
        return await profiles.handle(action, payload);
      }
      catch (error) { throw new Error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INPUT_INVALID'); }
    });
  }
  for (const action of ['session:list', 'session:selectActive', 'session:connect', 'session:disconnect', 'session:confirmOS', 'trust:approve', 'trust:reject']) {
    ipcMain.handle(action, async (event, payload: unknown) => {
      validateSender(event);
      try {
        if (!connections || !['session:list','session:selectActive'].includes(action) && engine !== 'ready') throw new Error('ENGINE_STOPPED');
        if (payload !== undefined && Buffer.byteLength(JSON.stringify(payload)) > 65536) throw new Error('INPUT_INVALID');
        if(action==='session:selectActive'){responseProbe!.select(z.uuid().nullable().parse(payload));return;}
        if((powerTransition || settings.writing) && ['session:connect','session:confirmOS','trust:approve'].includes(action))throw new Error('REQUEST_BUSY');
        if(action==='session:connect' && payload && typeof payload==='object' && 'id' in payload && typeof payload.id==='string' && disconnectPrompts.has(payload.id))throw new Error('SESSION_BUSY');
        if(action==='session:disconnect'){await confirmDisconnect(z.uuid().parse(payload));return;}
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
        if(action === 'desktop:closeWindow' && typeof payload === 'string' && desktop.findWindow(payload)?.kind === 'terminal' && terminals!.needsCloseConfirmation(payload))throw new Error('CLOSE_CONFIRM_REQUIRED');
        const result = desktop.handle(action, payload);
        if (action === 'desktop:closeWindow' && typeof payload === 'string') {executions?.detachWindow(payload);terminals?.detachWindow(payload);await viewers.closeWindow(payload);await files.closeWindow(payload).catch(() => {});}
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
  for(const action of ['terminal:open','terminal:pause','terminal:get','terminal:input','terminal:next','terminal:restore','terminal:restoreAck','terminal:resize','terminal:previewPaste','terminal:paste','terminal:releasePaste','terminal:requestPaste','terminal:previewClose','terminal:close']) {
    ipcMain.handle(action,async(event,payload:unknown)=>{validateSender(event,action === 'terminal:input' ? terminalInputBudget:action === 'terminal:next' ? viewerDataBudget:budget);try{if(payload !== undefined && Buffer.byteLength(JSON.stringify(payload))>65536)throw new Error('INPUT_INVALID');return await terminals!.handle(action,payload);}catch(error){throw new Error(error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message) ? error.message:'INPUT_INVALID');}});
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
    if (storageRecovering || lifecycleClosing || powerTransition) throw new Error('REQUEST_BUSY');
    const faulted=!repository || repository.store.faulted || !receipts || receipts.faulted || recoveryLocked;
    if (!faulted && (terminals!.hasActive || executions!.hasActive || mutations.hasRunning || transfers!.isRegistering || transfers!.overlays().some(row=>transfers!.isActive(row.taskId)))) throw new Error('REQUEST_BUSY');
    storageRecovering=true;let barrier:string|null=null;
    try {
      await transfers!.settled();await mutations.settled();barrier=await storageRecovery.barrier(faulted);recoveryLocked=true;
      await receiptChannel.settled();await receipts?.settled();await repository?.store.settled();await openRepository();const liveExecutions=new Set([...executions!.storageContinuity(),...terminals!.storageContinuity()]);receipts=await ReceiptRepository.open(dataRoot,{epoch,executionIds:liveExecutions});if([...liveExecutions].some(id=>!receipts!.get(id)))throw new Error('STORAGE_FAILED');
      await mutations.reconcileStorage(receipts);recoveryAccepting=true;await storageRecovery.reset(barrier,receipts.snapshots().filter(row=>liveExecutions.has(row.taskId) && (row.kind === 'gui_exec' || row.kind === 'pty') && row.recoveryUncertain).map(row=>({taskId:row.taskId,fromPhase:row.recoveredFromPhase})));recoveryLocked=false;
    } catch (error) {if (barrier || faulted || !(error instanceof Error) || error.message !== 'REQUEST_BUSY') recoveryLocked=true;throw new Error(error instanceof Error && error.message === 'REQUEST_BUSY' ? 'REQUEST_BUSY' : 'STORAGE_FAILED');}
    finally {recoveryAccepting=false;storageRecovering=false;}

  });
  ipcMain.handle('lifecycle:restartEngine',async(event,payload:unknown)=>{
    validateSender(event);if(payload !== undefined)throw new Error('INPUT_INVALID');if(engine !== 'stopped' || gateway.running || engineRestarting || storageRecovering || lifecycleClosing || powerTransition)throw new Error('REQUEST_BUSY');engineRestarting=true;
    try{await engineStopping;if(engine !== 'stopped')throw new Error('REQUEST_BUSY');engine='starting';epoch=randomUUID();worker=utilityProcess.fork(resolve(__dirname,'../worker/index.js'),[epoch],{stdio:'ignore',serviceName:'sshOS connection engine'});storageRecovery=new MainStorageRecovery(epoch,worker);receiptChannel=new MainReceiptChannel(epoch,()=>receipts,()=>Boolean(repository && !repository.store.faulted && (recoveryAccepting || !storageRecovering && !recoveryLocked)),message=>worker.postMessage(message));gateway.restart(worker,epoch,receiptChannel);await observeEngine(worker,epoch);}
    catch{worker.kill();engine='stopped';throw new Error('ENGINE_STOPPED');}finally{engineRestarting=false;}
  });
  ipcMain.handle('lifecycle:ackDisplayLimit',(event,payload:unknown)=>{validateSender(event);const token=z.uuid().parse(payload),owner=win;if(!owner || owner.isDestroyed() || !memoryGuard.acknowledge(`${owner.webContents.id}:${owner.webContents.getOSProcessId()}`,token))throw new Error('TOKEN_EXPIRED');});
  ipcMain.handle('lifecycle:getSnapshot', (event, payload: unknown) => {
    validateSender(event);
    if (payload !== undefined) throw new Error('INPUT_INVALID');
    return runtimeSnapshotSchema.parse({ backendEpoch: epoch, engine, connectedServers: connections.views().filter(row => row.status === 'connected').length,
      storage: { status: !repository || repository.store.faulted || !receipts || receipts.faulted || storageRecovering || recoveryLocked ? 'unavailable' : repository.recovered ? 'recovered' : 'ready', path: dataRoot },
      displayLimitToken:memoryGuard.displayToken,probe:responseProbe!.view(),powerSequence,closing:lifecycleClosing,appVersion: app.getVersion(), versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome } });
  });
  const createWindow = (): void => {
    uiReady=false;win = new BrowserWindow({ width: 1400, height: 900, minWidth: 1120, minHeight: 760, show: false, backgroundColor: '#123C47', webPreferences: { preload: resolve(__dirname, '../preload/index.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: !app.isPackaged } });
    pasteGesture.bind(win);win.on('focus',()=>responseProbe?.invalidate());win.on('blur',()=>responseProbe?.invalidate());win.on('minimize',()=>responseProbe?.invalidate());win.on('restore',()=>responseProbe?.invalidate());win.on('close',event=>{if(!quitFinal){event.preventDefault();void requestQuit();}});
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    let loaded=false;
    win.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame) => {if (loaded && isMainFrame) {uiReady=false;diagnostics.invalidate();responseProbe?.invalidate();profiles?.invalidate();executionPreviews.invalidate();viewers.interruptRenderer();transfers?.invalidateRenderer();executions?.invalidateRenderer();terminals?.invalidateRenderer();}});
    win.webContents.on('did-finish-load',() => {loaded=true;uiReady=true;responseProbe?.invalidate();});
    const owner=win;let recoveringRenderer=false;
    win.webContents.on('render-process-gone',(_event,details) => {if(owner!==win || replacingRenderer)return;uiReady=false;diagnostics.invalidate();responseProbe?.invalidate();profiles?.invalidate();executionPreviews.invalidate();viewers.interruptRenderer();transfers?.invalidateRenderer();executions?.invalidateRenderer();terminals?.invalidateRenderer();if(details.reason === 'clean-exit' || recoveringRenderer || owner.isDestroyed())return;recoveringRenderer=true;void dialog.showMessageBox(owner,{type:'warning',title:'sshOS 화면 복구',message:'화면 프로세스가 종료되었습니다.',detail:'연결 엔진과 작업은 계속 실행 중일 수 있습니다. 화면을 다시 열면 현재 상태를 복원하며 원격 작업을 다시 실행하지 않습니다.',buttons:['화면 다시 열기','나중에'],defaultId:0,cancelId:1,noLink:true}).then(async result=>{if(result.response===0 && !owner.isDestroyed()){replacingRenderer=true;try{owner.destroy();createWindow();}finally{replacingRenderer=false;}}}).catch(()=>{}).finally(()=>{recoveringRenderer=false;});});
    win.on('ready-to-show', () => {if(!owner.isDestroyed())owner.show();});
    win.on('closed', () => {if(win===owner){win=null;uiReady=false;}});
    void win.loadURL('app://ui/');
  };
  const memoryGuard=new RendererMemoryGuard(()=>{const owner=win;if(!owner || owner.isDestroyed() || !uiReady || lifecycleClosing)return null;const pid=owner.webContents.getOSProcessId();return {key:`${owner.webContents.id}:${pid}`,workingSetKiB:app.getAppMetrics().find(row=>row.pid===pid)?.memory.workingSetSize ?? null};},()=>terminals!.blockDisplays(),key=>{const owner=win;if(!owner || owner.isDestroyed() || `${owner.webContents.id}:${owner.webContents.getOSProcessId()}`!==key || lifecycleClosing)return;uiReady=false;diagnostics.invalidate();responseProbe?.invalidate();profiles?.invalidate();executionPreviews.invalidate();viewers.interruptRenderer();transfers?.invalidateRenderer();executions?.invalidateRenderer();terminals?.invalidateRenderer();replacingRenderer=true;try{owner.webContents.forcefullyCrashRenderer();owner.destroy();createWindow();}finally{replacingRenderer=false;}});
  app.on('second-instance', () => { if (win?.isMinimized()) win.restore(); win?.focus(); });
  app.on('activate', () => { if (!win) createWindow(); });
  app.on('window-all-closed', () => {if(!replacingRenderer)app.quit();});
  app.on('before-quit',event=>{if(quitFinal){memoryGuard.dispose();responseProbe?.dispose();worker.kill();return;}event.preventDefault();void requestQuit();});
  createWindow();
}

void main().catch(() => { console.error('STARTUP_FAILED'); app.exit(1); });
