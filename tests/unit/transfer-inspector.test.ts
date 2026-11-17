import { describe, expect, it } from "vitest";
import type { SFTPWrapper, Stats } from "ssh2";
import { TransferInspector } from "../../src/worker/transfers/inspect";
const stat = (kind: "file" | "directory" | "symlink", size = 3): Stats =>
  ({
    size,
    mtime: 1,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  }) as Stats;
function fixture(result: Stats | number) {
  let calls = 0;
  const control = {
    sftp: {
      lstat: (path: string, done: Function) => {
        calls++;
        if (path === "/home") done(null, stat("directory"));
        else
          typeof result === "number"
            ? done(
                Object.assign(new Error("untrusted remote text"), {
                  code: result,
                }),
              )
            : done(null, result);
      },
      realpath: (path: string, done: Function) => done(null, path),
    } as unknown as SFTPWrapper,
    check: () => {},
    quarantine: () => {},
  };
  return {
    inspector: new TransferInspector(() => control),
    calls: () => calls,
  };
}
describe("readonly transfer target inspection", () => {
  it("permits a missing upload destination and refuses existing destinations or absent download sources", async () => {
    const missing = fixture(2);
    await expect(
      missing.inspector.inspect("s", 1, "upload", "/home/file", "/home"),
    ).resolves.toBeNull();
    await expect(
      missing.inspector.inspect("s", 1, "download", "/home/file", "/home"),
    ).rejects.toThrow("PATH_UNSUPPORTED");
    const exists = fixture(stat("file"));
    await expect(
      exists.inspector.inspect("s", 1, "upload", "/home/file", "/home"),
    ).rejects.toThrow("NAME_CONFLICT");
    await expect(
      exists.inspector.inspect("s", 1, "download", "/home/file", "/home"),
    ).resolves.toEqual({ size: 3, mtime: "1", identity: "" });
  });
  it("rejects wrong parent/root/unsafe path and nonregular or oversized download sources", async () => {
    for (const path of ["/", "/other/file", "/home/../file"]) {
      const f = fixture(stat("file"));
      await expect(
        f.inspector.inspect("s", 1, "download", path, "/home"),
      ).rejects.toThrow();
      expect(f.calls()).toBe(0);
    }
    for (const kind of ["directory", "symlink"] as const)
      await expect(
        fixture(stat(kind)).inspector.inspect(
          "s",
          1,
          "download",
          "/home/file",
          "/home",
        ),
      ).rejects.toThrow("PATH_UNSUPPORTED");
    await expect(
      fixture(stat("file", 64 * 1024 ** 3 + 1)).inspector.inspect(
        "s",
        1,
        "download",
        "/home/file",
        "/home",
      ),
    ).rejects.toThrow("FILE_LIMIT");
  });
  it("preserves a known permission code and never turns an unknown SFTP failure into a guessed cause", async () => {
    await expect(
      fixture(3).inspector.inspect("s", 1, "upload", "/home/file", "/home"),
    ).rejects.toThrow("PERMISSION_DENIED");
    await expect(
      fixture(4).inspector.inspect("s", 1, "upload", "/home/file", "/home"),
    ).rejects.toThrow("INTERNAL_ERROR");
  });
});
