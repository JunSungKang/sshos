import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resourcePath,
  previewURL,
} from "../../src/main/web-preview/resource-path";
import { WebContentReader } from "../../src/main/web-preview/content-reader";
const state = vi.hoisted(() => ({ views: [] as any[], sessions: [] as any[] }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class WebContentsView {
    webContents: any;
    visible = false;
    bounds: any;
    constructor(public options: any) {
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler(fn: any) {
          this.open = fn;
        },
        loadURL: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        open: null,
      });
      state.views.push(this);
    }
    setVisible(value: boolean) {
      this.visible = value;
    }
    setBounds(bounds: any) {
      this.bounds = bounds;
    }
  }
  return {
    BrowserWindow: class {},
    WebContentsView,
    session: {
      fromPartition: vi.fn((name, options) => {
        const value = Object.assign(new EventEmitter(), {
          name,
          options,
          spellcheck: null,
          permission: null,
          check: null,
          handler: null,
          filter: null,
          protocol: {
            handle: vi.fn((_name, fn) => {
              value.handler = fn;
            }),
            unhandle: vi.fn(),
          },
          webRequest: {
            onBeforeRequest: (fn: any) => {
              value.filter = fn;
            },
          },
          setSpellCheckerEnabled: (v: any) => (value.spellcheck = v),
          setPermissionRequestHandler: (fn: any) => (value.permission = fn),
          setPermissionCheckHandler: (fn: any) => (value.check = fn),
        });
        state.sessions.push(value);
        return value;
      }),
    },
  };
});
import { WebPreviewController } from "../../src/main/web-preview/controller";
import { DesktopController } from "../../src/main/desktop/desktop";
import type { EngineGateway } from "../../src/main/engine-gateway";
function fixture() {
  let connected = true,
    epoch = crypto.randomUUID(),
    entryType = "file",
    name = "index.html",
    reply: unknown = {
      path: "/home",
      type: "directory",
      size: 1,
      mtime: 1,
      mode: 0o755,
      uid: 0,
      gid: 0,
      inode: "1",
      device: "1",
      links: 1,
      listedAt: new Date().toISOString(),
    };
  const id = crypto.randomUUID(),
    token = crypto.randomUUID();
  const connections: any = {
    sessionCapability: (input: string) => {
      if (!connected || input !== token) throw Error("CONNECTION_LOST");
      return { serverId: id, generation: 1 };
    },
  };
  const desktop = new DesktopController(connections);
  const files: any = {
    resolveEntry: () => ({
      type: entryType,
      rawName: name,
      path: "/home",
      browser: { serverId: id, generation: 1, sessionToken: token },
    }),
  };
  const gateway: any = {
    get epoch() {
      return epoch;
    },
    request: vi.fn(async () => reply),
  };
  const host: any = {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentSize: () => [1400, 900],
    isVisible: () => true,
    isMinimized: () => false,
  };
  const service = new WebPreviewController(
    files,
    connections,
    desktop,
    gateway,
    () => host,
  );
  return {
    service,
    gateway,
    desktop,
    id,
    host,
    disconnect: () => (connected = false),
    restart: () => (epoch = crypto.randomUUID()),
    setName: (v: string) => (name = v),
    setType: (v: string) => (entryType = v),
    setReply: (v: unknown) => (reply = v),
    open: async () =>
      (await service.handle("web:open", crypto.randomUUID())) as any,
  };
}
beforeEach(() => {
  state.views.length = 0;
  state.sessions.length = 0;
  vi.restoreAllMocks();
});
describe("isolated remote web resource resolution", () => {
  it("resolves relative-root paths, percent-encoded names and exact MIME while denying foreign authority", () => {
    const token = crypto.randomUUID();
    expect(previewURL(token, "/home", "/home/a b.html")).toBe(
      `sshos-web://${token}/a%20b.html`,
    );
    expect(previewURL(token, "/", "/a.html")).toBe(
      `sshos-web://${token}/a.html`,
    );
    expect(
      resourcePath(`sshos-web://${token}/css/main.css?v=2`, token, "/home"),
    ).toEqual({ path: "/home/css/main.css", mime: "text/css; charset=utf-8" });
    for (const url of [
      "https://example.com/a.html",
      `sshos-web://other/a.html`,
      `sshos-web://u@${token}/a.html`,
      `sshos-web://${token}:1/a.html`,
      `sshos-web://${token}/%2e%2e%2fsecret.html`,
      `sshos-web://${token}/a%5cb.html`,
      `sshos-web://${token}/unknown.exe`,
    ])
      expect(() => resourcePath(url, token, "/home")).toThrow();
    expect(() => previewURL(token, "/home", "/elsewhere/a.html")).toThrow();
  });
  it("opens bounded ephemeral sandboxed views without preload, shell or external permissions", async () => {
    const f = fixture(),
      win = await f.open();
    expect(win.kind).toBe("web");
    const view = state.views[0],
      ses = state.sessions[0];
    expect(view.options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      webSecurity: true,
      webviewTag: false,
    });
    expect(view.options.webPreferences.preload).toBeUndefined();
    expect(ses.name.startsWith("persist:")).toBe(false);
    expect(ses.options.cache).toBe(false);
    expect(view.webContents.open()).toEqual({ action: "deny" });
    const done = vi.fn();
    ses.permission(null, "camera", done);
    expect(done).toHaveBeenCalledWith(false);
    expect(ses.check()).toBe(false);
    const event = { preventDefault: vi.fn() };
    ses.emit("will-download", event);
    view.webContents.emit("will-attach-webview", event);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(await f.service.handle("web:get", win.windowId)).toMatchObject({
      javascript: false,
      root: "/home",
    });
    f.service.destroy();
    expect(view.webContents.close).toHaveBeenCalled();
  });
  it("blocks network, redirects and foreign navigations while permitting its own root", async () => {
    const f = fixture();
    await f.open();
    const ses = state.sessions[0],
      view = state.views[0],
      url = view.webContents.loadURL.mock.calls[0][0];
    const done = vi.fn();
    ses.filter({ url }, done);
    expect(done).toHaveBeenLastCalledWith({ cancel: false });
    ses.filter({ url: "https://example.com" }, done);
    expect(done).toHaveBeenLastCalledWith({ cancel: true });
    const event = { preventDefault: vi.fn() };
    view.webContents.emit("will-navigate", event, url);
    expect(event.preventDefault).not.toHaveBeenCalled();
    view.webContents.emit("will-navigate", event, "file:///etc/passwd");
    view.webContents.emit("will-redirect", event, "https://example.com");
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    f.disconnect();
    ses.filter({ url }, done);
    expect(done).toHaveBeenLastCalledWith({ cancel: true });
    f.service.destroy();
  });
  it("serves bounded remote resources with restrictive headers and default-disabled scripts", async () => {
    const f = fixture();
    await f.open();
    const ses = state.sessions[0],
      url = state.views[0].webContents.loadURL.mock.calls[0][0];
    vi.spyOn(WebContentReader.prototype, "read").mockResolvedValue(
      Buffer.from("<h1>remote</h1>"),
    );
    const response = await ses.handler(new Request(url));
    expect(await response.text()).toBe("<h1>remote</h1>");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "script-src 'none'",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(
      (await ses.handler(new Request(url, { method: "POST" }))).status,
    ).toBe(403);
    expect((await ses.handler(new Request("https://example.com"))).status).toBe(
      403,
    );
    expect(
      await (await ses.handler(new Request(url, { method: "HEAD" }))).text(),
    ).toBe("");
    vi.mocked(WebContentReader.prototype.read).mockRejectedValue(
      Error("secret details"),
    );
    expect(await (await ses.handler(new Request(url))).text()).toBe(
      "Remote resource unavailable",
    );
    f.service.destroy();
  });
  it("requires explicit valid root/JS configuration and retires old native contents", async () => {
    const f = fixture(),
      win = await f.open(),
      old = state.views[0],
      ses = state.sessions[0],
      url = old.webContents.loadURL.mock.calls[0][0];
    await expect(
      f.service.handle("web:configure", {
        id: win.windowId,
        root: "/outside",
        javascript: true,
      }),
    ).rejects.toThrow("PATH_UNSUPPORTED");
    expect(
      await f.service.handle("web:configure", {
        id: win.windowId,
        root: "/",
        javascript: true,
      }),
    ).toMatchObject({ root: "/", javascript: true });
    expect(old.webContents.close).toHaveBeenCalled();
    expect(state.views[1].options.webPreferences.javascript).toBe(true);
    expect((await ses.handler(new Request(url))).status).toBe(403);
    expect(await f.service.handle("web:reload", win.windowId)).toMatchObject({
      javascript: true,
    });
    f.setReply({
      path: "/",
      type: "file",
      size: 1,
      mtime: 1,
      mode: 0o600,
      uid: 0,
      gid: 0,
      inode: "1",
      device: "1",
      links: 1,
      listedAt: new Date().toISOString(),
    });
    await expect(
      f.service.handle("web:configure", {
        id: win.windowId,
        root: "/",
        javascript: false,
      }),
    ).rejects.toThrow("PATH_UNSUPPORTED");
    f.service.destroy();
  });
  it("shows only one bounded native view and hides it on invalid bounds, minimize, dialog or session retirement", async () => {
    const f = fixture(),
      win = await f.open(),
      present = {
        id: win.windowId,
        visible: true,
        x: 200,
        y: 180,
        width: 700,
        height: 400,
      };
    await f.service.handle("web:present", present);
    f.service.hideAll();
    f.service.restore();
    expect(state.views[0].visible).toBe(true);
    expect(state.views[0].bounds).toEqual({
      x: 200,
      y: 180,
      width: 700,
      height: 400,
    });
    await f.service.handle("web:present", { ...present, x: 1300 });
    expect(state.views[0].visible).toBe(false);
    await f.service.handle("web:present", { ...present, visible: false });
    f.host.isMinimized = () => true;
    await f.service.handle("web:present", present);
    f.service.hideAll();
    f.service.restore();
    expect(state.views[0].visible).toBe(false);
    f.service.sessionChanged(f.id, 2, true);
    expect(state.views[0].webContents.close).toHaveBeenCalled();
    await expect(f.service.handle("web:get", win.windowId)).rejects.toThrow(
      "TOKEN_EXPIRED",
    );
    f.service.closeWindow(win.windowId);
    await expect(f.service.handle("web:get", win.windowId)).rejects.toThrow();
  });
  it("rejects unsupported targets, missing resources, wrong operations, old epochs and view-limit overflow", async () => {
    const f = fixture();
    f.setName("script.sh");
    await expect(f.open()).rejects.toThrow("PATH_UNSUPPORTED");
    f.setName("index.html");
    f.setType("directory");
    await expect(f.open()).rejects.toThrow("PATH_UNSUPPORTED");
    f.setType("file");
    for (let i = 0; i < 4; i++) await f.open();
    await expect(f.open()).rejects.toThrow("VIEW_LIMIT");
    await expect(f.service.handle("unknown", null)).rejects.toThrow(
      "INPUT_INVALID",
    );
    await expect(
      f.service.handle("web:get", crypto.randomUUID()),
    ).rejects.toThrow();
    f.restart();
    const id = (
      f.desktop.handle("desktop:getWindowSnapshot", undefined) as any[]
    )[0].windowId;
    await expect(f.service.handle("web:get", id)).rejects.toThrow(
      "TOKEN_EXPIRED",
    );
    f.service.destroy();
  });
  it("limits page request counts and total response bytes instead of allocating an unbounded cache", async () => {
    const f = fixture();
    await f.open();
    const ses = state.sessions[0],
      url = state.views[0].webContents.loadURL.mock.calls[0][0];
    vi.spyOn(WebContentReader.prototype, "read").mockResolvedValue(
      Buffer.alloc(0),
    );
    for (let i = 0; i < 512; i++)
      expect((await ses.handler(new Request(url))).status).toBe(200);
    expect((await ses.handler(new Request(url))).status).toBe(403);
    f.service.destroy();
    const g = fixture();
    await g.open();
    const current = state.sessions.at(-1),
      ownURL = state.views.at(-1).webContents.loadURL.mock.calls[0][0];
    vi.mocked(WebContentReader.prototype.read).mockResolvedValue(
      Buffer.alloc(17 * 1024 * 1024),
    );
    for (let i = 0; i < 3; i++)
      expect((await current.handler(new Request(ownURL))).status).toBe(200);
    expect((await current.handler(new Request(ownURL))).status).toBe(403);
    g.service.destroy();
  });
});
describe("SFTP web resource reader identity and backpressure", () => {
  it("reads sequenced bounded frames, waits for the shared pool, and always cancels its lease", async () => {
    let n = 0;
    const gateway = {
      request: vi.fn(async (r) =>
        r.action === "viewer:next"
          ? ++n === 1
            ? {
                viewerId: r.viewerId,
                readGeneration: 1,
                sequence: 0,
                status: "waiting",
                phase: "queued",
              }
            : n === 2
              ? {
                  viewerId: r.viewerId,
                  readGeneration: 1,
                  sequence: 0,
                  status: "chunk",
                  bytes: Buffer.from("hello"),
                  metadata: {
                    path: "/home/a.html",
                    size: 5,
                    mtime: 1,
                    readAt: null,
                  },
                }
              : {
                  viewerId: r.viewerId,
                  readGeneration: 1,
                  sequence: 1,
                  status: "end",
                  metadata: {
                    path: "/home/a.html",
                    size: 5,
                    mtime: 1,
                    readAt: new Date().toISOString(),
                  },
                }
          : undefined,
      ),
    } as unknown as EngineGateway;
    const reader = new WebContentReader(gateway);
    expect(
      await reader.read(
        "s",
        1,
        "/home/a.html",
        new AbortController().signal,
        () => {},
      ),
    ).toEqual(Buffer.from("hello"));
    expect(gateway.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "viewer:cancel" }),
    );
  });
  it("rejects cancellation/stale authority before dispatch without opening a remote file", async () => {
    const gateway = { request: vi.fn() } as unknown as EngineGateway,
      reader = new WebContentReader(gateway),
      abort = new AbortController();
    abort.abort();
    await expect(
      reader.read("s", 1, "/home/a.html", abort.signal, () => {}),
    ).rejects.toThrow("REQUEST_CANCELLED");
    await expect(
      reader.read("s", 1, "/home/a.html", new AbortController().signal, () => {
        throw Error("TOKEN_EXPIRED");
      }),
    ).rejects.toThrow("TOKEN_EXPIRED");
    expect(gateway.request).not.toHaveBeenCalled();
  });
});
it("queues at most 32 waiting web resources and reserves two actual reads", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => (release = resolve));
  let active = 0,
    maximum = 0;
  const gateway = {
    request: vi.fn(async (r) => {
      if (r.action === "viewer:open") {
        active++;
        maximum = Math.max(maximum, active);
        await barrier;
      }
      if (r.action === "viewer:cancel") active--;
      if (r.action === "viewer:next")
        return {
          viewerId: r.viewerId,
          readGeneration: 1,
          sequence: 0,
          status: "end",
          metadata: { path: "/home/a.html", size: 0, mtime: 1, readAt: null },
        };
    }),
  } as unknown as EngineGateway;
  const reader = new WebContentReader(gateway),
    pending = Array.from({ length: 34 }, () =>
      reader.read(
        "s",
        1,
        "/home/a.html",
        new AbortController().signal,
        () => {},
      ),
    );
  await expect(
    reader.read("s", 1, "/home/a.html", new AbortController().signal, () => {}),
  ).rejects.toThrow("REQUEST_BUSY");
  release();
  await Promise.all(pending);
  expect(maximum).toBe(2);
  expect(active).toBe(0);
});
it("cancels a started SFTP resource on read failure and rejects a stream over the byte budget", async () => {
  let size = 0;
  const gateway = {
    request: vi.fn(async (r) => {
      if (r.action === "viewer:next") {
        size += 65536;
        return {
          viewerId: r.viewerId,
          readGeneration: 1,
          sequence: r.sequence,
          status: "chunk",
          bytes: Buffer.alloc(65536),
          metadata: {
            path: "/home/a.html",
            size: 21 * 1024 * 1024,
            mtime: 1,
            readAt: null,
          },
        };
      }
    }),
  } as unknown as EngineGateway;
  const reader = new WebContentReader(gateway);
  await expect(
    reader.read("s", 1, "/home/a.html", new AbortController().signal, () => {}),
  ).rejects.toThrow("FILE_LIMIT");
  expect(gateway.request).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: "viewer:cancel" }),
  );
});

it("restores the last presentation only while its capability remains valid", async () => {
  const f = fixture();
  f.service.restore();
  const win = await f.open();
  await f.service.handle("web:present", {
    id: win.windowId,
    visible: true,
    x: 200,
    y: 200,
    width: 500,
    height: 300,
  });
  f.service.hideAll();
  expect(state.views[0].visible).toBe(false);
  f.service.restore();
  expect(state.views[0].visible).toBe(true);
  f.disconnect();
  f.service.restore();
  f.service.destroy();
});
it("restores an explicitly visible presentation after host focus and ignores retired ones", async () => {
  const f = fixture();
  f.service.restore();
  const win = await f.open();
  await f.service.handle("web:present", {
    id: win.windowId,
    visible: true,
    x: 200,
    y: 200,
    width: 500,
    height: 300,
  });
  f.service.hideAll();
  expect(state.views[0].visible).toBe(false);
  f.service.restore();
  expect(state.views[0].visible).toBe(true);
  f.service.closeWindow(win.windowId);
  expect(() => f.service.restore()).not.toThrow();
});
