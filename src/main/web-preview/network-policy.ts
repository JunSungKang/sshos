import type { WebContents } from "electron";

// This trusted main-world script is installed for every frame before any page
// script. It carries no remote input and exposes no main/preload authority.
export const BLOCK_WEBRTC = `(() => {
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
    Object.defineProperty(globalThis, name, {value:undefined,writable:false,configurable:false});
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
    if (!contents.debugger.isAttached()) throw new Error("ASSET_DENIED");
  } catch {
    failClosed();
    throw new Error("ASSET_DENIED");
  }
}
