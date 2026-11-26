import type { WebContents } from "electron";

// This trusted main-world script is installed for every frame before any page
// script. It carries no remote input and exposes no main/preload authority.
export const BLOCK_WEBRTC = `(() => {
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
    Object.defineProperty(globalThis, name, {value:undefined,writable:false,configurable:false});
  }
})();`;

// An isolated world keeps the capture listener and its DOM prototypes outside
// the page's JavaScript authority. Cancel defaults even over native file inputs.
const BLOCK_GUEST_DROP = `(() => {
  const block = event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  for (const name of ['dragenter', 'dragover', 'drop']) {
    window.addEventListener(name, block, {capture: true, passive: false});
  }
})();`;

export async function enforcePreviewNetworkPolicy(
  contents: WebContents,
  failClosed: () => void,
): Promise<void> {
  contents.debugger.on("detach", failClosed);
  contents.on("render-process-gone", failClosed);
  try {
    // Defense in depth; IP policy alone does not block TCP/TURN.
    contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    contents.debugger.attach("1.3");
    await contents.debugger.sendCommand("Page.enable");
    const policy = await contents.debugger.sendCommand(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: BLOCK_WEBRTC },
    );
    if (!policy || typeof policy.identifier !== "string" || !policy.identifier)
      throw new Error("ASSET_DENIED");
    const dropGuard = await contents.debugger.sendCommand(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: BLOCK_GUEST_DROP, worldName: "sshos-preview-input" },
    );
    if (!dropGuard?.identifier) throw new Error("ASSET_DENIED");
    // The guest has no reason to show an OS local-file picker.
    await contents.debugger.sendCommand("Page.setInterceptFileChooserDialog", {
      enabled: true,
    });
    if (!contents.debugger.isAttached()) throw new Error("ASSET_DENIED");
  } catch {
    failClosed();
    throw new Error("ASSET_DENIED");
  }
}
