import { afterEach, describe, expect, it, vi } from "vitest";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { configureRuntimePaths } from "../../src/main/runtime-paths";
const owned: string[] = [];
afterEach(async () => {
  for (const path of owned.splice(0)) await rm(path, { recursive: true });
});
async function fixture() {
  await mkdir(resolve(".local/tmp"), { recursive: true });
  const root = await mkdtemp(resolve(".local/tmp/runtime-paths-"));
  owned.push(root);
  const workspace = join(root, "workspace"),
    external = join(root, "external");
  await mkdir(workspace);
  await mkdir(external);
  const app = {
    isPackaged: false,
    getPath: vi.fn(() => join(external, "os-userData")),
    setPath: vi.fn(),
    setAppLogsPath: vi.fn(),
  };
  return { root, workspace, external, app };
}
describe("application data and cache paths before ready", () => {
  it("applies runtime/cache/crash/log separation to packaged apps using their OS default data root", async () => {
    const f = await fixture();
    f.app.isPackaged = true;
    await configureRuntimePaths(
      f.app,
      f.workspace,
      join(f.workspace, "ignored"),
    );
    const actual = await realpath(join(f.external, "os-userData"));
    expect(f.app.getPath).toHaveBeenCalledExactlyOnceWith("userData");
    expect(f.app.setPath.mock.calls).toEqual([
      ["userData", actual],
      ["sessionData", join(actual, "runtime")],
      ["crashDumps", join(actual, "crashes")],
    ]);
    expect(f.app.setAppLogsPath).toHaveBeenCalledExactlyOnceWith(
      join(actual, "logs"),
    );
    await expect(access(join(f.workspace, "ignored"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("keeps development entirely inside its explicit workspace root and reuses existing subdirectories", async () => {
    const f = await fixture(),
      requested = join(f.workspace, "nested", "app");
    await configureRuntimePaths(f.app, f.workspace, requested);
    await configureRuntimePaths(f.app, f.workspace, requested);
    expect(f.app.getPath).not.toHaveBeenCalled();
    for (const name of ["runtime", "crashes", "logs"])
      await expect(access(join(requested, name))).resolves.toBeUndefined();
  });
  it("refuses missing, equal-root and lexical escape development paths before creating anything", async () => {
    const f = await fixture();
    await expect(
      configureRuntimePaths(f.app, f.workspace, undefined),
    ).rejects.toThrow("Development runtime root is required");
    for (const path of [
      f.workspace,
      join(f.external, "new"),
      join(f.workspace, "..", "escape"),
    ])
      await expect(
        configureRuntimePaths(f.app, f.workspace, path),
      ).rejects.toThrow("Runtime path outside workspace");
    expect(f.app.setPath).not.toHaveBeenCalled();
    await expect(access(join(f.external, "new"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("refuses a parent symlink escape before recursively creating a data directory", async () => {
    const f = await fixture(),
      alias = join(f.workspace, "alias");
    await symlink(f.external, alias);
    await expect(
      configureRuntimePaths(f.app, f.workspace, join(alias, "new")),
    ).rejects.toThrow("Runtime parent symlink outside workspace");
    await expect(access(join(f.external, "new"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("refuses a data root symlink that resolves back to the workspace root", async () => {
    const f = await fixture(),
      alias = join(f.workspace, "alias");
    await symlink(f.workspace, alias);
    await expect(
      configureRuntimePaths(f.app, f.workspace, alias),
    ).rejects.toThrow("Runtime parent symlink outside workspace");
    expect(f.app.setPath).not.toHaveBeenCalled();
  });
  it.each(["runtime", "logs", "crashes"])(
    "refuses an escaping %s subdirectory for either build kind",
    async (name) => {
      for (const packaged of [false, true]) {
        const f = await fixture();
        f.app.isPackaged = packaged;
        const data = packaged ? f.app.getPath() : join(f.workspace, "app");
        await mkdir(data);
        await symlink(f.external, join(data, name));
        await expect(
          configureRuntimePaths(f.app, f.workspace, data),
        ).rejects.toThrow("Runtime child symlink outside userData");
        expect(f.app.setPath).not.toHaveBeenCalled();
      }
    },
  );
});
