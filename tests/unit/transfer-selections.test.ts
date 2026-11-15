import { afterEach,describe,expect,it,vi } from 'vitest';
import { mkdir,mkdtemp,rm,writeFile,symlink } from 'node:fs/promises';
import { resolve,join,basename } from 'node:path';
import type { BrowserWindow } from 'electron';
import { NativeDialogGate } from '../../src/main/native-dialogs';
import { TransferSelections } from '../../src/main/transfer-selections';
import { ProfileController } from '../../src/main/profiles';
import type { StateRepository } from '../../src/main/persistence/state-repository';
import { dialog } from 'electron';
vi.mock('electron',() => ({dialog:{showOpenDialog:vi.fn(() => {throw new Error('Unexpected native dialog in unit test');})}}));
const owned:string[]=[];
afterEach(async () => {vi.restoreAllMocks();for (const path of owned.splice(0)) await rm(path,{recursive:true});});
const window={isDestroyed:() => false,webContents:{id:1}} as BrowserWindow;
async function directory() {await mkdir(resolve('.local/tmp'),{recursive:true});const path=await mkdtemp(resolve('.local/tmp/selections-'));owned.push(path);return path;}
describe('main-owned native transfer selections',() => {
  it('retains every mixed selection and returns display metadata without filesystem paths',async () => {
    const root=await directory(),file=join(root,'한글 source.txt'),alias=join(root,'alias');await writeFile(file,'abc');await symlink(file,alias);
    const selections=new TransferSelections(new NativeDialogGate(),() => window,async () => ({canceled:false,filePaths:[file,alias,root]}));const result=(await selections.pickUploadFiles())!;
    expect(result).toHaveLength(3);expect(result.map(row => row.status)).toEqual(['valid','unsupported','unsupported']);expect(result[0]?.size).toBe(3);expect(JSON.stringify(result)).not.toContain(root);
    const grant=selections.file(result[0]!.token);expect(grant.source?.path).toBe(file);grant.source!.stat.size=0;expect(selections.file(result[0]!.token).source?.stat.size).toBe(3);expect(selections.file(result[1]!.token).source).toBeNull();
  });
  it('binds a canonical directory and expires both selection roles after120s',async () => {
    const clock=vi.spyOn(performance,'now').mockReturnValue(0);const root=await directory();const selections=new TransferSelections(new NativeDialogGate(),() => window,async () => ({canceled:false,filePaths:[root]}));const selected=(await selections.pickDownloadDirectory())!;
    expect(selected.name).toBe(basename(root));expect(Object.keys(selected).sort()).toEqual(['name','token']);expect(selections.directory(selected.token).directory.path).toBe(root);clock.mockReturnValue(120000);expect(() => selections.directory(selected.token)).toThrow('TOKEN_EXPIRED');
  });
  it('rejects a whole101-file selection and never quietly truncates it',async () => {
    const root=await directory(),file=join(root,'source');await writeFile(file,'abc');const selections=new TransferSelections(new NativeDialogGate(),() => window,async () => ({canceled:false,filePaths:Array.from({length:101},()=>file)}));await expect(selections.pickUploadFiles()).rejects.toThrow('TASK_LIMIT');
  });
  it('uses one dialog per frame and refuses results from an invalidated renderer',async () => {
    const root=await directory();let complete!:(result:{canceled:boolean;filePaths:string[]})=>void;const pending=new Promise<{canceled:boolean;filePaths:string[]}>(resolve => {complete=resolve;});const gate=new NativeDialogGate();const selections=new TransferSelections(gate,() => window,() => pending);const pick=selections.pickDownloadDirectory();const rejected=expect(pick).rejects.toThrow('REQUEST_CANCELLED');
    await expect(gate.run(1,async () => 'key-file-dialog')).rejects.toThrow('REQUEST_BUSY');selections.invalidate();complete({canceled:false,filePaths:[root]});await rejected;expect(await gate.run(1,async () => 'ready')).toBe('ready');
  });
  it('releases cancelled selections and always releases the dialog gate after an error',async () => {
    const root=await directory(),file=join(root,'source');await writeFile(file,'abc');const gate=new NativeDialogGate();const selections=new TransferSelections(gate,() => window,async () => ({canceled:false,filePaths:[file]}));const selected=(await selections.pickUploadFiles())![0]!;selections.release([selected.token]);expect(() => selections.file(selected.token)).toThrow('TOKEN_EXPIRED');
    const cancelled=new TransferSelections(gate,() => window,async () => ({canceled:true,filePaths:[]}));expect(await cancelled.pickUploadFiles()).toBeNull();await expect(gate.run(1,async () => {throw new Error('fixture-error');})).rejects.toThrow('fixture-error');expect(await gate.run(1,async () => true)).toBe(true);
  });
  it('reclaims expired key-picker capabilities instead of permanently consuming the20-item limit',async () => {
    const clock=vi.spyOn(performance,'now').mockReturnValue(0);const root=await directory();vi.mocked(dialog.showOpenDialog).mockResolvedValue({canceled:false,filePaths:[join(root,'id_ed25519')]});
    const profiles=new ProfileController({} as StateRepository,() => window,() => false,new NativeDialogGate());for (let index=0;index<20;index++) expect(await profiles.handle('profile:pickKey',undefined)).toHaveProperty('token');
    clock.mockReturnValue(120000);expect(await profiles.handle('profile:pickKey',undefined)).toHaveProperty('token');
  });
});
