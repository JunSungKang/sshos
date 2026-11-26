import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RelayDiskLedger,
  RelayStageCreationError,
  RelayStaging,
} from "../../src/platform/local-files/relay-staging";
import {
  identity,
  inspectLocalDirectory,
} from "../../src/platform/local-files/selection";
import { transferFailure } from "../../src/shared/file-policies/transfer-failure";
import { presentError } from "../../src/shared/error-presentation";

const directories: string[] = [];
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    link: vi.fn(fs.link),
    unlink: vi.fn(fs.unlink),
    mkdir: vi.fn(fs.mkdir),
  };
});
vi.mock("node:child_process", async (original) => {
  const cp = await original<typeof import("node:child_process")>();
  return { ...cp, execFile: vi.fn(cp.execFile) };
});
vi.mock("../../src/platform/local-files/selection", async (original) => {
  const selection =
    await original<typeof import("../../src/platform/local-files/selection")>();
  return {
    ...selection,
    inspectLocalDirectory: vi.fn(selection.inspectLocalDirectory),
  };
});
async function fixture() {
  const root = resolve(".local/tmp");
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, "relay-staging-"));
  directories.push(folder);
  return { folder, service: new RelayStaging(folder), id: randomUUID() };
}
afterEach(async () => {
  vi.mocked(link).mockReset();
  vi.mocked(unlink).mockReset();
  vi.mocked(mkdir).mockReset();
  vi.mocked(execFile).mockReset();
  vi.mocked(inspectLocalDirectory).mockReset();
  vi.unstubAllEnvs();
  for (const folder of directories.splice(0))
    await rm(folder, { recursive: true, force: true });
});
const dir = { path: "/stage", identity: "dir" };

