import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { LocalTransferFiles } from "../../src/worker/transfers/local";
import {
  inspectLocalDirectory,
  inspectLocalFile,
  localDownloadName,
  supportedLocalPath,
} from "../../src/platform/local-files/selection";
import { TransferScope } from "../../src/worker/transfers/scope";
import { transferReceipt } from "../fixtures/transfers";
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
const owned: string[] = [],
  scopes: TransferScope[] = [],
  handles: LocalTransferFiles[] = [];
afterEach(async () => {
  vi.mocked(open).mockReset();
  for (const scope of scopes.splice(0)) await scope.shutdown();
  for (const files of handles.splice(0)) await files.shutdown();
  for (const root of owned.splice(0)) await rm(root, { recursive: true });
});
async function fixture(direction: "upload" | "download" = "download") {
  await mkdir(resolve(".local/tmp"), { recursive: true });
  const root = await mkdtemp(resolve(".local/tmp/local-ports-"));
  owned.push(root);
  await mkdir(join(root, "selected"));
  const directory = await inspectLocalDirectory(join(root, "selected")),
    initial = transferReceipt(direction, 3),
    row = {
      ...initial,
      localParent: directory.path,
      source:
        direction === "upload"
          ? join(directory.path, "source")
          : "/remote/source",
      destination:
        direction === "download"
          ? join(directory.path, "final")
          : "/remote/final",
      tempPath:
        direction === "download"
          ? join(directory.path, `.sshos-${initial.taskId}.part`)
          : `/remote/.sshos-${initial.taskId}.part`,
    };
  const scope = new TransferScope(
    new AbortController().signal,
    () => {},
    () => {},
  );
  scopes.push(scope);
  const files = new LocalTransferFiles(row, directory, scope);
  handles.push(files);
  return { root, directory, row, scope, files };
}
describe("canonical local transfer authority", () => {
  it("maps denied readback to verification-specific failure and preserves other native failures", async () => {
    const f = await fixture(),
      writer = await f.files.createTemp();
    await writer.write(Buffer.from("abc"), 0, 3, 0);
    await f.files.finishWrite();
    vi.mocked(open).mockRejectedValueOnce(
      Object.assign(new Error("private local path"), { code: "EACCES" }),
    );
    await expect(f.files.openVerification()).rejects.toThrow(
      "VERIFY_READ_DENIED",
    );
    vi.mocked(open).mockRejectedValueOnce(
      Object.assign(new Error("private local path"), { code: "EIO" }),
    );
    await expect(f.files.openVerification()).rejects.toThrow("INTERNAL_ERROR");
    expect(await readFile(f.row.tempPath, "utf8")).toBe("abc");
  });
  it("refuses relative/NUL/share paths and unsafe Windows names before filesystem access", async () => {
    for (const path of [
      "relative",
      "//network/share",
      "\\\\server\\share",
      "/a\0b",
    ]) {
      expect(supportedLocalPath(path)).toBe(false);
      await expect(inspectLocalDirectory(path)).rejects.toThrow(
        "PATH_UNSUPPORTED",
      );
      await expect(inspectLocalFile(path)).rejects.toThrow("PATH_UNSUPPORTED");
    }
    for (const name of ["..", ".", "a/b", "LPT1.txt", "file."])
      expect(localDownloadName(name, "win32")).toBe(false);
  });
  it("rejects changed parent, outside source/destination and noncanonical temporary filenames", async () => {
    const f = await fixture();
    for (const row of [
      { ...f.row, localParent: f.root },
      { ...f.row, destination: join(f.root, "outside") },
      { ...f.row, tempPath: join(f.directory.path, "wrong.part") },
      { ...f.row, tempPath: join(f.root, `.sshos-${f.row.taskId}.part`) },
      { ...f.row, destination: f.row.tempPath },
    ])
      expect(() => new LocalTransferFiles(row, f.directory, f.scope)).toThrow(
        "PATH_UNSUPPORTED",
      );
    expect(
      () =>
        new LocalTransferFiles(
          f.row,
          { ...f.directory, path: f.directory.path + "/" },
          f.scope,
        ),
    ).toThrow("PATH_UNSUPPORTED");
  });
  it("refuses a selected directory after it is replaced or becomes a symlink", async () => {
    const f = await fixture(),
      old = f.directory.path + ".old";
    await rename(f.directory.path, old);
    await mkdir(f.directory.path);
    await expect(f.files.verifyParent()).rejects.toThrow("PATH_UNSUPPORTED");
    await rm(f.directory.path, { recursive: true });
    await symlink(old, f.directory.path);
    await expect(f.files.verifyParent()).rejects.toThrow("PATH_UNSUPPORTED");
  });
  it("preserves any existing destination and maps missing native sources without exposing paths", async () => {
    const f = await fixture();
    await f.files.absentDestination();
    await writeFile(f.row.destination, "existing");
    await expect(f.files.absentDestination()).rejects.toThrow("NAME_CONFLICT");
    expect(await readFile(f.row.destination, "utf8")).toBe("existing");
    await expect(inspectLocalFile(join(f.root, "missing"))).rejects.toThrow(
      "PATH_UNSUPPORTED",
    );
  });
  it("requires a created temp handle, then binds verification and finalization to the exact inode", async () => {
    const f = await fixture();
    await expect(f.files.finishWrite()).rejects.toThrow("INTERNAL_ERROR");
    await writeFile(f.row.tempPath, "other");
    await expect(f.files.tempStat()).rejects.toThrow("PATH_UNSUPPORTED");
    await rm(f.row.tempPath);
    const writer = await f.files.createTemp();
    await writer.write(Buffer.from("abc"), 0, 3, 0);
    await f.files.finishWrite();
    await rename(f.row.tempPath, f.row.tempPath + ".old");
    await writeFile(f.row.tempPath, "changed");
    await expect(f.files.openVerification()).rejects.toThrow(
      "PATH_UNSUPPORTED",
    );
    await expect(f.files.removeTemp()).rejects.toThrow("PATH_UNSUPPORTED");
    expect(await readFile(f.row.tempPath, "utf8")).toBe("changed");
  });
  it("reads the selected source through one bounded handle and makes close idempotent", async () => {
    const f = await fixture("upload");
    await writeFile(f.row.source, "abc");
    const source = await f.files.openSource(),
      bytes = Buffer.alloc(3);
    expect(await source.read(bytes, 0, 3, 0)).toBe(3);
    expect(bytes.toString()).toBe("abc");
    expect(await source.stat()).toMatchObject({ size: 3 });
    await source.close();
    await source.close();
  });
  it("confirms final inode and byte size independently from link completion", async () => {
    const f = await fixture(),
      writer = await f.files.createTemp();
    await writer.write(Buffer.from("ab"), 0, 2, 0);
    await f.files.finishWrite();
    await f.files.linkDestination();
    await expect(f.files.confirmDestination()).rejects.toThrow(
      "VERIFY_MISMATCH",
    );
    await f.files.removeTemp();
    expect(await readFile(f.row.destination, "utf8")).toBe("ab");
    await f.files.shutdown();
    await f.files.shutdown();
  });
  it("refuses directory/symlink sources and exclusive temp collisions", async () => {
    const f = await fixture("upload");
    await mkdir(f.row.source);
    await expect(f.files.openSource()).rejects.toThrow("PATH_UNSUPPORTED");
    await rm(f.row.source, { recursive: true });
    const other = join(f.directory.path, "other");
    await writeFile(other, "abc");
    await symlink(other, f.row.source);
    await expect(f.files.openSource()).rejects.toThrow("PATH_UNSUPPORTED");
    const g = await fixture();
    await writeFile(g.row.tempPath, "preserved");
    await expect(g.files.createTemp()).rejects.toThrow("NAME_CONFLICT");
    expect(await readFile(g.row.tempPath, "utf8")).toBe("preserved");
  });
});
