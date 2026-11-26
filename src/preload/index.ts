import type { DesktopBridge } from "../shared/contracts";
import { contextBridge, ipcRenderer } from "electron";
// Keep this entry self-contained: sandboxed preload cannot require local modules.
contextBridge.exposeInMainWorld(
  "sshOS",
  Object.freeze({
    web: Object.freeze({
      open: (token: string) => ipcRenderer.invoke("web:open", token),
      get: (id: string) => ipcRenderer.invoke("web:get", id),
      configure: (value: unknown) => ipcRenderer.invoke("web:configure", value),
      present: (value: unknown) => ipcRenderer.invoke("web:present", value),
      reload: (id: string) => ipcRenderer.invoke("web:reload", id),
    }),
    settings: Object.freeze({
      onChanged: (listener: (value: unknown) => void) => {
        const handle = (_event: unknown, value: unknown) => listener(value);
        ipcRenderer.on("settings:changed", handle);
        return () => ipcRenderer.removeListener("settings:changed", handle);
      },
      setHidden: (value: boolean) =>
        ipcRenderer.invoke("settings:setHidden", value),
      setTheme: (value: string) =>
        ipcRenderer.invoke("settings:setTheme", value),
      showLicenses: () => ipcRenderer.invoke("settings:showLicenses"),
      licensePage: (id: string, offset: number) =>
        ipcRenderer.invoke("settings:licensePage", { id, offset }),
      previewDiagnostics: () =>
        ipcRenderer.invoke("settings:previewDiagnostics"),
      exportRedactedDiagnostics: (token: string) =>
        ipcRenderer.invoke("settings:exportRedactedDiagnostics", token),
      releaseDiagnostics: (token: string) =>
        ipcRenderer.invoke("settings:releaseDiagnostics", token),
      retryStorage: () => ipcRenderer.invoke("settings:retryStorage"),
      get: () => ipcRenderer.invoke("settings:get"),
      update: (value: { language: "ko"; saveSecrets: boolean }) =>
        ipcRenderer.invoke("settings:update", value),
      removeTrust: (endpoint: string) =>
        ipcRenderer.invoke("settings:removeTrust", endpoint),
      removeSecret: (id: string) =>
        ipcRenderer.invoke("settings:removeSecret", id),
    }),
    terminal: Object.freeze({
      open: (token: string) => ipcRenderer.invoke("terminal:open", token),
      pause: (token: string) => ipcRenderer.invoke("terminal:pause", token),
      get: (id: string) => ipcRenderer.invoke("terminal:get", id),
      input: (terminalToken: string, sequence: number, bytes: Uint8Array) =>
        ipcRenderer.invoke("terminal:input", {
          terminalToken,
          sequence,
          bytes,
        }),
      next: (token: string, readGeneration: number, cursor: number) =>
        ipcRenderer.invoke("terminal:next", { token, readGeneration, cursor }),
      restore: (terminalToken: string, clear: boolean) =>
        ipcRenderer.invoke("terminal:restore", { terminalToken, clear }),
      restoreAck: (
        terminalToken: string,
        restoreToken: string,
        offset: number,
      ) =>
        ipcRenderer.invoke("terminal:restoreAck", {
          terminalToken,
          restoreToken,
          offset,
        }),
      resize: (terminalToken: string, cols: number, rows: number) =>
        ipcRenderer.invoke("terminal:resize", {
          terminalToken,
          size: { cols, rows },
        }),
      previewPaste: (
        terminalToken: string,
        text: string,
        file?: { bracketed: boolean },
      ) =>
        ipcRenderer.invoke("terminal:previewPaste", {
          terminalToken,
          text,
          file,
        }),
      paste: (confirmationToken: string, bracketed: boolean) =>
        ipcRenderer.invoke("terminal:paste", { confirmationToken, bracketed }),
      releasePaste: (token: string) =>
        ipcRenderer.invoke("terminal:releasePaste", token),
      requestPaste: (token: string) =>
        ipcRenderer.invoke("terminal:requestPaste", token),
      previewClose: (id: string) =>
        ipcRenderer.invoke("terminal:previewClose", id),
      close: (token: string) => ipcRenderer.invoke("terminal:close", token),
    }),
    execution: Object.freeze({
      context: (token: string) =>
        ipcRenderer.invoke("execution:context", token),
      preview: (input: unknown) =>
        ipcRenderer.invoke("execution:preview", input),
      releasePreview: (token: string) =>
        ipcRenderer.invoke("execution:releasePreview", token),
      start: (token: string) => ipcRenderer.invoke("execution:start", token),
      get: (id: string) => ipcRenderer.invoke("execution:get", id),
      reopen: (id: string) => ipcRenderer.invoke("execution:reopen", id),
      next: (token: string, readGeneration: number, cursor: number) =>
        ipcRenderer.invoke("execution:next", { token, readGeneration, cursor }),
      previewAction: (id: string, action: string) =>
        ipcRenderer.invoke("execution:previewAction", { id, action }),
      applyAction: (token: string, choice?: string) =>
        ipcRenderer.invoke(
          "execution:applyAction",
          choice === undefined ? { token } : { token, choice },
        ),
    }),
    relay: Object.freeze({
      folders: (sessionToken: string, path: string, offset = 0) =>
        ipcRenderer.invoke("relay:folders", { sessionToken, path, offset }),
      preview: (input: Parameters<DesktopBridge["relay"]["preview"]>[0]) =>
        ipcRenderer.invoke("relay:preview", input),
      retryPreview: (
        input: Parameters<DesktopBridge["relay"]["retryPreview"]>[0],
      ) => ipcRenderer.invoke("relay:retryPreview", input),
      releasePreview: (token: string) =>
        ipcRenderer.invoke("relay:releasePreview", token),
      start: (token: string) => ipcRenderer.invoke("relay:start", token),
      list: () => ipcRenderer.invoke("relay:list"),
      inspect: (id: string) => ipcRenderer.invoke("relay:inspect", id),
      cancel: (id: string) => ipcRenderer.invoke("relay:cancel", id),
      discard: (id: string) => ipcRenderer.invoke("relay:discard", id),
      acknowledge: (id: string) => ipcRenderer.invoke("relay:acknowledge", id),
    }),
    transfer: Object.freeze({
      pickUploadFiles: () => ipcRenderer.invoke("transfer:pickUploadFiles"),
      pickDownloadDirectory: () =>
        ipcRenderer.invoke("transfer:pickDownloadDirectory"),
      previewUpload: (input: unknown) =>
        ipcRenderer.invoke("transfer:previewUpload", input),
      previewDownload: (input: unknown) =>
        ipcRenderer.invoke("transfer:previewDownload", input),
      getPreview: (id: string, offset: number) =>
        ipcRenderer.invoke("transfer:getPreview", { id, offset }),
      updatePreview: (id: string, index: number, change: unknown) =>
        ipcRenderer.invoke("transfer:updatePreview", { id, index, change }),
      releasePreview: (id: string) =>
        ipcRenderer.invoke("transfer:releasePreview", id),
      start: (token: string) => ipcRenderer.invoke("transfer:start", token),
      cancel: (id: string) => ipcRenderer.invoke("transfer:cancel", id),
      shelf: () => ipcRenderer.invoke("transfer:shelf"),
    }),
    viewer: Object.freeze({
      setEditing: (token: string, readGeneration: number, active: boolean) =>
        ipcRenderer.invoke("viewer:setEditing", {
          token,
          readGeneration,
          active,
        }),
      discardEditing: (id: string) =>
        ipcRenderer.invoke("viewer:discardEditing", id),
      saveText: (token: string, readGeneration: number, text: string) =>
        ipcRenderer.invoke("viewer:saveText", { token, readGeneration, text }),
      probe: (token: string) => ipcRenderer.invoke("viewer:probe", token),
      next: (token: string, readGeneration: number, sequence: number) =>
        ipcRenderer.invoke("viewer:next", { token, readGeneration, sequence }),
      releaseProbe: (token: string) =>
        ipcRenderer.invoke("viewer:releaseProbe", token),
      open: (entryToken: string, kind: string) =>
        ipcRenderer.invoke("viewer:open", { entryToken, kind }),
      get: (id: string) => ipcRenderer.invoke("viewer:get", id),
      reread: (token: string) => ipcRenderer.invoke("viewer:reread", token),
      stopRead: (token: string, readGeneration: number) =>
        ipcRenderer.invoke("viewer:stopRead", { token, readGeneration }),
    }),
    file: Object.freeze({
      properties: (token: string) =>
        ipcRenderer.invoke("file:properties", token),
      open: (id: string) => ipcRenderer.invoke("file:open", id),
      openStart: (id: string) =>
        ipcRenderer.invoke("file:open", { id, start: true }),
      openFolder: (token: string) =>
        ipcRenderer.invoke("file:openFolder", token),
      list: (token: string) => ipcRenderer.invoke("file:list", token),
      enter: (token: string) => ipcRenderer.invoke("file:enter", token),
      page: (token: string, offset: number) =>
        ipcRenderer.invoke("file:page", { token, offset }),
      previewMutation: (input: unknown) =>
        ipcRenderer.invoke("file:previewMutation", input),
      startMutation: (token: string) =>
        ipcRenderer.invoke("file:startMutation", token),
    }),
    task: Object.freeze({
      list: (offset: number) => ipcRenderer.invoke("task:list", offset),
      inspect: (id: string) => ipcRenderer.invoke("task:inspect", id),
      previewRecordAction: (id: string, action: string) =>
        ipcRenderer.invoke("task:previewRecordAction", { id, action }),
      applyRecordAction: (token: string) =>
        ipcRenderer.invoke("task:applyRecordAction", token),
    }),
    lifecycle: Object.freeze({
      getSnapshot: () => ipcRenderer.invoke("lifecycle:getSnapshot"),
      restartEngine: () => ipcRenderer.invoke("lifecycle:restartEngine"),
      ackDisplayLimit: (token: string) =>
        ipcRenderer.invoke("lifecycle:ackDisplayLimit", token),
    }),
    desktop: Object.freeze({
      getShellState: () => ipcRenderer.invoke("desktop:getShellState"),
      updateShellState: (value: unknown) =>
        ipcRenderer.invoke("desktop:updateShellState", value),
      getWindowSnapshot: () => ipcRenderer.invoke("desktop:getWindowSnapshot"),
      registerWindow: (kind: string, resourceToken?: string) =>
        ipcRenderer.invoke(
          "desktop:registerWindow",
          resourceToken === undefined ? { kind } : { kind, resourceToken },
        ),
      updateWindowLayout: (window: unknown) =>
        ipcRenderer.invoke("desktop:updateWindowLayout", window),
      closeWindow: (id: string) =>
        ipcRenderer.invoke("desktop:closeWindow", id),
    }),
    session: Object.freeze({
      selectActiveServer: (id: string | null) =>
        ipcRenderer.invoke("session:selectActive", id),
      list: () => ipcRenderer.invoke("session:list"),
      connect: (id: string, credentials: unknown) =>
        ipcRenderer.invoke("session:connect", { id, credentials }),
      disconnect: (id: string) => ipcRenderer.invoke("session:disconnect", id),
      confirmOS: (id: string, generation: number) =>
        ipcRenderer.invoke("session:confirmOS", { id, generation }),
    }),
    trust: Object.freeze({
      approve: (id: string) => ipcRenderer.invoke("trust:approve", id),
      reject: (id: string) => ipcRenderer.invoke("trust:reject", id),
    }),
    profile: Object.freeze({
      list: () => ipcRenderer.invoke("profile:list"),
      create: (input: unknown) => ipcRenderer.invoke("profile:create", input),
      update: (id: string, input: unknown) =>
        ipcRenderer.invoke("profile:update", { id, input }),
      delete: (id: string) => ipcRenderer.invoke("profile:delete", id),
      pickKey: () => ipcRenderer.invoke("profile:pickKey"),
    }),
  }),
);
