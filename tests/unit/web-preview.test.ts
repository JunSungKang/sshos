import { WebReadBudget } from "../../src/main/web-preview/read-budget";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resourcePath,
  previewURL,
} from "../../src/main/web-preview/resource-path";
import { WebContentReader } from "../../src/main/web-preview/content-reader";
const state = vi.hoisted(() => ({
  views: [] as any[],
  sessions: [] as any[],
  policyFailure: false,
  policyBarrier: null as Promise<void> | null,
}));
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
        debugger: Object.assign(new EventEmitter(), {
          attach: vi.fn(),
          isAttached: () => true,
          sendCommand: vi.fn(async () => {
            if (state.policyFailure) throw Error("failure");
            if (state.policyBarrier) await state.policyBarrier;
            return { identifier: "policy" };
          }),
        }),
        setWebRTCIPHandlingPolicy: vi.fn(),
        isDestroyed: () => false,
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
    views: () => [{ serverId: id, generation: 1, sftp: "available" }],
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
    connections,
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
  state.policyFailure = false;
  state.policyBarrier = null;
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
      url = view.webContents.loadURL.mock.calls.at(-1)[0];
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
      url = state.views[0].webContents.loadURL.mock.calls.at(-1)[0];
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
      url = old.webContents.loadURL.mock.calls.at(-1)[0];
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
      url = state.views[0].webContents.loadURL.mock.calls.at(-1)[0];
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
      ownURL = state.views.at(-1).webContents.loadURL.mock.calls.at(-1)[0];
    vi.mocked(WebContentReader.prototype.read)
      .mockClear()
      .mockImplementation(async (_s, _g, _p, _a, _c, budget) => {
        budget!.reserve(16 * 1024 * 1024);
        return Buffer.alloc(16 * 1024 * 1024);
      });
    for (let i = 0; i < 4; i++)
      expect((await current.handler(new Request(ownURL))).status).toBe(200);
    expect((await current.handler(new Request(ownURL))).status).toBe(403);
    expect(WebContentReader.prototype.read).toHaveBeenCalledTimes(4);
    g.service.destroy();
  });
});
function resourceGateway(
  size: number,
  options: {
    wait?: boolean;
    failure?: boolean;
    growth?: boolean;
    barrier?: Promise<void>;
    onOpen?: () => void;
    onClose?: () => void;
  } = {},
) {
  const rows = new Map<string, { offset: number }>();
  let waiting = options.wait ?? false;
  let actualBytes = 0;
  const metadata = { path: "/home/a.html", size, mtime: 1, readAt: null };
  const request = vi.fn(async (r: any) => {
    if (r.action === "viewer:open") {
      options.onOpen?.();
      await options.barrier;
      rows.set(r.viewerId, { offset: 0 });
      return;
    }
    if (r.action === "viewer:cancel") {
      options.onClose?.();
      rows.delete(r.viewerId);
      return;
    }
    if (r.action === "viewer:peek") {
      if (waiting) {
        waiting = false;
        return null;
      }
      return metadata;
    }
    if (r.action === "viewer:next") {
      if (options.failure) throw Error("CONNECTION_LOST");
      const row = rows.get(r.viewerId)!;
      const remaining = size + (options.growth ? 1 : 0) - row.offset;
      if (remaining <= 0)
        return {
          viewerId: r.viewerId,
          readGeneration: 1,
          sequence: r.sequence,
          status: "end",
          metadata,
        };
      const count = Math.min(65536, remaining);
      row.offset += count;
      actualBytes += count;
      return {
        viewerId: r.viewerId,
        readGeneration: 1,
        sequence: r.sequence,
        status: "chunk",
        bytes: Buffer.alloc(count, 65),
        metadata,
      };
    }
  });
  return {
    gateway: { request } as unknown as EngineGateway,
    request,
    get actualBytes() {
      return actualBytes;
    },
  };
}
describe("SFTP resource admission and shared byte reservations", () => {
  it("waits for metadata without consuming data and reserves bytes before first next", async () => {
    const f = resourceGateway(5, { wait: true }),
      reader = new WebContentReader(f.gateway),
      budget = new WebReadBudget(5);
    expect(
      await reader.read(
        "s",
        1,
        "/home/a.html",
        new AbortController().signal,
        () => {},
        budget,
      ),
    ).toEqual(Buffer.alloc(5, 65));
    expect(f.actualBytes).toBe(5);
    const opens = f.request.mock.calls.length;
    await expect(
      reader.read(
        "s",
        1,
        "/home/a.html",
        new AbortController().signal,
        () => {},
        budget,
      ),
    ).rejects.toThrow("FILE_LIMIT");
    expect(f.request).toHaveBeenCalledTimes(opens);
  });
  it("atomically reserves shared remaining bytes across concurrent reads and blocks all later file IO", async () => {
    const f = resourceGateway(4),
      reader = new WebContentReader(f.gateway),
      budget = new WebReadBudget(4);
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        reader.read(
          "s",
          1,
          "/home/a.html",
          new AbortController().signal,
          () => {},
          budget,
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(f.actualBytes).toBe(4);
    const before = f.request.mock.calls.length;
    for (let i = 0; i < 20; i++)
      await expect(
        reader.read(
          "s",
          1,
          "/home/a.html",
          new AbortController().signal,
          () => {},
          budget,
        ),
      ).rejects.toThrow("FILE_LIMIT");
    expect(f.request).toHaveBeenCalledTimes(before);
  });
  it("never reads content for a file larger than the remaining load budget or file limit", async () => {
    for (const size of [6, 21 * 1024 * 1024]) {
      const f = resourceGateway(size),
        reader = new WebContentReader(f.gateway);
      await expect(
        reader.read(
          "s",
          1,
          "/home/a.html",
          new AbortController().signal,
          () => {},
          new WebReadBudget(5),
        ),
      ).rejects.toThrow("FILE_LIMIT");
      expect(f.actualBytes).toBe(0);
      expect(
        f.request.mock.calls.some(([r]) => r.action === "viewer:next"),
      ).toBe(false);
      expect(f.request).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: "viewer:cancel" }),
      );
    }
  });
  it("keeps failed reservations charged and cancels the opened reader without replay", async () => {
    const f = resourceGateway(4, { failure: true }),
      reader = new WebContentReader(f.gateway),
      budget = new WebReadBudget(4);
    await expect(
      reader.read(
        "s",
        1,
        "/home/a.html",
        new AbortController().signal,
        () => {},
        budget,
      ),
    ).rejects.toThrow("CONNECTION_LOST");
    const before = f.request.mock.calls.length;
    await expect(
      reader.read(
        "s",
        1,
        "/home/a.html",
        new AbortController().signal,
        () => {},
        budget,
      ),
    ).rejects.toThrow("FILE_LIMIT");
    expect(f.request).toHaveBeenCalledTimes(before);
  });
  it("rejects bytes beyond the reserved metadata size", async () => {
    const f = resourceGateway(4, { growth: true }),
      reader = new WebContentReader(f.gateway);
    await expect(
      reader.read(
        "s",
        1,
        "/home/a.html",
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("FILE_LIMIT");
    expect(f.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "viewer:cancel" }),
    );
  });
  it("bounds active reads and pending requests without evicting existing work", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    let active = 0,
      maximum = 0;
    const f = resourceGateway(0, {
        barrier,
        onOpen: () => {
          active++;
          maximum = Math.max(active, maximum);
        },
        onClose: () => active--,
      }),
      reader = new WebContentReader(f.gateway);
    const pending = Array.from({ length: 34 }, () =>
      reader.read(
        "s",
        1,
        "/home/a.html",
        new AbortController().signal,
        () => {},
      ),
    );
    await expect(
      reader.read(
        "s",
        1,
        "/home/a.html",
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("REQUEST_BUSY");
    release();
    await Promise.all(pending);
    expect(maximum).toBe(2);
    expect(active).toBe(0);
  });
  it("refuses aborted/stale work before file open and validates reservation numbers", async () => {
    const f = resourceGateway(0),
      reader = new WebContentReader(f.gateway),
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
    expect(f.request).not.toHaveBeenCalled();
    for (const n of [-1, NaN, Infinity, 1.5, 9])
      expect(() => new WebReadBudget(8).reserve(n)).toThrow("FILE_LIMIT");
  });
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

it("reports SFTP unavailability before opening a content preview without revoking SSH metadata", async () => {
  const f = fixture();
  f.connections.views = () => [
    { serverId: f.id, generation: 1, sftp: "unavailable" },
  ];
  await expect(f.open()).rejects.toThrow("SFTP_UNAVAILABLE");
  expect(state.views).toHaveLength(0);
});

it("fails closed on network-policy setup, removes failed desktop registration and closes detached/crashed previews", async () => {
  const f = fixture();
  state.policyFailure = true;
  await expect(f.open()).rejects.toThrow("ASSET_DENIED");
  expect(f.desktop.handle("desktop:getWindowSnapshot", undefined)).toEqual([]);
  state.policyFailure = false;
  const win = await f.open(),
    view = state.views.at(-1);
  view.webContents.debugger.emit("detach");
  expect(view.webContents.close).toHaveBeenCalled();
  expect(view.webContents.loadURL).toHaveBeenCalledTimes(2);
  await f.service.handle("web:reload", win.windowId);
  const next = state.views.at(-1);
  next.webContents.emit("render-process-gone");
  expect(next.webContents.close).toHaveBeenCalled();
  f.service.destroy();
});

it("serializes reload/configure setup and prevents a closed setup from loading or disposing a replacement", async () => {
  const f = fixture(),
    first = await f.open();
  let release!: () => void;
  state.policyBarrier = new Promise<void>((resolve) => (release = resolve));
  const old = f.service.handle("web:reload", first.windowId);
  await vi.waitFor(() => expect(state.views.length).toBe(2));
  await expect(f.service.handle("web:reload", first.windowId)).rejects.toThrow(
    "REQUEST_BUSY",
  );
  await expect(
    f.service.handle("web:configure", {
      id: first.windowId,
      root: "/home",
      javascript: true,
    }),
  ).rejects.toThrow("REQUEST_BUSY");
  f.desktop.handle("desktop:closeWindow", first.windowId);
  f.service.closeWindow(first.windowId);
  const rejected = expect(old).rejects.toThrow("ASSET_DENIED");
  const replacement = f.open();
  release();
  await rejected;
  const next = await replacement;
  expect(state.views.at(-1).webContents.loadURL.mock.calls.at(-1)[0]).toContain(
    "sshos-web:",
  );
  expect(await f.service.handle("web:get", next.windowId)).toMatchObject({
    javascript: false,
  });
  f.service.destroy();
});
it("validates frame authority and waits without consuming reserved bytes on a waiting frame", async () => {
  for (const fault of ["waiting", "identity", "path", "aborted"] as const) {
    const f = resourceGateway(4),
      original = f.request.getMockImplementation()!,
      abort = new AbortController();
    let waited = false;
    f.request.mockImplementation(async (request) => {
      if (request.action === "viewer:open" && fault === "aborted") {
        const value = await original(request);
        abort.abort();
        return value;
      }
      if (request.action === "viewer:next" && fault === "waiting" && !waited) {
        waited = true;
        return {
          viewerId: request.viewerId,
          readGeneration: 1,
          sequence: request.sequence,
          status: "waiting",
          phase: "reading",
        };
      }
      const value: any = await original(request);
      if (request.action === "viewer:next" && value && fault === "identity")
        value.viewerId = crypto.randomUUID();
      if (request.action === "viewer:next" && value && fault === "path")
        value.metadata = { ...value.metadata, path: "/other" };
      return value;
    });
    const promise = new WebContentReader(f.gateway).read(
      "s",
      1,
      "/home/a.html",
      abort.signal,
      () => {},
    );
    if (fault === "waiting") expect(await promise).toEqual(Buffer.alloc(4, 65));
    else
      await expect(promise).rejects.toThrow(
        fault === "identity"
          ? "TOKEN_EXPIRED"
          : fault === "path"
            ? "PATH_CHANGED"
            : "REQUEST_CANCELLED",
      );
  }
});
it("checks bound session identity and serves enabled-script CSP only after current read authority validation", async () => {
  const f = fixture(),
    win = await f.open();
  await f.service.handle("web:configure", {
    id: win.windowId,
    root: "/home",
    javascript: true,
  });
  vi.spyOn(WebContentReader.prototype, "read").mockImplementation(
    async (_s, _g, _p, _a, check, budget) => {
      check();
      budget!.reserve(1);
      return Buffer.from("x");
    },
  );
  const ses = state.sessions.at(-1),
    url = state.views.at(-1).webContents.loadURL.mock.calls.at(-1)[0],
    response = await ses.handler(new Request(url));
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "script-src 'self' 'unsafe-inline'",
  );
  f.connections.sessionCapability = () => ({
    serverId: crypto.randomUUID(),
    generation: 1,
  });
  await expect(f.service.handle("web:get", win.windowId)).rejects.toThrow(
    "CONNECTION_LOST",
  );
  f.service.destroy();
});
it("rejects a late resource after revision change and restores prior configuration when policy setup fails", async () => {
  const f = fixture(),
    win = await f.open(),
    ses = state.sessions[0],
    url = state.views[0].webContents.loadURL.mock.calls.at(-1)[0];
  const deferred = Promise.withResolvers<Buffer>();
  vi.spyOn(WebContentReader.prototype, "read").mockImplementation(
    async (_s, _g, _p, _a, check) => {
      await deferred.promise;
      check();
      return Buffer.from("old");
    },
  );
  const old = ses.handler(new Request(url));
  await f.service.handle("web:reload", win.windowId);
  deferred.resolve(Buffer.from("old"));
  expect((await old).status).toBe(403);
  state.policyFailure = true;
  await expect(
    f.service.handle("web:configure", {
      id: win.windowId,
      root: "/home",
      javascript: true,
    }),
  ).rejects.toThrow("ASSET_DENIED");
  expect(await f.service.handle("web:get", win.windowId)).toMatchObject({
    javascript: false,
    root: "/home",
  });
  state.policyFailure = false;
  await f.service.handle("web:reload", win.windowId);
  f.service.destroy();
});
it("bounds native renderer initialization and removes failed registration without loading remote content", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    const initial = state.views.length;
    const open = f.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.views.length).toBe(initial + 1);
    await open;
    const win = (
      f.desktop.handle("desktop:getWindowSnapshot", undefined) as any[]
    )[0];
    state.policyBarrier = new Promise(() => {});
    const pending = f.service.handle("web:reload", win.windowId),
      rejected = expect(pending).rejects.toThrow("ASSET_DENIED");
    await vi.advanceTimersByTimeAsync(10001);
    await rejected;
    expect(state.views.at(-1).webContents.loadURL.mock.calls).toHaveLength(1);
    f.service.destroy();
    expect(f.desktop.handle("desktop:getWindowSnapshot", undefined)).toEqual(
      [],
    );
  } finally {
    vi.useRealTimers();
  }
});
