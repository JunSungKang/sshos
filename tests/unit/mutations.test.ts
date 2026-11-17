import { afterEach, describe, it, expect, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { FileMutations } from "../../src/worker/remote-files/mutations";
import {
  PathLocks,
  claimsConflict,
} from "../../src/shared/file-policies/path-locks";
import { SessionManager } from "../../src/worker/connections/session-manager";
import { startSSHFixture } from "../../scripts/fixtures/ssh-server.mjs";
import type { MutationSpec } from "../../src/shared/mutations";
const clean: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of clean.splice(0).reverse()) await fn();
});
async function fixture(options: Record<string, unknown> = {}) {
  await mkdir(resolve(".local/tmp"), { recursive: true });
  const root = await mkdtemp(resolve(".local/tmp/command-mutations-"));
  clean.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "home/fixture"), { recursive: true });
  await mkdir(join(root, "etc"));
  await writeFile(
    join(root, "etc/os-release"),
    "ID=ubuntu\nVERSION_ID=24.04\n",
  );
  await writeFile(join(root, "home/fixture/source"), "original");
  const remote = await startSSHFixture(root, options);
  clean.push(() => remote.close());
  const sessions = new SessionManager(() => {});
  clean.push(async () => sessions.closeAll());
  const id = crypto.randomUUID(),
    input = {
      host: "127.0.0.1",
      port: remote.port,
      username: "fixture",
      authentication: "password" as const,
      password: "test-only",
      trustedHostKey: null,
    };
  const trust = await sessions.connect(id, 1, input);
  if (trust.status !== "awaiting_host_trust") throw Error("Expected trust");
  await sessions.connect(id, 2, { ...input, trustedHostKey: trust.publicKey });
  const locks = new PathLocks(),
    service = new FileMutations(
      (id, generation) => sessions.commandAccess(id, generation),
      locks,
    );
  const run = async (spec: MutationSpec) => {
    const task = crypto.randomUUID(),
      stat = await service.inspect(id, 2, spec);
    expect(await service.prepare(id, 2, task, spec, stat)).toBe(true);
    const result = await service.step(id, 2, task, "first");
    service.finish(
      task,
      result.phase === "result_unknown" || result.phase === "partial",
    );
    return result;
  };
  return { root, remote, sessions, id, locks, service, run };
}
const rename: MutationSpec = {
  operation: "rename",
  parent: "/home/fixture",
  source: "/home/fixture/source",
  destination: "/home/fixture/dest",
  type: "file",
};
describe("command-backed non-overwriting remote mutations", () => {
  it.each([
    "Linux 6.8.0-generic\nef53\nSeccomp:\t0\n",
    "Linux 6.17.0-generic\n9123683e\nSeccomp:\t0\n",
    "Linux 7.0.0\n1021994\nSeccomp:\t0\n",
    "Linux 6.8.0\n58465342\nSeccomp:\t0\n",
  ])(
    "permits verified native rename environments: %s",
    async (renameEnvironment) => {
      const f = await fixture({ renameEnvironment });
      expect(await f.run(rename)).toMatchObject({ phase: "completed" });
    },
  );
  it.each([
    { renameEnvironment: "Linux 5.15.0\nef53\nSeccomp:\t0\n" },
    { renameEnvironment: "Linux 6.7.0\nef53\nSeccomp:\t0\n" },
    { renameEnvironment: "Linux 6.8.0\n6969\nSeccomp:\t0\n" },
    { renameEnvironment: "Linux 6.8.0\nef53\nSeccomp:\t2\n" },
    { renameEnvironment: "Linux 6.8.0\nef53\nSeccomp:\t0\nextra" },
    { renameEnvironment: "" },
    { renameEnvironment: "A".repeat(2048) },
    { denyRenameEnvironment: true },
  ])(
    "refuses unverified rename environments without any mv dispatch: %j",
    async (options) => {
      const f = await fixture(options);
      expect(await f.run(rename)).toMatchObject({
        phase: "failed",
        errorCode: "NOREPLACE_UNSUPPORTED",
      });
      expect(
        f.remote.metrics.commands.some((command: string) =>
          command.startsWith("/usr/bin/mv "),
        ),
      ).toBe(false);
      expect(await readFile(join(f.root, "home/fixture/source"), "utf8")).toBe(
        "original",
      );
    },
  );
  it("renames files and nonempty folders without SFTP traversal", async () => {
    const f = await fixture();
    expect(await f.run(rename)).toMatchObject({
      phase: "completed",
      sourceRemovalConfirmed: true,
      destinationCreated: true,
    });
    expect(await readFile(join(f.root, "home/fixture/dest"), "utf8")).toBe(
      "original",
    );
    await mkdir(join(f.root, "home/fixture/folder"));
    await writeFile(join(f.root, "home/fixture/folder/child"), "child");
    expect(
      await f.run({
        ...rename,
        type: "directory",
        source: "/home/fixture/folder",
        destination: "/home/fixture/renamed",
      }),
    ).toMatchObject({ phase: "completed" });
    expect(
      await readFile(join(f.root, "home/fixture/renamed/child"), "utf8"),
    ).toBe("child");
    expect(f.remote.metrics.readDirs).toBe(0);
  });
  it("deletes a nested tree with one server recursive command and verifies disappearance", async () => {
    const f = await fixture();
    await mkdir(join(f.root, "home/fixture/tree/sub"), { recursive: true });
    await writeFile(join(f.root, "home/fixture/tree/sub/a"), "a");
    const result = await f.run({
      ...rename,
      operation: "delete",
      source: "/home/fixture/tree",
      destination: null,
      type: "directory",
    });
    expect(result).toMatchObject({
      phase: "completed",
      sourceRemovalConfirmed: true,
    });
    await expect(
      lstat(join(f.root, "home/fixture/tree")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      f.remote.metrics.commands.filter((c) => c.startsWith("/usr/bin/rm ")),
    ).toHaveLength(1);
    expect(f.remote.metrics.readDirs).toBe(0);
  });
  it("creates an exclusive 0700 directory and rejects existing destinations", async () => {
    const f = await fixture();
    expect(
      await f.run({
        operation: "mkdir",
        parent: "/home/fixture",
        source: null,
        destination: "/home/fixture/new",
        type: null,
      }),
    ).toMatchObject({ phase: "completed", destinationCreated: true });
    expect((await lstat(join(f.root, "home/fixture/new"))).mode & 0o777).toBe(
      0o700,
    );
    await expect(
      f.service.inspect(f.id, 2, {
        ...rename,
        destination: "/home/fixture/new",
      }),
    ).rejects.toThrow("NAME_CONFLICT");
  });
  it("preserves a destination created at rename dispatch and never reports a skipped mv as success", async () => {
    let root = "";
    const f = await fixture({
      beforeRename: async () =>
        writeFile(join(root, "home/fixture/dest"), "racer"),
    });
    root = f.root;
    expect(await f.run(rename)).toMatchObject({
      phase: "failed",
      errorCode: "NAME_CONFLICT",
    });
    expect(await readFile(join(root, "home/fixture/source"), "utf8")).toBe(
      "original",
    );
    expect(await readFile(join(root, "home/fixture/dest"), "utf8")).toBe(
      "racer",
    );
  });
  it("marks failed recursive deletion partial and keeps its path restricted", async () => {
    const f = await fixture({
      beforeDelete: async () => {
        throw Error("denied");
      },
    });
    const result = await f.run({
      ...rename,
      operation: "delete",
      destination: null,
    });
    expect(result).toMatchObject({ phase: "partial" });
    expect(
      f.locks.acquire("other", f.id, [
        { path: "/home/fixture/source", mode: "write" },
      ]),
    ).toBe(false);
    expect(await readFile(join(f.root, "home/fixture/source"), "utf8")).toBe(
      "original",
    );
  });
  it("refuses invalid specs, root/parent escape and source changes before dispatch", async () => {
    const f = await fixture();
    for (const spec of [
      { ...rename, source: null },
      { ...rename, destination: null },
      { ...rename, operation: "mkdir" as const },
    ])
      await expect(f.service.inspect(f.id, 2, spec)).rejects.toThrow(
        "INPUT_INVALID",
      );
    await expect(
      f.service.inspect(f.id, 2, { ...rename, destination: "/outside" }),
    ).rejects.toThrow("PATH_UNSUPPORTED");
    await expect(
      f.service.inspect(f.id, 2, { ...rename, destination: rename.source }),
    ).rejects.toThrow("NAME_CONFLICT");
    await expect(
      f.service.inspect(f.id, 2, { ...rename, type: "directory" }),
    ).rejects.toThrow("SOURCE_CHANGED");
    const stat = await f.service.inspect(f.id, 2, rename);
    await expect(
      f.service.prepare(f.id, 2, "bad", rename, { ...stat!, size: 999 }),
    ).rejects.toThrow("SOURCE_CHANGED");
    await f.service.prepare(f.id, 2, "one", rename, stat);
    expect(await f.service.prepare(f.id, 2, "two", rename, stat)).toBe(false);
    await expect(
      f.service.prepare(f.id, 2, "one", rename, stat),
    ).rejects.toThrow("REQUEST_BUSY");
    await expect(f.service.step(f.id, 99, "one", "first")).rejects.toThrow(
      "TOKEN_EXPIRED",
    );
    await expect(
      f.service.step(f.id, 2, "one", "remove_source"),
    ).rejects.toThrow("REQUEST_BUSY");
    await writeFile(join(f.root, "home/fixture/source"), "changed size");
    expect(await f.service.step(f.id, 2, "one", "first")).toMatchObject({
      phase: "failed",
      errorCode: "SOURCE_CHANGED",
    });
    f.service.finish("one", false);
  });
  it("keeps in-flight ownership until the command closes, refuses duplicate dispatch and does not replay", async () => {
    let release!: () => void;
    const f = await fixture({
      beforeRename: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const stat = await f.service.inspect(f.id, 2, rename);
    await f.service.prepare(f.id, 2, "one", rename, stat);
    const pending = f.service.step(f.id, 2, "one", "first");
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(() => f.service.finish("one", false)).toThrow("REQUEST_BUSY");
    await expect(f.service.step(f.id, 2, "one", "first")).rejects.toThrow(
      "REQUEST_BUSY",
    );
    release();
    expect(await pending).toMatchObject({ phase: "completed" });
    await expect(f.service.step(f.id, 2, "one", "first")).rejects.toThrow(
      "REQUEST_BUSY",
    );
    f.service.finish("one", false);
  });
  it("treats loss after dispatch as unknown without a second destructive request", async () => {
    const f = await fixture({
      beforeDelete: async () => {
        f.sessions.disconnect(f.id, 2);
      },
    });
    expect(
      await f.run({ ...rename, operation: "delete", destination: null }),
    ).toMatchObject({ phase: "result_unknown", errorCode: "RESULT_UNKNOWN" });
    expect(
      f.remote.metrics.commands.filter((c) => c.startsWith("/usr/bin/rm ")),
    ).toHaveLength(1);
  });
});
it("protects parents and descendants across mutation and transfer locks", () => {
  expect(
    claimsConflict(
      [{ path: "/a", mode: "write" }],
      [{ path: "/a/b", mode: "keep" }],
    ),
  ).toBe(true);
  expect(
    claimsConflict(
      [{ path: "/a", mode: "keep" }],
      [{ path: "/a/b", mode: "write" }],
    ),
  ).toBe(false);
  const locks = new PathLocks();
  expect(locks.acquire("one", "s", [{ path: "/a", mode: "write" }])).toBe(true);
  expect(locks.acquire("one", "s", [{ path: "/a", mode: "write" }])).toBe(true);
  expect(() => locks.acquire("one", "other", [])).toThrow();
  locks.release("one");
  expect(locks.acquire("two", "s", [{ path: "/a", mode: "write" }])).toBe(true);
});
it("retains unknown when a failed rename command might have produced effects", async () => {
  let root = "";
  const f = await fixture({
    beforeRename: async () => {
      await writeFile(join(root, "home/fixture/dest"), "possible effect");
      throw Error("failure after effect");
    },
  });
  root = f.root;
  expect(await f.run(rename)).toMatchObject({
    phase: "result_unknown",
    errorCode: "RESULT_UNKNOWN",
  });
  expect(await readFile(join(root, "home/fixture/source"), "utf8")).toBe(
    "original",
  );
  expect(
    f.locks.acquire("another", f.id, [
      { path: "/home/fixture/dest", mode: "write" },
    ]),
  ).toBe(false);
});
