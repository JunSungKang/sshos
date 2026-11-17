import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import { DiagnosticsController } from "../../src/main/settings/diagnostics";
import type { DiagnosticLog } from "../../src/main/settings/diagnostic-log";
import { NativeDialogGate } from "../../src/main/native-dialogs";
vi.mock("electron", () => ({ dialog: { showSaveDialog: vi.fn() } }));
const owned: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of owned.splice(0)) await rm(path, { recursive: true });
});
const metadata = {
  appVersion: "0.1.0",
  electron: "45.3.2",
  node: "24.22.2",
  chrome: "156",
  platform: "darwin" as const,
  architecture: "arm64" as const,
  engine: "ready" as const,
  connectedServers: 0,
  activeTasks: 0,
};
async function fixture(log: DiagnosticLog | null = null) {
  await mkdir(resolve(".local/tmp"), { recursive: true });
  const root = await mkdtemp(resolve(".local/tmp/diag-export-"));
  owned.push(root);
  let owner: BrowserWindow | null = {
    isDestroyed: () => false,
    webContents: { id: 1 },
  } as BrowserWindow;
  const controller = new DiagnosticsController(
    log,
    () => metadata,
    () => owner,
    new NativeDialogGate(),
  );
  vi.mocked(dialog.showSaveDialog).mockResolvedValue({
    canceled: false,
    filePath: join(root, "export.json"),
  });
  return {
    root,
    controller,
    owner: () => owner,
    replace: () => {
      owner = {
        isDestroyed: () => false,
        webContents: { id: 2 },
      } as BrowserWindow;
    },
    none: () => {
      owner = null;
    },
  };
}
describe("main-owned redacted export", () => {
  it("writes exactly the frozen preview once, mode0600, and never overwrites an existing file", async () => {
    const f = await fixture(),
      preview = await f.controller.preview();
    expect(JSON.parse(preview.json)).toMatchObject({
      schemaVersion: 1,
      logsAvailable: false,
      logs: [],
    });
    await expect(f.controller.export(preview.token)).resolves.toEqual({
      saved: true,
    });
    expect(await readFile(join(f.root, "export.json"), "utf8")).toBe(
      preview.json,
    );
    await expect(f.controller.export(preview.token)).rejects.toThrow(
      "TOKEN_EXPIRED",
    );
    const again = await f.controller.preview();
    await expect(f.controller.export(again.token)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await readFile(join(f.root, "export.json"), "utf8")).toBe(
      preview.json,
    );
  });
  it("expires, releases and invalidates previews; unowned/closed UI never opens a dialog", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0),
      f = await fixture(),
      a = await f.controller.preview();
    f.controller.release(a.token);
    f.controller.release(a.token);
    await expect(f.controller.export(a.token)).rejects.toThrow("TOKEN_EXPIRED");
    const b = await f.controller.preview();
    clock.mockReturnValue(60000);
    await expect(f.controller.export(b.token)).rejects.toThrow("TOKEN_EXPIRED");
    const c = await f.controller.preview();
    f.controller.invalidate();
    await expect(f.controller.export(c.token)).rejects.toThrow("TOKEN_EXPIRED");
    const d = await f.controller.preview();
    f.none();
    await expect(f.controller.export(d.token)).rejects.toThrow("IPC_DENIED");
    const g = await fixture();
    vi.spyOn(g.owner()!, "isDestroyed").mockReturnValue(true);
    await expect(
      g.controller.export((await g.controller.preview()).token),
    ).rejects.toThrow("IPC_DENIED");
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
  });
  it("makes cancelled or pathless picker results a consumed non-write", async () => {
    for (const result of [
      { canceled: true, filePath: "/not-used" },
      { canceled: false, filePath: undefined },
    ]) {
      const f = await fixture(),
        preview = await f.controller.preview();
      vi.mocked(dialog.showSaveDialog).mockResolvedValue(result as never);
      expect(await f.controller.export(preview.token)).toEqual({
        saved: false,
      });
      await expect(f.controller.export(preview.token)).rejects.toThrow(
        "TOKEN_EXPIRED",
      );
    }
  });
  it("rechecks renderer identity, generation, lifetime and expiry after the native picker", async () => {
    for (const failure of ["identity", "generation", "expiry", "closed"]) {
      const clock = vi.spyOn(performance, "now").mockReturnValue(0),
        f = await fixture(),
        preview = await f.controller.preview();
      let choose!: (value: Electron.SaveDialogReturnValue) => void;
      vi.mocked(dialog.showSaveDialog).mockImplementation(
        () =>
          new Promise((resolve) => {
            choose = resolve;
          }),
      );
      const exported = f.controller.export(preview.token),
        rejected = expect(exported).rejects.toThrow("TOKEN_EXPIRED");
      if (failure === "identity") f.replace();
      if (failure === "generation") f.controller.invalidate();
      if (failure === "expiry") clock.mockReturnValue(60000);
      if (failure === "closed")
        vi.spyOn(f.owner()!, "isDestroyed").mockReturnValue(true);
      choose({ canceled: false, filePath: join(f.root, "never-written.json") });
      await rejected;
      await expect(
        readFile(join(f.root, "never-written.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      clock.mockRestore();
    }
  });
  it("bounds sequential and simultaneous previews and invalidates a pending log read", async () => {
    const f = await fixture();
    for (let i = 0; i < 4; i++) await f.controller.preview();
    await expect(f.controller.preview()).rejects.toThrow("REQUEST_BUSY");
    let release!: (rows: never[]) => void;
    const read = new Promise<never[]>((resolve) => {
        release = resolve;
      }),
      log = {
        unavailable: false,
        recent: () => read,
      } as unknown as DiagnosticLog,
      g = await fixture(log),
      pending = Array.from({ length: 5 }, () => g.controller.preview());
    release([]);
    const results = await Promise.allSettled(pending);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(4);
    expect(results.filter((row) => row.status === "rejected")).toHaveLength(1);
    const h = await fixture(log),
      old = h.controller.preview(),
      rejected = expect(old).rejects.toThrow("TOKEN_EXPIRED");
    h.controller.invalidate();
    await rejected;
  });
  it("reports unavailable logging without raw errors and rejects nonallowlisted metadata or excessive document size", async () => {
    const log = {
        unavailable: true,
        recent: async () => {
          throw new Error("/PRIVATE_SENTINEL");
        },
      } as unknown as DiagnosticLog,
      f = await fixture(log),
      preview = await f.controller.preview();
    expect(JSON.parse(preview.json)).toMatchObject({
      logsAvailable: false,
      logs: [],
    });
    expect(preview.json).not.toContain("PRIVATE_SENTINEL");
    const broken = new DiagnosticsController(
      null,
      () => ({ ...metadata, host: "private-sentinel" }) as never,
      f.owner,
      new NativeDialogGate(),
    );
    await expect(broken.preview()).rejects.toThrow();
    const huge = {
        unavailable: false,
        recent: async () =>
          Array.from({ length: 1000 }, () => ({
            time: new Date().toISOString(),
            appVersion: "0.1.0",
            to: "connected",
          })),
      } as unknown as DiagnosticLog,
      g = await fixture(huge);
    await expect(g.controller.preview()).rejects.toThrow("INTERNAL_ERROR");
  });
});
