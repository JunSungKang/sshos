import { contextBridge, ipcRenderer } from 'electron';
// Keep this entry self-contained: sandboxed preload cannot require local modules.
contextBridge.exposeInMainWorld('sshOS', Object.freeze({
  lifecycle: Object.freeze({ getSnapshot: () => ipcRenderer.invoke('lifecycle:getSnapshot') })
}));
