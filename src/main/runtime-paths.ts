import { existsSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

type PathApplication = {
  isPackaged: boolean;
  getPath(name: "userData"): string;
  setPath(name: "userData" | "sessionData" | "crashDumps", value: string): void;
  setAppLogsPath(value: string): void;
};
function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    Boolean(rel) &&
    !isAbsolute(rel) &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`)
  );
}

/** Run before app.ready/defaultSession. Packaged apps retain OS-default userData;
 * development must supply an explicitly workspace-contained runtime root. */
export async function configureRuntimePaths(
  app: PathApplication,
  developmentRoot: string,
  requested: string | undefined,
): Promise<void> {
  let root: string | null = null;
  if (!app.isPackaged) {
    if (!requested) throw new Error("Development runtime root is required");
    root = await realpath(developmentRoot);
  }
  const dir = resolve(app.isPackaged ? app.getPath("userData") : requested!);
  if (root) {
    if (!within(root, dir)) throw new Error("Runtime path outside workspace");
    let ancestor = dir;
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    if (ancestor !== root && !within(root, await realpath(ancestor)))
      throw new Error("Runtime parent symlink outside workspace");
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const actual = await realpath(dir);
  if (root && !within(root, actual))
    throw new Error("Runtime symlink outside workspace");
  const children: Record<string, string> = {};
  for (const name of ["runtime", "crashes", "logs"]) {
    const target = resolve(actual, name);
    if (existsSync(target) && !within(actual, await realpath(target)))
      throw new Error("Runtime child symlink outside userData");
    await mkdir(target, { recursive: true, mode: 0o700 });
    children[name] = target;
  }
  app.setPath("userData", actual);
  app.setPath("sessionData", children["runtime"]!);
  app.setPath("crashDumps", children["crashes"]!);
  app.setAppLogsPath(children["logs"]!);
}
