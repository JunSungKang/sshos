import { contextBridge, ipcRenderer } from 'electron';
// Keep this entry self-contained: sandboxed preload cannot require local modules.
contextBridge.exposeInMainWorld('sshOS', Object.freeze({
  transfer:Object.freeze({
    pickUploadFiles:() => ipcRenderer.invoke('transfer:pickUploadFiles'),
    pickDownloadDirectory:() => ipcRenderer.invoke('transfer:pickDownloadDirectory'),
    previewUpload:(input:unknown) => ipcRenderer.invoke('transfer:previewUpload',input),
    previewDownload:(input:unknown) => ipcRenderer.invoke('transfer:previewDownload',input),
    getPreview:(id:string,offset:number) => ipcRenderer.invoke('transfer:getPreview',{id,offset}),
    updatePreview:(id:string,index:number,change:unknown) => ipcRenderer.invoke('transfer:updatePreview',{id,index,change}),
    releasePreview:(id:string) => ipcRenderer.invoke('transfer:releasePreview',id),
    start:(token:string) => ipcRenderer.invoke('transfer:start',token),
    cancel:(id:string) => ipcRenderer.invoke('transfer:cancel',id),
    shelf:() => ipcRenderer.invoke('transfer:shelf')
  }),
  viewer:Object.freeze({
    probe:(token:string) => ipcRenderer.invoke('viewer:probe',token),
    next:(token:string,readGeneration:number,sequence:number) => ipcRenderer.invoke('viewer:next',{token,readGeneration,sequence}),
    releaseProbe:(token:string) => ipcRenderer.invoke('viewer:releaseProbe',token),
    open:(entryToken:string,kind:string) => ipcRenderer.invoke('viewer:open',{entryToken,kind}),
    get:(id:string) => ipcRenderer.invoke('viewer:get',id),
    reread:(token:string) => ipcRenderer.invoke('viewer:reread',token),
    stopRead:(token:string,readGeneration:number) => ipcRenderer.invoke('viewer:stopRead',{token,readGeneration})
  }),
  file: Object.freeze({
    open: (id: string) => ipcRenderer.invoke('file:open', id),
    list: (token: string) => ipcRenderer.invoke('file:list', token),
    enter: (token: string) => ipcRenderer.invoke('file:enter', token),
    page: (token: string, offset: number) => ipcRenderer.invoke('file:page', { token, offset }),
    previewMutation: (input:unknown) => ipcRenderer.invoke('file:previewMutation',input),
    startMutation: (token:string) => ipcRenderer.invoke('file:startMutation',token)
  }),
  task:Object.freeze({
    list:(offset:number) => ipcRenderer.invoke('task:list',offset),
    inspect:(id:string) => ipcRenderer.invoke('task:inspect',id),
    previewRecordAction:(id:string,action:string) => ipcRenderer.invoke('task:previewRecordAction',{id,action}),
    applyRecordAction:(token:string) => ipcRenderer.invoke('task:applyRecordAction',token)
  }),
  lifecycle: Object.freeze({ getSnapshot: () => ipcRenderer.invoke('lifecycle:getSnapshot') }),
  settings: Object.freeze({ retryStorage: () => ipcRenderer.invoke('settings:retryStorage') }),
  desktop: Object.freeze({
    getWindowSnapshot: () => ipcRenderer.invoke('desktop:getWindowSnapshot'),
    registerWindow: (kind: string, resourceToken?: string) => ipcRenderer.invoke('desktop:registerWindow', resourceToken === undefined ? { kind } : { kind, resourceToken }),
    updateWindowLayout: (window: unknown) => ipcRenderer.invoke('desktop:updateWindowLayout', window),
    closeWindow: (id: string) => ipcRenderer.invoke('desktop:closeWindow', id)
  }),
  session: Object.freeze({
    list: () => ipcRenderer.invoke('session:list'),
    connect: (id: string, credentials: unknown) => ipcRenderer.invoke('session:connect', { id, credentials }),
    disconnect: (id: string) => ipcRenderer.invoke('session:disconnect', id),
    confirmOS: (id: string, generation: number) => ipcRenderer.invoke('session:confirmOS', { id, generation })
  }),
  trust: Object.freeze({
    approve: (id: string) => ipcRenderer.invoke('trust:approve', id),
    reject: (id: string) => ipcRenderer.invoke('trust:reject', id)
  }),
  profile: Object.freeze({
    list: () => ipcRenderer.invoke('profile:list'),
    create: (input: unknown) => ipcRenderer.invoke('profile:create', input),
    update: (id: string, input: unknown) => ipcRenderer.invoke('profile:update', { id, input }),
    delete: (id: string) => ipcRenderer.invoke('profile:delete', id),
    pickKey: () => ipcRenderer.invoke('profile:pickKey')
  })
}));
