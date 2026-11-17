import { describe, it, expect, vi } from "vitest";
import type { SFTPWrapper, Stats } from "ssh2";
import {
  controlCall,
  fileType,
  verifyDirectory,
} from "../../src/worker/remote-files/sftp-control";
const stat = (kind: string): Stats => ({
  mode: kind === "directory" ? 0o40700 : kind === "file" ? 0o100600 : 0o120777,
  size: 1,
  atime: 0,
  mtime: 1,
  uid: 0,
  gid: 0,
  isDirectory: () => kind === "directory",
  isFile: () => kind === "file",
  isSymbolicLink: () => kind === "symlink",
  isFIFO: () => false,
  isSocket: () => false,
  isBlockDevice: () => false,
  isCharacterDevice: () => false,
});
function fixture(names: [string, string][]) {
  let offset = 0;
  let closed = 0;
  let stopped = false;
  const sftp = {
    lstat: (_path: string, done: Function) => done(null, stat("directory")),
    realpath: (path: string, done: Function) => done(null, path),
    opendir: (_path: string, done: Function) => {
      offset = 0;
      done(null, Buffer.from("handle"));
    },
    readdir: (_handle: Buffer, done: Function) => {
      const batch = names
        .slice(offset, offset + 128)
        .map(([filename, kind]) => ({ filename, attrs: stat(kind) }));
      offset += batch.length;
      if (batch.length) done(null, batch);
      else done(Object.assign(new Error("EOF"), { code: 1 }));
    },
    close: (_handle: Buffer, done: Function) => {
      closed++;
      done(null);
    },
  } as unknown as SFTPWrapper;
  return {
    control: {
      sftp,
      check: () => {
        if (stopped) throw new Error("CONNECTION_LOST");
      },
      quarantine: () => {
        stopped = true;
      },
    },
    get closed() {
      return closed;
    },
  };
}
describe("SFTP integrity control used by content and transfers", () => {
  it("classifies special files without granting regular file operations", () => {
    for (const method of [
      "isFIFO",
      "isSocket",
      "isBlockDevice",
      "isCharacterDevice",
    ] as const)
      expect(fileType({ ...stat("unknown"), [method]: () => true })).toBe(
        "special",
      );
    expect(fileType(stat("unknown"))).toBe("unknown");
  });
  it("rejects changed/non-directory/symlink parents before listing", async () => {
    for (const kind of ["file", "symlink"]) {
      const f = fixture([]);
      f.control.sftp.lstat = (_path, done) => {
        done(undefined, stat(kind));
      };
      await expect(verifyDirectory(f.control, "/home")).rejects.toThrow(
        "PATH_UNSUPPORTED",
      );
    }
    const f = fixture([]);
    f.control.sftp.realpath = (_path, done) => {
      done(undefined, "/other");
    };
    await expect(verifyDirectory(f.control, "/home")).rejects.toThrow(
      "PATH_CHANGED",
    );
  });
  it("maps only SFTP status codes, rejects synchronous failures and ignores duplicate callbacks", async () => {
    const f = fixture([]);
    for (const code of [3, 4])
      await expect(
        controlCall(f.control, (done) =>
          done(Object.assign(new Error("AUTH_FAILED"), { code }), undefined),
        ),
      ).rejects.toThrow(code === 3 ? "PERMISSION_DENIED" : "INTERNAL_ERROR");
    await expect(
      controlCall(f.control, () => {
        throw new Error("local failure");
      }),
    ).rejects.toThrow("local failure");
    expect(
      await controlCall(f.control, (done) => {
        done(null, "first");
        done(null, "late");
      }),
    ).toBe("first");
  });
  it("rejects a callback when control authority was revoked after request dispatch", async () => {
    const f = fixture([]);
    let callback!: Function;
    const pending = controlCall(f.control, (done) => {
      callback = done;
    });
    f.control.quarantine();
    callback(null, "late");
    await expect(pending).rejects.toThrow("CONNECTION_LOST");
  });
  it("quarantines stalled IO and ignores late callbacks", async () => {
    vi.useFakeTimers();
    const quarantine = vi.fn();
    let cb!: Function;
    const pending = controlCall(
      { sftp: {} as SFTPWrapper, check() {}, quarantine },
      (done) => {
        cb = done;
      },
      15,
    );
    const rejected = expect(pending).rejects.toThrow("IO_TIMEOUT");
    await vi.advanceTimersByTimeAsync(16);
    await rejected;
    cb(null, "late");
    expect(quarantine).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
