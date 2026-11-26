import { describe, expect, it, vi } from "vitest";
import type { SFTPWrapper } from "ssh2";
import { TransferIOFailure } from "../../src/shared/file-policies/transfer-failure";
import { remoteCapacity } from "../../src/worker/transfers/remote-capacity";
import { SFTPTransferPorts } from "../../src/worker/transfers/ports";
import { inspectLocalDirectory } from "../../src/platform/local-files/selection";
import type { SessionManager } from "../../src/worker/connections/session-manager";
import { resolve, join } from "node:path";
import { transferReceipt } from "../fixtures/transfers";

const extensions = { "hardlink@openssh.com": "1", "statvfs@openssh.com": "2" };
const unknown = { capacity: "unknown", availableBytes: null };
function measure(
  value: unknown,
  size = 1,
  advertised: Record<string, string> | null = extensions,
) {
  const stat = vi.fn((_path: string, cb: Function) =>
    value instanceof Error ? cb(value) : cb(null, value),
  );
  const sftp = {
    ext_openssh_statvfs: stat,
    ...(advertised ? { _extensions: advertised } : {}),
  } as unknown as SFTPWrapper;
  return remoteCapacity(
    sftp,
    "/directory",
    size,
    (request) =>
      new Promise((resolve, reject) =>
        request((err, result) => (err ? reject(err) : resolve(result))),
      ),
  );
}
describe("relay destination capacity and publication support", () => {
  it("preserves negotiated hardlink and statvfs capability boundaries", async () => {
    await expect(measure({}, 0, {})).rejects.toThrow("HARDLINK_UNSUPPORTED");
    await expect(measure({}, 0, null)).resolves.toEqual(unknown);
    await expect(
      measure({}, 0, { "hardlink@openssh.com": "1" }),
    ).resolves.toEqual(unknown);
    const request = vi.fn();
    await expect(
      remoteCapacity(
        { _extensions: extensions } as unknown as SFTPWrapper,
        "/",
        1,
        request,
      ),
    ).resolves.toEqual(unknown);
    expect(request).not.toHaveBeenCalled();
  });
  it("blocks read-only volumes and proven inode/byte exhaustion including an empty file", async () => {
    await expect(measure({ f_flag: 3n }, 0)).resolves.toMatchObject({
      availableBytes: null,
      errorCode: "PERMISSION_DENIED",
    });
    await expect(
      measure({ f_files: 8, f_favail: 0 }, 0),
    ).resolves.toMatchObject({
      availableBytes: null,
      errorCode: "REMOTE_DISK_FULL",
    });
    await expect(
      measure({ f_bavail: 0, f_frsize: 512 }, 1),
    ).resolves.toMatchObject({
      availableBytes: "0",
      errorCode: "REMOTE_DISK_FULL",
    });
    await expect(
      measure({ f_bavail: 9, f_frsize: 512, f_flag: 1 }, 1),
    ).resolves.toMatchObject({
      availableBytes: "4608",
      errorCode: "PERMISSION_DENIED",
    });
    await expect(
      measure({ f_files: 0, f_favail: 0, f_bavail: 0, f_frsize: 512 }, 0),
    ).resolves.toEqual({ capacity: "known", availableBytes: "0" });
  });
  it("retains exact large measurements and labels malformed/unsafe numbers unknown", async () => {
    const blocks = 2n ** 63n;
    await expect(
      measure({ f_bavail: blocks, f_frsize: 4096n, f_files: 3, f_favail: 1 }),
    ).resolves.toEqual({
      capacity: "known",
      availableBytes: String(blocks * 4096n),
    });
    for (const value of [
      null,
      17,
      { f_bavail: 2 ** 53, f_frsize: 1 },
      { f_bavail: -1n, f_frsize: 1 },
      { f_bavail: 1, f_frsize: 0 },
      { f_bavail: 1, f_frsize: 1.5 },
      { f_bavail: "12", f_frsize: 2 },
    ])
      await expect(measure(value)).resolves.toEqual(unknown);
  });
  it("treats unsupported or withheld measurements as unknown and propagates broken transport", async () => {
    for (const code of [3, 4, 8]) {
      await expect(
        measure(Object.assign(Error("protocol failure"), { code })),
      ).resolves.toEqual(unknown);
      await expect(
        measure(new TransferIOFailure("INTERNAL_ERROR", false, code)),
      ).resolves.toEqual(unknown);
    }
    await expect(measure(Error("CONNECTION_LOST"))).rejects.toThrow(
      "CONNECTION_LOST",
    );
  });
  it("blocks B upload preparation at the fresh capacity check before trying to read its staged local source", async () => {
    const directory = await inspectLocalDirectory(resolve(".local/tmp"));
    const row = {
      ...transferReceipt("upload"),
      relayParentId: crypto.randomUUID(),
      localParent: directory.path,
      source: join(directory.path, crypto.randomUUID()),
    };
    const remoteOpen = vi.fn(),
      statvfs = vi.fn((_path: string, done: Function) =>
        done(null, { f_bavail: 0, f_frsize: 512 }),
      );
    const sftp = {
      _extensions: extensions,
      ext_openssh_statvfs: statvfs,
      open: remoteOpen,
      lstat: (path: string, done: Function) =>
        path === row.remoteParent
          ? done(null, { isDirectory: () => true, isSymbolicLink: () => false })
          : done(Object.assign(Error(), { code: 2 })),
      realpath: (path: string, done: Function) => done(null, path),
    };
    const leaseClosed = Promise.withResolvers<void>();
    const sessions = {
      control: () => ({ check() {} }),
      auxiliary: () => ({
        ready: Promise.resolve({ sftp: (done: Function) => done(null, sftp) }),
        closed: leaseClosed.promise,
        close: () => leaseClosed.resolve(),
      }),
    } as unknown as SessionManager;
    const abort = new AbortController(),
      ports = new SFTPTransferPorts(
        row,
        directory,
        sessions,
        abort.signal,
        () => {},
      );
    try {
      await expect(ports.prepare()).rejects.toThrow("REMOTE_DISK_FULL");
      expect(statvfs).toHaveBeenCalledOnce();
      expect(remoteOpen).not.toHaveBeenCalled();
    } finally {
      abort.abort();
    }
  });
});