describe("relay disk admission", () => {
  it("accepts an ordinary download on a volume without a capacity probe and accounts for it later", async () => {
    const measure = vi.fn().mockRejectedValue(new Error("LOCAL_SPACE_UNKNOWN"));
    const ledger = new RelayDiskLedger(measure);
    await ledger.reserveOrdinary(
      "regular",
      { path: "/download", identity: "3:100" },
      50,
    );
    expect(measure).not.toHaveBeenCalled();
    measure.mockResolvedValue({ volumeId: "3", free: 100n });
    expect(
      await ledger.preview({ path: "/other", identity: "3:101" }, 50),
    ).toMatchObject({ effectiveBytes: "50", shortfallBytes: 5 });
  });
  it("compares integer bytes and includes the exact 10% margin", async () => {
    let free = 1_100_000_000n;
    const ledger = new RelayDiskLedger(async () => ({ free, volumeId: "7" }));
    for (const [size, required] of [
      [0, 0],
      [11, 13],
      [1_000_000_000, 1_100_000_000],
      [2 ** 30, 1_181_116_007],
    ] as const)
      expect(await ledger.preview(dir, size)).toMatchObject({
        requiredBytes: required,
      });
    expect(await ledger.preview(dir, 1e9)).toMatchObject({ shortfallBytes: 0 });
    free--;
    expect(await ledger.preview(dir, 1e9)).toMatchObject({ shortfallBytes: 1 });
    await expect(ledger.reserveRelay("job", dir, 1e9, "7")).rejects.toThrow(
      "LOCAL_DISK_FULL",
    );
    free = 1n << 70n;
    expect((await ledger.preview(dir, 1)).osFreeBytes).toBe(free.toString());
    await expect(ledger.preview(dir, -1)).rejects.toThrow("FILE_LIMIT");
    free = -1n;
    await expect(ledger.preview(dir, 1)).rejects.toThrow("LOCAL_SPACE_UNKNOWN");
  });

  it("serializes conflicting claims, including ordinary downloads by volume, without reserving progress", async () => {
    let free = 200n;
    const ledger = new RelayDiskLedger(async (d) => ({
      free,
      volumeId: d.identity,
    }));
    const first = { identity: "1", path: "/a" },
      alias = { identity: "1", path: "/a-alias" },
      second = { identity: "2", path: "/b" };
    const results = await Promise.allSettled([
      ledger.reserveRelay("r", first, 100, "1"),
      ledger.reserveOrdinary("d", alias, 100),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect((await ledger.preview(second, 100)).effectiveBytes).toBe("200");
    await expect(ledger.reserveOrdinary("r", first, 1)).rejects.toThrow(
      "REQUEST_BUSY",
    );
    await expect(ledger.reserveRelay("bad", second, 0, "1")).rejects.toThrow(
      "PATH_CHANGED",
    );
    await ledger.recheck("r", first, 100);
    await expect(ledger.recheck("r", second, 100)).rejects.toThrow(
      "PATH_CHANGED",
    );
    await expect(ledger.recheck("r", first, 200)).rejects.toThrow(
      "SOURCE_CHANGED",
    );
    free = 99n;
    await expect(ledger.recheck("r", first, 100)).rejects.toThrow(
      "LOCAL_DISK_FULL",
    );
    await ledger.retained("r", "1", 100);
    expect((await ledger.preview(alias, 0)).effectiveBytes).toBe("89");
    await expect(ledger.retained("r", "2", 100)).rejects.toThrow(
      "PATH_CHANGED",
    );
    await ledger.reserveOrdinary("d", first, 89);
    free = 0n;
    expect(await ledger.preview(first, 10)).toMatchObject({
      effectiveBytes: "0",
      shortfallBytes: 110,
    });
    expect((await ledger.preview(first, 0)).shortfallBytes).toBe(0);
    await ledger.release("d");
    await ledger.release("d");
    await ledger.release("r");
  });
});

describe("owned local relay stage", () => {
  it("reclaims a missing stage root only with the original userData identity and volume", async () => {
    const { folder, service, id } = await fixture();
    const { volumeId } = await service.preview(20);
    const stage = await service.create(id, 20, volumeId);
    const release = vi.spyOn(service.disk, "release");
    await rename(stage.root.path, join(folder, "prior-tree"));
    await expect(
      service.discard({ ...stage, volumeId: "wrong" }, null),
    ).rejects.toThrow("PATH_CHANGED");
    await expect(
      service.discard({ ...stage, baseIdentity: "changed" }, null),
    ).rejects.toThrow("PATH_CHANGED");
    await expect(
      service.discard({ ...stage, baseIdentity: undefined }, null),
    ).rejects.toThrow("PATH_CHANGED");
    expect(release).not.toHaveBeenCalled();
    await mkdir(stage.root.path, { mode: 0o700 });
    await writeFile(join(stage.root.path, "keep"), "unrelated");
    await expect(service.discard(stage, null)).rejects.toThrow("PATH_CHANGED");
    expect(await readFile(join(stage.root.path, "keep"), "utf8")).toBe(
      "unrelated",
    );
    await rename(stage.root.path, join(folder, "replacement"));
    await service.discard(stage, null);
    expect(release).toHaveBeenCalledWith(id);
    expect((await lstat(join(folder, "prior-tree", id))).isDirectory()).toBe(
      true,
    );
  });
  it.skipIf(process.platform !== "darwin")(
    "checks Darwin extended ACLs on the application profile and stage",
    async () => {
      const { folder } = await fixture();
      const userData = join(folder, "Application Support", "sshOS");
      await mkdir(userData, { recursive: true, mode: 0o700 });
      const staging = new RelayStaging(userData),
        stageRoot = join(userData, "relay-staging");
      const acl = (args: string[]) =>
        new Promise<void>((done, fail) =>
          execFile("/bin/chmod", args, { timeout: 3000 }, (error) =>
            error ? fail(error) : done(),
          ),
        );
      await acl(["+a", "group:everyone deny chown", userData]);
      expect((await staging.preview(12)).requiredBytes).toBe(14);
      await acl(["-N", userData]);
      await acl([
        "+a",
        "group:everyone allow readattr,directory_inherit",
        userData,
      ]);
      await expect(staging.preview(12)).rejects.toThrow("PERMISSION_DENIED");
      await mkdir(stageRoot, { mode: 0o700 });
      await acl(["-N", userData]);
      await expect(staging.preview(12)).rejects.toThrow("PERMISSION_DENIED");
      await acl(["-N", stageRoot]);
      expect((await staging.preview(12)).requiredBytes).toBe(14);
      vi.mocked(execFile).mockImplementationOnce((...args: any[]) => {
        args.at(-1)(null, "drwx------+ 1 fixture data path\n", "");
        return {} as never;
      });
      await expect(staging.preview(12)).rejects.toThrow("PERMISSION_DENIED");
      vi.mocked(execFile).mockImplementationOnce((...args: any[]) => {
        args.at(-1)(
          null,
          "drwx------+ 1 fixture data path\n 0: unexpected ACL format\n",
          "",
        );
        return {} as never;
      });
      await expect(staging.preview(12)).rejects.toThrow("PERMISSION_DENIED");
    },
  );
  it("stops before admission on unknown volume, stale job directory or unsupported hardlink", async () => {
    const { service, id, folder } = await fixture();
    const { volumeId } = await service.preview(0);
    vi.mocked(mkdir).mockRejectedValueOnce(
      Object.assign(new Error(), { code: "ENOSPC" }),
    );
    await expect(service.create(id, 0, volumeId)).rejects.toThrow(
      "LOCAL_DISK_FULL",
    );
    vi.mocked(link).mockRejectedValueOnce(
      Object.assign(new Error(), { code: "ENOTSUP" }),
    );
    await expect(service.create(id, 0, volumeId)).rejects.toThrow(
      "HARDLINK_UNSUPPORTED",
    );
    await expect(
      lstat(join(folder, "relay-staging", id)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await mkdir(join(folder, "relay-staging", id), { mode: 0o700 });
    await expect(service.create(id, 0, volumeId)).rejects.toThrow(
      "NAME_CONFLICT",
    );
    expect(await lstat(join(folder, "relay-staging", id))).toBeTruthy();
  });
  it("preserves stage identity on interrupted probe cleanup and never removes unowned files", async () => {
    const { service, folder, id } = await fixture();
    const { volumeId } = await service.preview(0);
    vi.mocked(unlink).mockRejectedValue(
      Object.assign(new Error(), { code: "EACCES" }),
    );
    const failed = await service
      .create(id, 0, volumeId)
      .catch((error: RelayStageCreationError) => error);
    expect(failed).toBeInstanceOf(RelayStageCreationError);
    expect(failed).toMatchObject({
      message: "PERMISSION_DENIED",
      stage: {
        jobId: id,
        probeIdentity: expect.any(String),
        filePath: join(folder, "relay-staging", id, "payload"),
      },
    });
    expect(
      (await lstat(join(folder, "relay-staging", id, "probe-link"))).isFile(),
    ).toBe(true);
    vi.mocked(unlink).mockReset();
    await service.discard((failed as RelayStageCreationError).stage, null);
    await expect(
      lstat(join(folder, "relay-staging", id)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.skipIf(process.platform === "win32")(
    "uses a fixed Windows ACL command and refuses an unavailable ACL check",
    async () => {
      const { service, folder, id } = await fixture();
      const root = join(folder, "relay-staging");
      await mkdir(root, { mode: 0o700 });
      const base = await inspectLocalDirectory(folder);
      const privateRoot = await inspectLocalDirectory(root);
      vi.mocked(inspectLocalDirectory).mockImplementation(async (name) =>
        name === folder ? base : privateRoot,
      );
      const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
      try {
        Object.defineProperty(process, "platform", {
          ...descriptor,
          value: "win32",
        });
        vi.stubEnv("SystemRoot", "");
        await expect(service.preview(1)).rejects.toThrow("PERMISSION_DENIED");
        vi.stubEnv("SystemRoot", "C:\\Windows");
        const aclCall = vi.mocked(execFile);
        for (const [status, code] of [
          [10, "LOCAL_DISK_FULL"],
          [11, "LOCAL_QUOTA_EXCEEDED"],
        ] as const) {
          aclCall.mockImplementationOnce((...args: any[]) => {
            args.at(-1)(Object.assign(new Error(), { code: status }));
            return {} as never;
          });
          await expect(service.create(id, 0, "1")).rejects.toThrow(code);
        }
        aclCall.mockImplementationOnce((...args: any[]) => {
          args.at(-1)(Object.assign(new Error(), { code: 3 }));
          return {} as never;
        });
        await expect(service.create(id, 0, "1")).rejects.toThrow(
          "PERMISSION_DENIED",
        );
        aclCall.mockImplementationOnce((...args: any[]) => {
          args.at(-1)(null, "", "");
          return {} as never;
        });
        expect((await service.preview(1)).requiredBytes).toBe(2);
        const [, argv, options] = aclCall.mock.calls.at(-1)! as any[];
        expect(argv).toContain("-NoProfile");
        expect(argv.join(" ")).not.toContain(folder);
        expect(options.env.SSHOS_PRIVATE_DIRECTORY).toBe(root);
      } finally {
        Object.defineProperty(process, "platform", descriptor);
      }
    },
  );
  it("verifies, retains, recovers and discards a stage and its second link once", async () => {
    const { folder, service, id } = await fixture();
    const quote = await service.preview(3);
    const stage = await service.create(id, 3, quote.volumeId);
    expect(stage.filePath).toBe(join(folder, "relay-staging", id, "payload"));
    await service.recheck(stage, 3);
    await writeFile(stage.filePath, "abc", { mode: 0o600 });
    const verified = await service.verify(stage);
    await expect(service.retain(stage, 3, "wrong")).rejects.toThrow(
      "SOURCE_CHANGED",
    );
    await service.retain(stage, 3, verified.identity);
    const recovered = new RelayStaging(folder);
    await recovered.restore(stage, 3);
    const tempId = randomUUID();
    await link(
      stage.filePath,
      join(stage.directory.path, `.sshos-${tempId}.part`),
    );
    await expect(recovered.removeTemp(stage, tempId, "wrong")).rejects.toThrow(
      "PATH_CHANGED",
    );
    await recovered.removeTemp(stage, tempId, verified.identity);
    expect(await readFile(stage.filePath, "utf8")).toBe("abc");
    await recovered.discard(stage, verified.identity, {
      taskId: tempId,
      identity: verified.identity,
    });
    await recovered.discard(stage, verified.identity);
    await expect(lstat(stage.directory.path)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("preserves replacements, unrelated files, and malformed cleanup paths", async () => {
    const { service, id } = await fixture();
    const { volumeId } = await service.preview(1);
    await expect(service.create("../bad", 1, volumeId)).rejects.toThrow(
      "INPUT_INVALID",
    );
    const stage = await service.create(id, 1, volumeId);
    await writeFile(stage.filePath, "x", { mode: 0o600 });
    const original = (await service.verify(stage)).identity;
    await rename(stage.filePath, join(stage.directory.path, "previous"));
    await writeFile(stage.filePath, "y", { mode: 0o600 });
    await expect(service.discard(stage, original)).rejects.toThrow(
      "PATH_CHANGED",
    );
    expect(await readFile(stage.filePath, "utf8")).toBe("y");
    await expect(
      service.discard(stage, null, { taskId: "../", identity: original }),
    ).rejects.toThrow("INPUT_INVALID");
    await expect(
      service.verify({
        ...stage,
        filePath: join(stage.directory.path, "previous"),
      }),
    ).rejects.toThrow("PATH_CHANGED");
    await expect(
      service.verify({
        ...stage,
        directory: { ...stage.directory, identity: "changed" },
      }),
    ).rejects.toThrow("PATH_CHANGED");
    await expect(
      service.restore({ ...stage, volumeId: "untrusted" }, 1),
    ).rejects.toThrow("STORAGE_INVALID");
  });
  it.skipIf(process.platform === "win32")(
    "rejects permissive and redirected staging roots",
    async () => {
      const { folder, service } = await fixture(),
        path = join(folder, "relay-staging");
      await mkdir(path, { mode: 0o700 });
      await chmod(path, 0o755);
      await expect(service.preview(0)).rejects.toThrow("PERMISSION_DENIED");
      await rm(path, { recursive: true });
      const target = join(folder, "elsewhere");
      await mkdir(target, { mode: 0o700 });
      await symlink(target, path);
      await expect(service.preview(0)).rejects.toThrow();
      expect((await lstat(target)).isDirectory()).toBe(true);
      await unlink(path);
      const stage = await service.create(
        randomUUID(),
        0,
        (await lstat(folder, { bigint: true })).dev.toString(),
      );
      await writeFile(stage.filePath, "", { mode: 0o600 });
      await service.discard(
        stage,
        identity(await lstat(stage.filePath, { bigint: true })),
      );
    },
  );
  it("distinguishes proven local disk and server disk/quota errors from ambiguous remote status", () => {
    for (const [code, expected] of [
      ["ENOSPC", "LOCAL_DISK_FULL"],
      ["EDQUOT", "LOCAL_QUOTA_EXCEEDED"],
    ] as const) {
      const error = transferFailure({ code }, "temp_create_ack", true);
      expect(error.uncertain).toBe(false);
      expect(presentError(error).code).toBe(expected);
    }
    expect(transferFailure({ code: 14 }).message).toBe("REMOTE_DISK_FULL");
    expect(transferFailure({ code: 15 }).message).toBe("REMOTE_QUOTA_EXCEEDED");
    expect(
      transferFailure({ code: 4, message: "quota exceeded" }).message,
    ).toBe("INTERNAL_ERROR");
  });
});
