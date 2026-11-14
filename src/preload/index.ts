import { contextBridge, ipcRenderer } from 'electron';
// Keep this entry self-contained: sandboxed preload cannot require local modules.
contextBridge.exposeInMainWorld('sshOS', Object.freeze({
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
