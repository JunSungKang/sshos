import { describe, expect, it, vi } from "vitest";
import { FileController } from "../../src/main/file-operations/files";
import { DesktopController } from "../../src/main/desktop/desktop";
import type { ConnectionController } from "../../src/main/connections/connections";
import type { EngineGateway } from "../../src/main/engine-gateway";
import type {
  DirectoryPage,
  FileEntry,
  FilePage,
} from "../../src/shared/files";
import type { WindowModel } from "../../src/shared/windows";
function fixture(path = "/home/u") {
  const serverId = crypto.randomUUID(),
    sessionToken = crypto.randomUUID(),
    snapshotId = crypto.randomUUID(),
    requests: unknown[] = [];
  let connected = true,
    sftp = true,
    mismatch = false;
  const connections = {
      sessionCapability: (token: string) => {
        if (!connected || token !== sessionToken)
          throw new Error("SESSION_UNAVAILABLE");
        return {
          serverId: mismatch ? crypto.randomUUID() : serverId,
          generation: 1,
        };
      },
      views: () => [
        {
          serverId,
          generation: 1,
          sessionToken: connected ? sessionToken : null,
          initialPath: path,
          metadata: sftp ? "available" : "unavailable",
          sftp: "available",
        },
      ],
    } as unknown as ConnectionController,
    desktop = new DesktopController(connections),
    window = desktop.handle("desktop:registerWindow", {
      kind: "files",
      resourceToken: sessionToken,
    }) as WindowModel;
  const entry = (
    rawName: string,
    type: FileEntry["type"] = "file",
    operable = true,
  ): FileEntry => ({
    rawName,
    name: rawName,
    type,
    operable,
    size: 1,
    mtime: 1,
    mode: 0o100600,
  });
  const make = (at = 0, location = path): FilePage => ({
    snapshotId,
    path: location,
    listedAt: new Date().toISOString(),
    partial: false,
    total: 4,
    offset: at,
    nextOffset: at === 0 ? 3 : null,
    entries:
      at === 0
        ? [
            entry("file"),
            entry("folder", "directory"),
            entry("link", "symlink", false),
          ]
        : [entry("last")],
  });
  const gateway = {
      request: vi.fn(
        async (request: { action: string; path?: string; offset?: number }) => {
          requests.push(request);
          if (request.action === "file:close") return;
          return make(request.offset, request.path);
        },
      ),
    } as unknown as EngineGateway,
    controller = new FileController(desktop, connections, gateway);
  const open = () =>
    controller.handle("file:open", window.windowId) as Promise<DirectoryPage>;
  return {
    controller,
    desktop,
    window,
    gateway,
    requests,
    open,
    make,
    disconnect: () => {
      connected = false;
    },
    noSftp: () => {
      sftp = false;
    },
    mismatch: () => {
      mismatch = true;
    },
  };
}
describe("main file capabilities and explicit cache", () => {
  it("issues only operable entry/directory capabilities and does not enumerate again on UI reload", async () => {
    const f = fixture(),
      first = await f.open();
    expect(first.entries.map((row) => Boolean(row.entryToken))).toEqual([
      true,
      true,
      false,
    ]);
    expect(
      f.controller.resolveEntry(first.entries[0]!.entryToken!),
    ).toMatchObject({ path: "/home/u", rawName: "file", type: "file" });
    expect(
      f.controller.resolveDirectory(first.entries[1]!.directoryToken!).path,
    ).toBe("/home/u/folder");
    expect(first.parentToken).not.toBeNull();
    expect(JSON.stringify(first)).not.toContain("rawName");
    const next = await f.open();
    expect(f.requests).toHaveLength(1);
    expect(next.pageToken).not.toBe(first.pageToken);
    expect(() =>
      f.controller.resolveEntry(first.entries[0]!.entryToken!),
    ).toThrow("TOKEN_EXPIRED");
    await expect(
      f.controller.handle("file:enter", next.entries[0]!.entryToken),
    ).rejects.toThrow("PATH_UNSUPPORTED");
    const entered = (await f.controller.handle(
      "file:enter",
      next.entries[1]!.entryToken,
    )) as DirectoryPage;
    expect(entered.path).toBe("/home/u/folder");
    expect(() =>
      f.controller.resolveEntry(next.entries[1]!.entryToken!),
    ).toThrow("TOKEN_EXPIRED");
  });
  it("keeps fully cached pages readable after disconnect but all remote/path capabilities fail", async () => {
    const f = fixture("/"),
      first = await f.open();
    expect(first.parentToken).toBeNull();
    const next = (await f.controller.handle("file:page", {
      token: first.pageToken,
      offset: 3,
    })) as DirectoryPage;
    expect(next.offset).toBe(3);
    expect(f.requests).toHaveLength(2);
    f.disconnect();
    const cached = await f.open();
    await f.controller.handle("file:page", {
      token: cached.pageToken,
      offset: 3,
    });
    expect(f.requests).toHaveLength(2);
    expect(() =>
      f.controller.resolveEntry(cached.entries[0]!.entryToken!),
    ).toThrow("SESSION_UNAVAILABLE");
    await expect(
      f.controller.handle("file:list", cached.directoryToken),
    ).rejects.toThrow("SESSION_UNAVAILABLE");
    expect(() => f.controller.resolveDirectory(crypto.randomUUID())).toThrow(
      "TOKEN_EXPIRED",
    );
  });
  it("serializes page consumption and refuses a page that arrived after explicit navigation", async () => {
    const f = fixture(),
      first = await f.open();
    let deliver!: (value: FilePage) => void;
    vi.mocked(f.gateway.request).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const pending = f.controller.handle("file:page", {
      token: first.pageToken,
      offset: 3,
    });
    await expect(
      f.controller.handle("file:page", { token: first.pageToken, offset: 3 }),
    ).rejects.toThrow("REQUEST_BUSY");
    const newPage = (await f.controller.handle(
      "file:list",
      first.directoryToken,
    )) as DirectoryPage;
    deliver(f.make(3));
    await expect(pending).rejects.toThrow("TOKEN_EXPIRED");
    await expect(
      f.controller.handle("file:page", { token: newPage.pageToken, offset: 2 }),
    ).rejects.toThrow("TOKEN_EXPIRED");
  });
  it("never accepts a late list after the session/window changes and cleanup revokes all old tokens", async () => {
    const f = fixture(),
      first = await f.open();
    f.mismatch();
    await expect(
      f.controller.handle("file:list", first.directoryToken),
    ).rejects.toThrow("TOKEN_EXPIRED");
    const g = fixture(),
      page = await g.open();
    await g.controller.closeWindow(g.window.windowId);
    expect(() =>
      g.controller.resolveEntry(page.entries[0]!.entryToken!),
    ).toThrow("TOKEN_EXPIRED");
    await g.controller.closeWindow(g.window.windowId);
    expect(
      g.requests.filter((row: any) => row.action === "file:close"),
    ).toHaveLength(1);
    const h = fixture();
    let deliver!: (value: FilePage) => void;
    vi.mocked(h.gateway.request).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const pending = h.open();
    h.desktop.handle("desktop:closeWindow", h.window.windowId);
    deliver(h.make());
    await expect(pending).rejects.toThrow("TOKEN_EXPIRED");
  });
  it("refuses unavailable command metadata, unknown tokens/actions, wrong window kinds and untrusted names", async () => {
    const f = fixture();
    f.noSftp();
    await expect(f.open()).rejects.toThrow("COMMAND_UNAVAILABLE");
    for (const action of ["file:list", "file:enter"])
      await expect(
        f.controller.handle(action, crypto.randomUUID()),
      ).rejects.toThrow("TOKEN_EXPIRED");
    await expect(f.controller.handle("file:other", undefined)).rejects.toThrow(
      "INPUT_INVALID",
    );
    const g = fixture();
    vi.mocked(g.gateway.request).mockResolvedValue({
      ...g.make(),
      entries: [
        {
          rawName: "bad/name",
          name: "bad/name",
          type: "file",
          operable: true,
          size: 1,
          mtime: 1,
          mode: 0,
        },
        {
          rawName: "special",
          name: "special",
          type: "special",
          operable: true,
          size: 1,
          mtime: 1,
          mode: 0,
        },
      ],
    });
    const page = await g.open();
    expect(page.entries.every((row) => row.entryToken === null)).toBe(true);
    g.desktop.handle("desktop:closeWindow", g.window.windowId);
    await expect(g.open()).rejects.toThrow("TOKEN_EXPIRED");
  });
});

