import { z } from 'zod';
import type { TransferPreviewPage } from './transfer-preview';
import type { UploadChoice,DownloadDirectoryChoice } from './transfer-selections';
import type { TransferShelf } from './transfer-ui';
import type { ProfileDraft, ProfileView } from './models';
import type { SessionCredentials, SessionView, HostChallenge } from './session-contracts';
import type { WindowKind, WindowModel } from './windows';
import type { DirectoryPage } from './files';
import type { MutationPreview, TaskPage, RecordActionPreview } from './mutations';
import type { FileReceipt } from './receipts';
import type { ViewerFrame, ViewerDescriptor } from './viewers/reader';

export const runtimeSnapshotSchema = z.object({
  backendEpoch: z.uuid(),
  engine: z.enum(['starting', 'ready', 'stopped']),
  connectedServers: z.int().min(0).max(3),
  storage: z.object({ status: z.enum(['ready', 'recovered', 'unavailable']), path: z.string().max(4096) }).strict(),
  appVersion: z.string().max(32),
  versions: z.object({ electron: z.string(), node: z.string(), chrome: z.string() }).strict()
}).strict();
export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>;

export const workerEventSchema = z.object({
  type: z.literal('ready'), backendEpoch: z.uuid(), sshLibrary: z.literal('ssh2')
}).strict();

export interface DesktopBridge {
  transfer:{pickUploadFiles():Promise<UploadChoice[]|null>;pickDownloadDirectory():Promise<DownloadDirectoryChoice|null>;previewUpload(input:{fileTokens:string[];directoryToken:string}):Promise<{previewId:string}>;previewDownload(input:{entryTokens:string[];directoryToken:string}):Promise<{previewId:string}>;getPreview(id:string,offset:number):Promise<TransferPreviewPage>;updatePreview(id:string,index:number,change:{name?:string;selected?:boolean}):Promise<void>;releasePreview(id:string):Promise<void>;start(confirmationToken:string):Promise<string[]>;cancel(taskId:string):Promise<unknown>;shelf():Promise<TransferShelf>};
  viewer:{probe(entryToken:string):Promise<{probeToken:string;viewerId:string;readGeneration:number}>;next(token:string,readGeneration:number,sequence:number):Promise<ViewerFrame>;releaseProbe(token:string):Promise<void>;open(entryToken:string,kind:'text'|'image'):Promise<WindowModel>;get(windowId:string):Promise<ViewerDescriptor>;reread(viewerToken:string):Promise<ViewerDescriptor>;stopRead(token:string,readGeneration:number):Promise<void>};
  file: { open(windowId: string): Promise<DirectoryPage>; list(directoryToken: string): Promise<DirectoryPage>; enter(entryToken: string): Promise<DirectoryPage>; page(pageToken: string, offset: number): Promise<DirectoryPage>; previewMutation(input:{operation:'mkdir'|'delete'|'rename';targetToken:string;name?:string}):Promise<MutationPreview>; startMutation(confirmationToken:string):Promise<string> };
  task: {list(offset:number):Promise<TaskPage>;inspect(id:string):Promise<FileReceipt & {recordError?:boolean}>;previewRecordAction(id:string,action:'acknowledge'|'forget'):Promise<RecordActionPreview>;applyRecordAction(confirmationToken:string):Promise<void>};
  lifecycle: { getSnapshot(): Promise<RuntimeSnapshot> };
  profile: {
    list(): Promise<ProfileView[]>;
    create(input: ProfileDraft): Promise<ProfileView>;
    update(id: string, input: ProfileDraft): Promise<ProfileView>;
    delete(id: string): Promise<void>;
    pickKey(): Promise<{ token: string; filename: string } | null>;
  };
  settings: { retryStorage(): Promise<void> };
  session: {
    list(): Promise<{ sessions: SessionView[]; challenges: HostChallenge[] }>;
    connect(id: string, credentials: SessionCredentials): Promise<void>;
    disconnect(id: string): Promise<void>;
    confirmOS(id: string, generation: number): Promise<void>;
  };
  trust: { approve(challengeId: string): Promise<void>; reject(challengeId: string): Promise<void> };
  desktop: {
    getWindowSnapshot(): Promise<WindowModel[]>;
    registerWindow(kind: WindowKind, resourceToken?: string): Promise<WindowModel>;
    updateWindowLayout(window: Pick<WindowModel, 'windowId' | 'bounds' | 'restoreBounds' | 'mode' | 'restoreMode' | 'focused' | 'lastFocusedSequence'>): Promise<void>;
    closeWindow(id: string): Promise<void>;
  };
}
