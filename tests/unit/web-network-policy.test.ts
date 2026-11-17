import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { describe, it, expect, vi } from "vitest";
import {
  BLOCK_WEBRTC,
  enforcePreviewNetworkPolicy,
} from "../../src/main/web-preview/network-policy";
it("freezes native and legacy WebRTC constructors in the actual main world before loading scripts", async () => {
  const realm: any = {
    RTCPeerConnection: () => {},
    webkitRTCPeerConnection: () => {},
  };
  runInNewContext(BLOCK_WEBRTC, realm);
  for (const name of [
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "mozRTCPeerConnection",
  ])
    expect(Object.getOwnPropertyDescriptor(realm, name)).toMatchObject({
      value: undefined,
      writable: false,
      configurable: false,
    });
  const contents: any = Object.assign(new EventEmitter(), {
    setWebRTCIPHandlingPolicy: vi.fn(),
    debugger: Object.assign(new EventEmitter(), {
      attach: vi.fn(),
      sendCommand: vi.fn().mockResolvedValue({ identifier: "guard" }),
      isAttached: () => true,
    }),
  });
  const fail = vi.fn();
  await enforcePreviewNetworkPolicy(contents, fail);
  expect(contents.debugger.sendCommand).toHaveBeenLastCalledWith(
    "Page.addScriptToEvaluateOnNewDocument",
    { source: BLOCK_WEBRTC },
  );
  contents.debugger.emit("detach");
  contents.emit("render-process-gone");
  expect(fail).toHaveBeenCalledTimes(2);
});
it.each(["attach", "command", "detached"])(
  "fails closed when the %s policy path cannot be established",
  async (failure) => {
    const contents: any = Object.assign(new EventEmitter(), {
      setWebRTCIPHandlingPolicy: vi.fn(),
      debugger: Object.assign(new EventEmitter(), {
        attach: () => {
          if (failure === "attach") throw Error("native detail");
        },
        sendCommand: async () => {
          if (failure === "command") throw Error("native detail");
          return { identifier: "guard" };
        },
        isAttached: () => failure !== "detached",
      }),
    });
    const fail = vi.fn();
    await expect(enforcePreviewNetworkPolicy(contents, fail)).rejects.toThrow(
      "ASSET_DENIED",
    );
    expect(fail).toHaveBeenCalledOnce();
  },
);
