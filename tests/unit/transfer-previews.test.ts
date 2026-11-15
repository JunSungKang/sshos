import { afterEach,describe,expect,it,vi } from 'vitest';
import { mkdir,mkdtemp,rm,writeFile,readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { NativeDialogGate } from '../../src/main/native-dialogs';
import { TransferSelections } from '../../src/main/transfer-selections';
import { TransferPreviews } from '../../src/main/transfer-previews';
import { localDownloadName } from '../../src/worker/transfers/local';
import type { ConnectionController } from '../../src/main/connections';
import type { FileController } from '../../src/main/files';
import type { EngineGateway } from '../../src/main/engine-gateway';
import type { TransferPreviewPage } from '../../src/shared/transfer-preview';
vi.mock('electron',() => ({dialog:{showOpenDialog:() => {throw new Error('Unexpected native dialog');}}}));
const owned:string[]=[];afterEach(async () => {vi.restoreAllMocks();for (const root of owned.splice(0)) await rm(root,{recursive:true});});
const win={isDestroyed:() => false,webContents:{id:1}} as BrowserWindow;
async function fixture(options:{duplicate?:boolean;existingRemote?:boolean;remoteNames?:string[];longParent?:boolean;windowsNames?:boolean}={}) {
  await mkdir(resolve('.local/tmp'),{recursive:true});const root=await mkdtemp(resolve('.local/tmp/previews-'));owned.push(root);await Promise.all([mkdir(join(root,'one')),mkdir(join(root,'two')),mkdir(join(root,'downloads'))]);
  const native=[join(root,'one/a.txt'),join(root,'two',options.duplicate ? 'a.txt' : 'b.txt')];for (const path of native) await writeFile(path,'abc');let chosen=native;
  const selections=new TransferSelections(new NativeDialogGate(),() => win,async () => ({canceled:false,filePaths:chosen}));const upload=(await selections.pickUploadFiles())!;chosen=[join(root,'downloads')];const folder=(await selections.pickDownloadDirectory())!;
  const serverId=crypto.randomUUID(),sessionToken=crypto.randomUUID(),directoryToken=crypto.randomUUID(),windowId=crypto.randomUUID();let connected=true,healthy=true;const parent=options.longParent ? '/'+Array.from({length:15},()=> 'p'.repeat(240)).join('/') : '/home';const browser={serverId,generation:1,sessionToken,windowId};
  const entries=new Map((options.remoteNames ?? ['remote.txt']).map(name => [crypto.randomUUID(),{browser,path:parent,rawName:name,type:'file' as const,listedAt:new Date().toISOString()}]));
  const files={resolveDirectory:(token:string) => {if (token !== directoryToken) throw new Error('TOKEN_EXPIRED');return {browser,path:parent};},resolveEntry:(token:string) => {const value=entries.get(token);if (!value) throw new Error('TOKEN_EXPIRED');return value;}} as unknown as FileController;
  const identity={generation:1,endpointSnapshot:{name:'fixture',host:'example.invalid',port:22,username:'fixture',endpoint:'example.invalid:22'},hostKeyFingerprint:'SHA256:fixture'};
  const connections={sessionCapability:(token:string) => {if (!connected || token !== sessionToken) throw new Error('SESSION_UNAVAILABLE');return {serverId,generation:1};},views:() => [{serverId,generation:1,status:'connected',sftp:'available',os:'supported',osConfirmed:false}],sessionIdentity:() => structuredClone(identity)} as unknown as ConnectionController;
  const requests:{action:string;direction:string;path:string}[]=[];const gateway={epoch:crypto.randomUUID(),request:async (request:{action:string;direction:string;path:string}) => {requests.push(request);if (request.action !== 'transfer:inspect') throw new Error('Unexpected mutation');if (request.direction === 'upload') {if (options.existingRemote && request.path.endsWith('/a.txt')) throw new Error('NAME_CONFLICT');return null;}return {size:3,mtime:'1',identity:''};}} as unknown as EngineGateway;
  const previews=new TransferPreviews(files,connections,gateway,selections,() => {if (!healthy) throw new Error('STORAGE_FAILED');},name => localDownloadName(name,options.windowsNames ? 'win32' : process.platform));
  const ready=async (id:string):Promise<TransferPreviewPage> => {await vi.waitFor(() => expect(previews.get(id,0).status).not.toBe('checking'),{timeout:2000,interval:5});return previews.get(id,0);};
  return {previews,root,native,upload,folder,directoryToken,entryTokens:[...entries.keys()],requests,gateway,ready,disconnect:() => {connected=false;},unhealthy:() => {healthy=false;}};
}
describe('transfer preview and immutable confirmation scope',() => {
  it('performs only readonly inspection, hides native paths and consumes exact source/destination once',async () => {
    const f=await fixture();const {previewId}=f.previews.upload({fileTokens:[f.upload[0]!.token],directoryToken:f.directoryToken});expect(f.previews.get(previewId,0).confirmationToken).toBeNull();const page=await f.ready(previewId);expect(page.selectedCount).toBe(1);expect(JSON.stringify(page)).not.toContain(f.root);expect(f.requests.every(row => row.action === 'transfer:inspect')).toBe(true);
    const confirmation=f.previews.consume(page.confirmationToken!);expect(confirmation.specs[0]?.row.source).toBe(f.native[0]);expect(confirmation.specs[0]?.row.destination).toBe('/home/a.txt');expect(confirmation.specs[0]?.row.phase).toBe('queued');expect(() => f.previews.consume(page.confirmationToken!)).toThrow('TOKEN_EXPIRED');
  });
  it('rotates confirmation after explicit rename/selection and preserves conflict rows',async () => {
    const f=await fixture({existingRemote:true});const {previewId}=f.previews.upload({fileTokens:f.upload.map(row=>row.token),directoryToken:f.directoryToken});let page=await f.ready(previewId);expect(page.rows.map(row=>row.status)).toEqual(['conflict','valid']);expect(page.selectedCount).toBe(1);const old=page.confirmationToken!;
    await f.previews.update(previewId,0,{name:'new.txt'});page=f.previews.get(previewId,0);expect(page.selectedCount).toBe(2);expect(page.confirmationToken).not.toBe(old);expect(() => f.previews.consume(old)).toThrow('TOKEN_EXPIRED');await f.previews.update(previewId,1,{selected:false});const current=f.previews.get(previewId,0);expect(f.previews.consume(current.confirmationToken!).specs.map(spec=>spec.row.destination)).toEqual(['/home/new.txt']);
  });
  it('resolves duplicate targets by explicitly skipping one source',async () => {
    const f=await fixture({duplicate:true});const {previewId}=f.previews.upload({fileTokens:f.upload.map(row=>row.token),directoryToken:f.directoryToken});const page=await f.ready(previewId);expect(page.rows.every(row=>row.status==='conflict')).toBe(true);expect(page.confirmationToken).toBeNull();await f.previews.update(previewId,1,{selected:false});const updated=f.previews.get(previewId,0);expect(updated.selectedCount).toBe(1);expect(f.previews.consume(updated.confirmationToken!).specs[0]?.row.source).toBe(f.native[0]);
  });
  it('allows a valid replacement for a Windows-incompatible source filename without changing the remote source',async () => {
    const f=await fixture({windowsNames:true,remoteNames:['bad:name.txt']});const {previewId}=f.previews.download({entryTokens:f.entryTokens,directoryToken:f.folder.token});let page=await f.ready(previewId);expect(page.rows[0]?.status).toBe('unsupported');await f.previews.update(previewId,0,{name:'valid.txt'});page=f.previews.get(previewId,0);expect(page.rows[0]?.status).toBe('valid');const spec=f.previews.consume(page.confirmationToken!).specs[0]!;expect(spec.row.source).toBe('/home/bad:name.txt');expect(spec.row.destination).toBe(join(f.root,'downloads/valid.txt'));
  });
  it('keeps an existing local destination intact and supports explicit alternate names',async () => {
    const f=await fixture();const target=join(f.root,'downloads/remote.txt');await writeFile(target,'preserved');const {previewId}=f.previews.download({entryTokens:f.entryTokens,directoryToken:f.folder.token});let page=await f.ready(previewId);expect(page.rows[0]?.status).toBe('conflict');await f.previews.update(previewId,0,{name:'alternate.txt'});page=f.previews.get(previewId,0);expect(page.rows[0]?.status).toBe('valid');expect(await readFile(target,'utf8')).toBe('preserved');expect(JSON.stringify(page)).not.toContain(f.root);
  });
  it('rejects expired, disconnected, wrong-role and invalidated authorities before enqueue',async () => {
    const clock=vi.spyOn(performance,'now').mockReturnValue(0);const f=await fixture();expect(() => f.previews.upload({fileTokens:[f.folder.token],directoryToken:f.directoryToken})).toThrow('TOKEN_EXPIRED');const {previewId}=f.previews.upload({fileTokens:[f.upload[0]!.token],directoryToken:f.directoryToken});const page=await f.ready(previewId);clock.mockReturnValue(60000);expect(() => f.previews.consume(page.confirmationToken!)).toThrow('TOKEN_EXPIRED');
    const g=await fixture();const next=g.previews.upload({fileTokens:[g.upload[0]!.token],directoryToken:g.directoryToken});const ready=await g.ready(next.previewId);g.disconnect();expect(() => g.previews.consume(ready.confirmationToken!)).toThrow('SESSION_UNAVAILABLE');g.previews.invalidate();expect(() => g.previews.get(next.previewId,0)).toThrow('TOKEN_EXPIRED');
  });
  it('pages100 maximum-path candidates below the response byte budget',async () => {
    const f=await fixture({remoteNames:Array.from({length:100},(_,index)=>`file-${index}.txt`),longParent:true});const {previewId}=f.previews.download({entryTokens:f.entryTokens,directoryToken:f.folder.token});await f.ready(previewId);let offset:number|null=0,count=0;
    while (offset !== null) {const page=f.previews.get(previewId,offset);expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(65536);count+=page.rows.length;offset=page.nextOffset;}expect(count).toBe(100);
  });
});
