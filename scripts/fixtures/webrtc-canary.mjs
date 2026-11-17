import { createSocket } from "node:dgram";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { expect } from "@playwright/test";

// Owned loopback listeners only. Positive control proves that LNA/media default
// denial cannot make the protected-view result a false negative.
export async function checkWebRTCIsolation(application, targetURL) {
  const udp = createSocket("udp4");
  let udpPackets = 0,
    tcpConnections = 0;
  udp.on("message", () => udpPackets++);
  const peers = new Set();
  const tcp = createServer((socket) => {
    tcpConnections++;
    peers.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => peers.delete(socket));
    socket.destroy();
  });
  await new Promise((resolve) => udp.bind(0, "127.0.0.1", resolve));
  await new Promise((resolve) => tcp.listen(0, "127.0.0.1", resolve));
  const ports = { udp: udp.address().port, tcp: tcp.address().port };
  try {
    await application.evaluate(
      async ({ app, BrowserWindow, WebContentsView, session }, ports) => {
        const ses = session.fromPartition("webrtc-owned-positive-control", {
          cache: false,
        });
        ses.setPermissionRequestHandler((_c, _p, done) => done(true));
        ses.setPermissionCheckHandler(() => true);
        ses.protocol.handle(
          "sshos-web",
          () =>
            new Response("<html><body>owned control</body></html>", {
              headers: { "Content-Type": "text/html" },
            }),
        );
        const view = new WebContentsView({
          webPreferences: {
            session: ses,
            javascript: true,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        app.__canaryView = view;
        BrowserWindow.getAllWindows()[0].contentView.addChildView(view);
        view.setVisible(false);
        view.webContents.setWebRTCIPHandlingPolicy("default");
        await view.webContents.loadURL("sshos-web://canary-control/index.html");
        await view.webContents.executeJavaScript(
          `(async()=>{window.ownedPeers=[];for(const config of [{iceServers:[{urls:'stun:127.0.0.1:${ports.udp}'}]},{iceServers:[{urls:'turn:127.0.0.1:${ports.tcp}?transport=tcp',username:'fixture',credential:'fixture'}],iceTransportPolicy:'relay'}]){const peer=new RTCPeerConnection(config);peer.createDataChannel('owned');ownedPeers.push(peer);await peer.setLocalDescription(await peer.createOffer());}return true;})()`,
        );
      },
      ports,
    );
    await expect.poll(() => udpPackets, { timeout: 15000 }).toBeGreaterThan(0);
    await expect
      .poll(() => tcpConnections, { timeout: 15000 })
      .toBeGreaterThan(0);
    await application.evaluate(async ({ app, BrowserWindow }) => {
      const view = app.__canaryView;
      await view.webContents.executeJavaScript(
        "ownedPeers.forEach(peer=>peer.close())",
      );
      BrowserWindow.getAllWindows()[0].contentView.removeChildView(view);
      view.webContents.close();
      delete app.__canaryView;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const before = { udp: udpPackets, tcp: tcpConnections };
    const guarded = await application.evaluate(
      async ({ webContents }, { targetURL, ports }) => {
        const contents = webContents
          .getAllWebContents()
          .find((row) => row.getURL() === targetURL);
        if (!contents) throw Error("Missing protected preview");
        // Grant local-network checks in this owned test view: the API policy, not
        // incidental LNA denial, must prevent the same loopback canaries.
        contents.session.setPermissionRequestHandler((_c, _p, done) =>
          done(true),
        );
        contents.session.setPermissionCheckHandler(() => true);
        const result = await contents.executeJavaScript(
          `(async()=>{const names=['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection'];const inspect=realm=>names.map(name=>typeof realm[name]);const result={main:inspect(window),children:[],immutable:true,popup:window.open('about:blank')===null};for(const name of names){try{Object.defineProperty(window,name,{value:Function});result.immutable=false;}catch{}}for(const kind of ['blank','srcdoc']){const frame=document.createElement('iframe');if(kind==='blank')frame.src='about:blank';else frame.srcdoc='<html></html>';document.body.append(frame);try{result.children.push(inspect(frame.contentWindow));}catch{result.children.push(['inaccessible']);}await new Promise(resolve=>setTimeout(resolve,80));try{const realm=frame.contentWindow;const Native=realm.RTCPeerConnection;if(Native){const p=new Native({iceServers:[{urls:'stun:127.0.0.1:${ports.udp}'}]});p.createDataChannel('bypass');await p.setLocalDescription(await p.createOffer());}result.children.push(inspect(realm));}catch{result.children.push(['inaccessible']);}frame.remove();}return result;})()`,
        );
        await contents.loadURL(targetURL + "?policy-navigation=1");
        const after = await contents.executeJavaScript(
          "typeof RTCPeerConnection",
        );
        return { result, after, attached: contents.debugger.isAttached() };
      },
      { targetURL, ports },
    );
    assert.deepEqual(guarded.result.main, [
      "undefined",
      "undefined",
      "undefined",
    ]);
    assert.equal(guarded.result.immutable, true);
    assert.equal(guarded.result.popup, true);
    assert.ok(
      guarded.result.children.every((row) =>
        row.every((value) => value === "undefined" || value === "inaccessible"),
      ),
    );
    assert.equal(guarded.after, "undefined");
    assert.equal(guarded.attached, true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.deepEqual({ udp: udpPackets, tcp: tcpConnections }, before);
    const closed = await application.evaluate(
      async ({ webContents }, prefix) => {
        const contents = webContents
          .getAllWebContents()
          .find((row) => row.getURL().startsWith(prefix));
        if (!contents) throw Error("Missing guarded contents");
        contents.debugger.detach();
        await new Promise((resolve) => setTimeout(resolve, 50));
        return contents.isDestroyed();
      },
      targetURL,
    );
    assert.equal(closed, true);
    return {
      positiveUDP: before.udp,
      positiveTCP: before.tcp,
      protectedUDP: udpPackets - before.udp,
      protectedTCP: tcpConnections - before.tcp,
      mainAndChildRealmsBlocked: true,
      navigationProtected: true,
      detachClosed: true,
    };
  } finally {
    await application
      .evaluate(({ app, BrowserWindow }) => {
        const view = app.__canaryView;
        if (view) {
          BrowserWindow.getAllWindows()[0]?.contentView.removeChildView(view);
          view.webContents.close();
          delete app.__canaryView;
        }
      })
      .catch(() => {});
    for (const peer of peers) peer.destroy();
    await new Promise((resolve) => tcp.close(resolve));
    udp.close();
  }
}
