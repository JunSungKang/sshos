import { createRequire } from "node:module";
import { resolve } from "node:path";
import * as fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const {
  listCommand,
  propertiesCommand,
  directoryCommand,
  OS_COMMAND,
  START_COMMAND,
  quotePath,
} = require("../../dist/worker/remote-files/metadata/ubuntu-commands.js");
// Test adapter only. Decode a tiny shell quoting grammar, then match the entire
// command against production templates. Never execute received commands locally.
function words(command) {
  const out = [];
  let word = "",
    quoted = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'") {
      quoted = !quoted;
      continue;
    }
    if (c === "\\" && !quoted) {
      word += command[++i] ?? "";
      continue;
    }
    if (/\s/u.test(c) && !quoted) {
      if (word) {
        out.push(word);
        word = "";
      }
    } else word += c;
  }
  if (quoted) throw Error("Unclosed fixture quote");
  if (word) out.push(word);
  return out;
}
const exists = async (path) => {
  try {
    await fs.lstat(path);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
};
export function metadataCommand(command, resolveRemote, options, metrics) {
  const paths = words(command).filter((word) => word.startsWith("/"));
  const statBytes = (stat) =>
    [
      stat.mode.toString(16),
      stat.size,
      Math.floor(stat.mtimeMs / 1000),
      stat.uid,
      stat.gid,
      stat.ino,
      stat.dev,
      stat.nlink,
    ].join("\0") + "\0";
  const type = (stat) =>
    stat.isSymbolicLink()
      ? "l"
      : stat.isDirectory()
        ? "d"
        : stat.isFile()
          ? "f"
          : "p";
  if (command === OS_COMMAND)
    return async () => {
      if (options.denyRead?.("/etc/os-release")) throw Error("Denied");
      return Buffer.from(await fs.readFile(resolveRemote("/etc/os-release")));
    };
  if (command === START_COMMAND)
    return async () => Buffer.from("/home/fixture\0");
  for (const path of paths) {
    const local = resolveRemote(path);
    if (command === directoryCommand(path))
      return async () => {
        const st = await fs.lstat(local);
        if (!st.isDirectory() || st.isSymbolicLink())
          throw Error("Not directory");
        if ((await fs.realpath(local)) !== local)
          throw Error("Changed directory");
        return Buffer.from(path + "\0");
      };
    if (command === propertiesCommand(path))
      return async () => Buffer.from(statBytes(await fs.lstat(local)));
    if (command === listCommand(path))
      return async () => {
        const st = await fs.lstat(local);
        if (
          !st.isDirectory() ||
          st.isSymbolicLink() ||
          (await fs.realpath(local)) !== local
        )
          throw Error("Changed directory");
        const output = [path];
        for (const name of await fs.readdir(local)) {
          const stat = await fs.lstat(resolve(local, name));
          output.push(
            name,
            type(stat),
            String(stat.size),
            (stat.mtimeMs / 1000).toFixed(9),
            (stat.mode & 0o7777).toString(8),
            String(stat.uid),
            String(stat.gid),
          );
        }
        return Buffer.from(output.join("\0") + "\0");
      };
    const q = quotePath(path);
    if (command === `test ! -e ${q} && test ! -L ${q}`)
      return async () => {
        if (await exists(local)) throw Error("Exists");
        return Buffer.alloc(0);
      };
    if (
      command ===
      `/usr/bin/rm -rf --one-file-system --preserve-root=all -- ${q}`
    )
      return async () => {
        metrics.mutations.push({ operation: "recursive-delete", path });
        await options.beforeDelete?.({ path });
        await fs.rm(local, { recursive: true, force: true });
        return Buffer.alloc(0);
      };
    if (command === `/usr/bin/mkdir -m 0700 -- ${q}`)
      return async () => {
        metrics.mutations.push({ operation: "mkdir", path });
        await fs.mkdir(local, { mode: 0o700 });
        return Buffer.alloc(0);
      };
  }
  if (paths.length === 3 && paths[0] === "/usr/bin/mv") {
    const [source, destination] = paths.slice(1);
    if (
      command ===
      `/usr/bin/mv -nT --no-copy -- ${quotePath(source)} ${quotePath(destination)}`
    )
      return async () => {
        await options.beforeRename?.({ source, destination });
        if (await exists(resolveRemote(destination))) return Buffer.alloc(0);
        const st = await fs.lstat(resolveRemote(source));
        if (st.isFile()) {
          await fs.link(resolveRemote(source), resolveRemote(destination));
          await fs.unlink(resolveRemote(source));
        } else
          await fs.rename(resolveRemote(source), resolveRemote(destination));
        metrics.mutations.push({ operation: "rename", source, destination });
        return Buffer.alloc(0);
      };
  }
  return null;
}
