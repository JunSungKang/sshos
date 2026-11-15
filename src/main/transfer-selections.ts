import { dialog,type BrowserWindow,type OpenDialogOptions,type OpenDialogReturnValue } from 'electron';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { displayName } from '../shared/files';
import type { UploadChoice,DownloadDirectoryChoice } from '../shared/transfer-selections';
import { inspectLocalFile,inspectLocalDirectory,localDownloadName,type LocalDirectory } from '../worker/transfers/local';
import { NativeDialogGate } from './native-dialogs';
type Source=Awaited<ReturnType<typeof inspectLocalFile>>;
type Picker=(window:BrowserWindow,options:OpenDialogOptions)=>Promise<OpenDialogReturnValue>;
type FileSelection={view:UploadChoice;source:Source|null;deadline:number};
type DirectorySelection={view:DownloadDirectoryChoice;directory:LocalDirectory;deadline:number};
export class TransferSelections {
  private readonly files=new Map<string,FileSelection>();
  private readonly directories=new Map<string,DirectorySelection>();
  private generation=0;
  constructor(private readonly gate:NativeDialogGate,private readonly window:()=>BrowserWindow|null,private readonly picker:Picker=(win,options) => dialog.showOpenDialog(win,options)) {}
  invalidate():void {this.generation++;this.files.clear();this.directories.clear();}
  private prune():void {const now=performance.now();for (const map of [this.files,this.directories]) for (const [token,value] of map) if (value.deadline<=now) map.delete(token);}
  private current(win:BrowserWindow,generation:number):void {if (win.isDestroyed() || this.window() !== win || this.generation !== generation) throw new Error('REQUEST_CANCELLED');}
  private win():BrowserWindow {const win=this.window();if (!win || win.isDestroyed()) throw new Error('IPC_DENIED');this.prune();if (this.files.size+this.directories.size>=1000) throw new Error('REQUEST_BUSY');return win;}
  async pickUploadFiles():Promise<UploadChoice[]|null> {
    const win=this.win(),generation=this.generation;
    return this.gate.run(win.webContents.id,async () => {
      const result=await this.picker(win,{title:'업로드할 일반 파일 선택',message:'로컬 일반 파일만 지원합니다. 링크·네트워크 공유·특수 파일은 지원하지 않습니다.',properties:['openFile','multiSelections']});this.current(win,generation);
      if (result.canceled || result.filePaths.length === 0) return null;
      if (result.filePaths.length>100) throw new Error('TASK_LIMIT');if (this.files.size+this.directories.size+result.filePaths.length>1000) throw new Error('REQUEST_BUSY');
      const prepared:{token:string;value:FileSelection}[]=[];const seen=new Set<string>();
      for (const path of result.filePaths) {
        this.current(win,generation);const name=displayName(basename(path));let source:Source|null=null,errorCode:string|null=null;
        try {if (!localDownloadName(basename(path)) || seen.has(path)) throw new Error('PATH_UNSUPPORTED');source=await inspectLocalFile(path);} catch (error) {errorCode=error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message) ? error.message : 'PATH_UNSUPPORTED';}
        seen.add(path);const token=randomUUID();prepared.push({token,value:{view:{token,name,size:source?.stat.size ?? null,status:source ? 'valid' : 'unsupported',errorCode},source,deadline:performance.now()+120000}});
      }
      this.current(win,generation);for (const row of prepared) this.files.set(row.token,row.value);return prepared.map(row => ({...row.value.view}));
    });
  }
  async pickDownloadDirectory():Promise<DownloadDirectoryChoice|null> {
    const win=this.win(),generation=this.generation;
    return this.gate.run(win.webContents.id,async () => {
      const result=await this.picker(win,{title:'다운로드할 로컬 폴더 선택',message:'로컬 일반 폴더만 지원합니다. 링크·네트워크 공유·cloud placeholder는 지원하지 않습니다.',properties:['openDirectory']});this.current(win,generation);
      const path=result.filePaths[0];if (result.canceled || !path) return null;
      if (result.filePaths.length !== 1) throw new Error('INPUT_INVALID');
      const directory=await inspectLocalDirectory(path);this.current(win,generation);const token=randomUUID(),view={token,name:displayName(basename(directory.path) || directory.path)};this.directories.set(token,{view,directory,deadline:performance.now()+120000});return {...view};
    });
  }
  file(token:string):FileSelection {this.prune();const value=this.files.get(token);if (!value) throw new Error('TOKEN_EXPIRED');return structuredClone(value);}
  directory(token:string):DirectorySelection {this.prune();const value=this.directories.get(token);if (!value) throw new Error('TOKEN_EXPIRED');return structuredClone(value);}
  release(tokens:string[]):void {for (const token of tokens) {this.files.delete(token);this.directories.delete(token);}}
}