it("opens a folder in a correctly scoped reusable explorer and changes reuse identity after navigation", async () => {
  const f = fixture(),
    page = await f.open(),
    folder = page.entries[1]!.directoryToken!;
  const opened = (await f.controller.handle(
    "file:openFolder",
    folder,
  )) as WindowModel;
  expect(opened.serverId).toBe(f.window.serverId);
  expect(opened.windowId).not.toBe(f.window.windowId);
  expect(
    ((await f.controller.handle("file:open", opened.windowId)) as DirectoryPage)
      .path,
  ).toBe("/home/u/folder");
  expect(
    ((await f.controller.handle("file:openFolder", folder)) as WindowModel)
      .windowId,
  ).toBe(opened.windowId);
  const current = (await f.controller.handle(
    "file:open",
    opened.windowId,
  )) as DirectoryPage;
  await f.controller.handle("file:list", current.parentToken!);
  expect(
    ((await f.controller.handle("file:openFolder", folder)) as WindowModel)
      .windowId,
  ).not.toBe(opened.windowId);
  f.disconnect();
  await expect(f.controller.handle("file:openFolder", folder)).rejects.toThrow(
    "SESSION_UNAVAILABLE",
  );
});
it("refuses to invent an account home and allows only an explicit SFTP-start fallback", async () => {
  const f = fixture(),
    sessionToken = (f.controller as any).connections.views()[0].sessionToken;
  const home = f.desktop.handle("desktop:registerWindow", {
    kind: "home",
    resourceToken: sessionToken,
  }) as WindowModel;
  await expect(f.controller.handle("file:open", home.windowId)).rejects.toThrow(
    "PATH_UNSUPPORTED",
  );
  const page = (await f.controller.handle("file:open", {
    id: home.windowId,
    start: true,
  })) as DirectoryPage;
  expect(page.path).toBe("/home/u");
  await expect(
    f.controller.handle("file:open", { id: home.windowId, start: false }),
  ).rejects.toThrow();
});
it("coalesces identical in-flight refreshes and rejects an older navigation response before publishing capabilities", async () => {
  const f = fixture(),
    first = await f.open();
  let complete!: Function;
  vi.mocked(f.gateway.request).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const one = f.controller.handle("file:list", first.directoryToken),
    two = f.controller.handle("file:list", first.directoryToken);
  complete(f.make());
  expect(await one).toEqual(await two);
  expect(f.gateway.request).toHaveBeenCalledTimes(2);
  const active = await f.open();
  let older!: Function;
  vi.mocked(f.gateway.request).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        older = resolve;
      }),
  );
  const stale = f.controller.handle("file:list", active.directoryToken),
    rejected = expect(stale).rejects.toThrow("REQUEST_CANCELLED");
  const next = (await f.controller.handle(
    "file:enter",
    active.entries[1]!.entryToken,
  )) as DirectoryPage;
  older(f.make());
  await rejected;
  expect(next.path).toBe("/home/u/folder");
  expect(f.controller.resolveDirectory(next.directoryToken).path).toBe(
    "/home/u/folder",
  );
});
it("refreshes selected properties using its bound path and refuses a changed item type", async () => {
  const f = fixture(),
    page = await f.open();
  const value = {
    path: "/home/u/file",
    type: "file",
    size: 1,
    mtime: 1,
    mode: 0o600,
    uid: 1000,
    gid: 1000,
    inode: "1",
    device: "1",
    links: 1,
    listedAt: new Date().toISOString(),
  };
  vi.mocked(f.gateway.request).mockResolvedValueOnce(value);
  expect(
    await f.controller.handle("file:properties", page.entries[0]!.entryToken),
  ).toEqual(value);
  expect(f.gateway.request).toHaveBeenLastCalledWith(
    expect.objectContaining({
      action: "file:properties",
      path: "/home/u/file",
    }),
  );
  vi.mocked(f.gateway.request).mockResolvedValueOnce({
    ...value,
    type: "directory",
  });
  await expect(
    f.controller.handle("file:properties", page.entries[0]!.entryToken),
  ).rejects.toThrow("SOURCE_CHANGED");
});
