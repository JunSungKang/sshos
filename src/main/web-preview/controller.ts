import {
  BrowserWindow,
  WebContentsView,
  session,
  type Session,
} from "electron";
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { z } from "zod";
import { remotePathSchema, filePropertiesSchema } from "../../shared/files";
import {
  webPresentationSchema,
  type WebPreviewDescriptor,
} from "../../shared/web-preview";
import type { DesktopController } from "../desktop/desktop";
import type { FileController } from "../file-operations/files";
import type { ConnectionController } from "../connections/connections";
import type { EngineGateway } from "../engine-gateway";
import { WebContentReader } from "./content-reader";
import { resourcePath, previewURL } from "./resource-path";
type Resource = {
  token: string;
  windowId: string | null;
  serverId: string;
  generation: number;
  sessionToken: string;
  epoch: string;
  path: string;
  root: string;
  name: string;
  javascript: boolean;
  view: WebContentsView | null;
  session: Session | null;
  abort: AbortController;
  revision: number;
  bytes: number;
  requests: number;
};
export class WebPreviewController {
  private presentation: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;
  private readonly resources = new Map<string, Resource>();
  private readonly reader: WebContentReader;
  constructor(
    private readonly files: FileController,
    private readonly connections: ConnectionController,
    private readonly desktop: DesktopController,
    private readonly gateway: EngineGateway,
    private readonly host: () => BrowserWindow | null,
  ) {
    this.reader = new WebContentReader(gateway);
    desktop.registerResourceResolver("web", (token) => {
      const row = this.resources.get(token);
      if (!row) throw new Error("TOKEN_EXPIRED");
      this.check(row);
      return {
        serverId: row.serverId,
        generation: row.generation,
        resourceId: row.token,
      };
    });
  }
  private check(row: Resource) {
    if (
      this.resources.get(row.token) !== row ||
      row.abort.signal.aborted ||
      row.epoch !== this.gateway.epoch
    )
      throw new Error("TOKEN_EXPIRED");
    const session = this.connections.sessionCapability(row.sessionToken);
    if (
      session.serverId !== row.serverId ||
      session.generation !== row.generation
    )
      throw new Error("CONNECTION_LOST");
  }
  private row(id: string): Resource {
    const win = this.desktop.requireWindow(id, "web");
    const row = this.resources.get(win.resourceId!);
    if (!row || row.windowId !== id) throw new Error("TOKEN_EXPIRED");
    this.check(row);
    return row;
  }
  private descriptor(row: Resource): WebPreviewDescriptor {
    return {
      windowId: row.windowId!,
      root: row.root,
      name: row.name,
      javascript: row.javascript,
    };
  }
  private disposeView(row: Resource) {
    if (row.view) {
      this.host()?.contentView.removeChildView(row.view);
      row.view.webContents.close();
      row.view = null;
    }
    row.session?.protocol.unhandle("sshos-web");
    row.session = null;
  }
  private createView(row: Resource) {
    this.disposeView(row);
    const revision = ++row.revision;
    row.bytes = 0;
    row.requests = 0;
    const ses = session.fromPartition(`sshos-web-${row.token}-${revision}`, {
      cache: false,
    });
    row.session = ses;
    ses.setSpellCheckerEnabled(false);
    ses.setPermissionRequestHandler((_c, _p, done) => done(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on("will-download", (event) => event.preventDefault());
    ses.webRequest.onBeforeRequest((details, done) => {
      let allowed = false;
      try {
        this.check(row);
        allowed =
          details.url.startsWith(`sshos-web://${row.token}/`) &&
          row.revision === revision;
      } catch {}
      done({ cancel: !allowed });
    });
    ses.protocol.handle("sshos-web", async (request) => {
      try {
        this.check(row);
        if (
          row.revision !== revision ||
          !["GET", "HEAD"].includes(request.method) ||
          ++row.requests > 512
        )
          throw new Error("ASSET_DENIED");
        const { path, mime } = resourcePath(request.url, row.token, row.root);
        const bytes = await this.reader.read(
          row.serverId,
          row.generation,
          path,
          row.abort.signal,
          () => {
            this.check(row);
            if (row.revision !== revision) throw new Error("TOKEN_EXPIRED");
          },
        );
        row.bytes += bytes.length;
        if (row.bytes > 64 * 1024 * 1024) throw new Error("FILE_LIMIT");
        const csp = `default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src ${row.javascript ? "'self' 'unsafe-inline'" : "'none'"}; connect-src ${row.javascript ? "'self'" : "'none'"}; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'; worker-src 'none'`;
        return new Response(
          request.method === "HEAD" ? null : new Uint8Array(bytes),
          {
            headers: {
              "Content-Type": mime,
              "Content-Security-Policy": csp,
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
            },
          },
        );
      } catch {
        return new Response("Remote resource unavailable", {
          status: 403,
          headers: {
            "Content-Type": "text/plain",
            "Cache-Control": "no-store",
          },
        });
      }
    });
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        javascript: row.javascript,
        webSecurity: true,
        spellcheck: false,
        devTools: false,
        webviewTag: false,
      },
    });
    row.view = view;
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    view.webContents.on("will-navigate", (event, url) => {
      try {
        resourcePath(url, row.token, row.root);
      } catch {
        event.preventDefault();
      }
    });
    view.webContents.on("will-redirect", (event, url) => {
      try {
        resourcePath(url, row.token, row.root);
      } catch {
        event.preventDefault();
      }
    });
    this.host()?.contentView.addChildView(view);
    view.setVisible(false);
    void view.webContents
      .loadURL(previewURL(row.token, row.root, row.path))
      .catch(() => {});
  }
  closeWindow(id: string) {
    for (const [token, row] of this.resources)
      if (row.windowId === id) {
        row.abort.abort();
        this.disposeView(row);
        this.resources.delete(token);
      }
  }
  restore() {
    const p = this.presentation;
    if (!p) return;
    try {
      const row = this.row(p.id);
      row.view?.setBounds({ x: p.x, y: p.y, width: p.width, height: p.height });
      row.view?.setVisible(true);
    } catch {
      this.presentation = null;
    }
  }
  hideAll() {
    for (const row of this.resources.values()) row.view?.setVisible(false);
  }
  sessionChanged(serverId: string, generation: number, connected: boolean) {
    for (const row of this.resources.values())
      if (
        row.serverId === serverId &&
        (row.generation !== generation || !connected)
      ) {
        row.abort.abort();
        this.disposeView(row);
      }
  }
  destroy() {
    for (const row of [...this.resources.values()])
      this.closeWindow(row.windowId!);
  }
  async handle(action: string, payload: unknown): Promise<unknown> {
    if (action === "web:open") {
      if (this.resources.size >= 4) throw new Error("VIEW_LIMIT");
      const entry = this.files.resolveEntry(z.uuid().parse(payload));
      if (entry.type !== "file" || !/\.html?$/i.test(entry.rawName))
        throw new Error("PATH_UNSUPPORTED");
      const row: Resource = {
        token: randomUUID(),
        windowId: null,
        serverId: entry.browser.serverId,
        generation: entry.browser.generation,
        sessionToken: entry.browser.sessionToken,
        epoch: this.gateway.epoch,
        path: posix.join(entry.path, entry.rawName),
        root: entry.path,
        name: entry.rawName,
        javascript: false,
        view: null,
        session: null,
        abort: new AbortController(),
        revision: 0,
        bytes: 0,
        requests: 0,
      };
      this.resources.set(row.token, row);
      try {
        const win = this.desktop.handle("desktop:registerWindow", {
          kind: "web",
          resourceToken: row.token,
        }) as import("../../shared/windows").WindowModel;
        row.windowId = win.windowId;
        this.createView(row);
        return win;
      } catch (e) {
        this.disposeView(row);
        this.resources.delete(row.token);
        throw e;
      }
    }
    if (action === "web:present") {
      const input = webPresentationSchema.parse(payload);
      const row = this.row(input.id);
      const host = this.host();
      if (!host) throw new Error("TOKEN_EXPIRED");
      const dimensions = host.getContentSize();
      const w = dimensions[0] ?? 0,
        h = dimensions[1] ?? 0;
      const show =
        input.visible &&
        input.width >= 1 &&
        input.height >= 1 &&
        input.x + input.width <= w + 1 &&
        input.y + input.height <= h + 1 &&
        host.isVisible() &&
        !host.isMinimized();
      if (show) {
        this.presentation = {
          id: input.id,
          x: input.x,
          y: input.y,
          width: input.width,
          height: input.height,
        };
        this.hideAll();
        row.view?.setBounds({
          x: input.x,
          y: input.y,
          width: input.width,
          height: input.height,
        });
      } else if (this.presentation?.id === input.id) this.presentation = null;
      row.view?.setVisible(show);
      return;
    }
    if (action === "web:get")
      return this.descriptor(this.row(z.uuid().parse(payload)));
    if (action === "web:configure") {
      const input = z
        .object({
          id: z.uuid(),
          root: remotePathSchema,
          javascript: z.boolean(),
        })
        .strict()
        .parse(payload);
      const row = this.row(input.id);
      if (input.root !== "/" && !row.path.startsWith(input.root + "/"))
        throw new Error("PATH_UNSUPPORTED");
      const prop = filePropertiesSchema.parse(
        await this.gateway.request({
          action: "file:properties",
          serverId: row.serverId,
          generation: row.generation,
          path: input.root,
        }),
      );
      this.check(row);
      if (prop.type !== "directory") throw new Error("PATH_UNSUPPORTED");
      row.root = input.root;
      row.javascript = input.javascript;
      this.createView(row);
      return this.descriptor(row);
    }
    if (action === "web:reload") {
      const row = this.row(z.uuid().parse(payload));
      this.createView(row);
      return this.descriptor(row);
    }
    throw new Error("INPUT_INVALID");
  }
}
