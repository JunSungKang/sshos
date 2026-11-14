import { contextBridge, ipcRenderer } from 'electron';
// Keep this entry self-contained: sandboxed preload cannot require local modules.
contextBridge.exposeInMainWorld('sshOS', Object.freeze({
  lifecycle: Object.freeze({ getSnapshot: () => ipcRenderer.invoke('lifecycle:getSnapshot') }),
  settings: Object.freeze({ retryStorage: () => ipcRenderer.invoke('settings:retryStorage') }),
  profile: Object.freeze({
    list: () => ipcRenderer.invoke('profile:list'),
    create: (input: unknown) => ipcRenderer.invoke('profile:create', input),
    update: (id: string, input: unknown) => ipcRenderer.invoke('profile:update', { id, input }),
    delete: (id: string) => ipcRenderer.invoke('profile:delete', id),
    pickKey: () => ipcRenderer.invoke('profile:pickKey')
  })
}));
