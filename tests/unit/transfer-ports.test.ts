import { HOME_COMMAND } from "../../src/worker/connections/home";
import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  lstat,
  symlink,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { startSSHFixture } from "../../scripts/fixtures/ssh-server.mjs";
import { SessionManager } from "../../src/worker/connections/session-manager";
import { SFTPTransferPorts } from "../../src/worker/transfers/ports";
import { TransferRunner } from "../../src/worker/transfers/runner";
import {
  inspectLocalDirectory,
  inspectLocalFile,
  localDownloadName,
} from "../../src/platform/local-files/selection";
import { ReceiptRepository } from "../../src/main/persistence/receipts";
import { transferReceipt } from "../fixtures/transfers";
import type { TransferReceipt } from "../../src/shared/transfers";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(options: Record<string, unknown> = {}) {
  const parent = resolve(".local/tmp");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "transfer-ports-"));
  cleanups.push(() => rm(root, { recursive: true }));
  await Promise.all([
    mkdir(join(root, "remote/etc"), { recursive: true }),
    mkdir(join(root, "remote/home/fixture"), { recursive: true }),
    mkdir(join(root, "local")),
    mkdir(join(root, "data")),
  ]);
  await writeFile(
    join(root, "remote/etc/os-release"),
    "ID=ubuntu\nVERSION_ID=24.04\n",
  );
  const remote = await startSSHFixture(join(root, "remote"), options);
  const sessions = new SessionManager(() => {});
  cleanups.push(async () => {
    sessions.closeAll();
    await remote.close();
  });
  const serverId = crypto.randomUUID();
  await sessions.connect(serverId, 1, {
    host: "127.0.0.1",
    port: remote.port,
    username: "fixture",
    authentication: "password",
    password: "test-only",
    trustedHostKey: remote.publicKey.toString("base64"),
  });
  const directory = await inspectLocalDirectory(join(root, "local"));
  const repo = await ReceiptRepository.open(join(root, "data"));
  async function run(
    direction: "upload" | "download",
    name: string,
    data: Buffer,
    hook?: (row: TransferReceipt, runner: TransferRunner) => Promise<void>,
  ) {
    const local = join(directory.path, name),
      physical = join(root, "remote/home/fixture", name),
      path = "/home/fixture/" + name;
    await writeFile(direction === "upload" ? local : physical, data, {
      mode: 0o755,
    });
    const initial = transferReceipt(direction, data.length);
    const native =
      direction === "upload" ? await inspectLocalFile(local) : null;
    const stat = direction === "download" ? await lstat(physical) : null;
    const row: TransferReceipt = {
      ...initial,
      serverId,
      endpointSnapshot: {
        name: "fixture",
        host: "127.0.0.1",
        port: remote.port,
        username: "fixture",
        endpoint: `127.0.0.1:${remote.port}`,
      },
      hostKeyFingerprint:
        "SHA256:" +
        createHash("sha256")
          .update(remote.publicKey)
          .digest("base64")
          .replace(/=+$/u, ""),
      source: direction === "upload" ? native!.path : path,
      destination:
        direction === "upload" ? path + ".uploaded" : local + ".downloaded",
      tempPath:
        direction === "upload"
          ? `/home/fixture/.sshos-${initial.taskId}.part`
          : join(directory.path, `.sshos-${initial.taskId}.part`),
      remoteParent: "/home/fixture",
      localParent: directory.path,
      sourceInitialStat: native?.stat ?? {
        size: data.length,
        mtime: String(Math.floor(stat!.mtimeMs / 1000)),
        identity: "",
      },
    };
    await repo.save(row);
    const runner = new TransferRunner(
      row,
      (record, signal, late) =>
        new SFTPTransferPorts(record, directory, sessions, signal, late),
      {
        persist: async (record) => {
          await repo.save(record);
          await hook?.(record, runner);
        },
        update: () => {},
      },
    );
    const result = await runner.run();
    return {
      row,
      result,
      finalPath:
        direction === "upload" ? physical + ".uploaded" : local + ".downloaded",
      tempPath:
        direction === "upload"
          ? join(root, "remote", row.tempPath)
          : row.tempPath,
    };
  }
  return { root, remote, sessions, serverId, repo, directory, run };
}
describe("actual loopback SFTP and workspace-local filesystem transfer ports", () => {
  it("uploads and downloads normal and empty files with read-back,0600 and exclusive final links", async () => {
    const f = await fixture({ hardlink: true });
    const data = Buffer.alloc(700001);
    for (let i = 0; i < data.length; i++) data[i] = i % 251;
    for (const direction of ["upload", "download"] as const)
      for (const bytes of [data, Buffer.alloc(0)]) {
        const record = await f.run(
          direction,
          `${direction}-${bytes.length}.bin`,
          bytes,
        );
        expect(record.result.snapshot).toMatchObject({
          phase: "completed",
          destinationCreated: true,
          cleanupState: "confirmed",
          recordError: false,
        });
        expect(record.result.resourcesClosed).toBe(true);
        expect(await readFile(record.finalPath)).toEqual(bytes);
        expect((await lstat(record.finalPath)).mode & 0o777).toBe(0o600);
        await expect(lstat(record.tempPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect(record.result.snapshot.streamSha256).toBe(
          createHash("sha256").update(bytes).digest("hex"),
        );
        expect(f.sessions.snapshots()[0]?.status).toBe("connected");
        expect(
          f.repo.snapshots().find((row) => row.taskId === record.row.taskId)
            ?.phase,
        ).toBe("completed");
      }
    expect(f.remote.metrics.authenticationRequests).toBe(5);
    expect(
      f.remote.metrics.commands.every(
        (command: string) =>
          command === HOME_COMMAND ||
          command.startsWith("/usr/bin/head ") ||
          command === "/usr/bin/realpath -ze -- ." ||
          command.startsWith("LC_ALL=C;"),
      ),
    ).toBe(true);
  });
  it("preserves uploaded temp and control connection if hardlink is unsupported", async () => {
    const f = await fixture();
    const record = await f.run(
      "upload",
      "unsupported.bin",
      Buffer.from("original"),
    );
    expect(record.result.snapshot).toMatchObject({
      phase: "failed",
      errorCode: "HARDLINK_UNSUPPORTED",
      cleanupState: "needed",
    });
    expect(await readFile(record.tempPath, "utf8")).toBe("original");
    await expect(lstat(record.finalPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(f.sessions.snapshots()[0]?.status).toBe("connected");
  });
  it("does not finalize when uploaded contents cannot be read back", async () => {
    const f = await fixture({
      hardlink: true,
      denyRead: (path: string) => path.endsWith(".part"),
    });
    const record = await f.run("upload", "denied.bin", Buffer.from("original"));
    expect(record.result.snapshot).toMatchObject({
      phase: "failed",
      errorCode: "VERIFY_READ_DENIED",
      cleanupState: "needed",
    });
    expect(
      f.remote.metrics.mutations.some((row) => row.operation === "hardlink"),
    ).toBe(false);
    await expect(lstat(record.finalPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("detects actual temp corruption before final link", async () => {
    const f = await fixture({
      hardlink: true,
      afterWriteClose: async (path: string) => {
        await writeFile(join(f.root, "remote", path), "tampered");
      },
    });
    const record = await f.run(
      "upload",
      "corrupt.bin",
      Buffer.from("original"),
    );
    expect(record.result.snapshot).toMatchObject({
      phase: "failed",
      errorCode: "VERIFY_MISMATCH",
    });
    expect(
      f.remote.metrics.mutations.some((row) => row.operation === "hardlink"),
    ).toBe(false);
    await expect(lstat(record.finalPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("preserves a remote destination created immediately before exclusive hardlink", async () => {
    const f = await fixture({
      hardlink: true,
      beforeLink: async ({ destination }: { destination: string }) => {
        await writeFile(join(f.root, "remote", destination), "preserved", {
          flag: "wx",
        });
      },
    });
    const record = await f.run("upload", "race.bin", Buffer.from("original"));
    expect(record.result.snapshot.phase).toBe("failed");
    expect(await readFile(record.finalPath, "utf8")).toBe("preserved");
    expect(await readFile(record.tempPath, "utf8")).toBe("original");
  });
  it("preserves a local destination created after finalization intent", async () => {
    const f = await fixture({ hardlink: true });
    const record = await f.run(
      "download",
      "local-race.bin",
      Buffer.from("original"),
      async (row) => {
        if (row.stage === "final_link_intent")
          await writeFile(row.destination, "preserved", { flag: "wx" });
      },
    );
    expect(record.result.snapshot).toMatchObject({
      phase: "failed",
      errorCode: "NAME_CONFLICT",
    });
    expect(await readFile(record.finalPath, "utf8")).toBe("preserved");
    expect(await readFile(record.tempPath, "utf8")).toBe("original");
  });
  it("refuses native symlink selections and invalid Windows download names", async () => {
    const f = await fixture();
    const file = join(f.directory.path, "regular");
    await writeFile(file, "abc");
    const alias = join(f.directory.path, "alias");
    await symlink(file, alias);
    await expect(inspectLocalFile(alias)).rejects.toThrow("PATH_UNSUPPORTED");
    const directoryLink = join(f.root, "dir-link");
    await symlink(f.directory.path, directoryLink);
    await expect(inspectLocalDirectory(directoryLink)).rejects.toThrow(
      "PATH_UNSUPPORTED",
    );
    for (const name of [
      "CON.txt",
      "nul",
      "COM9.log",
      "trail.",
      "trail ",
      "bad:name",
      "a?b",
    ])
      expect(localDownloadName(name, "win32")).toBe(false);
    expect(localDownloadName("한글 이름.txt", "win32")).toBe(true);
  });
  it("cancels a real transfer after temp creation without final link and preserves control", async () => {
    const f = await fixture({ hardlink: true });
    let cancelledAt = 0;
    const record = await f.run(
      "upload",
      "cancel.bin",
      Buffer.alloc(100000, 65),
      async (row, runner) => {
        if (row.stage === "temp_created") {
          cancelledAt = performance.now();
          expect(runner.cancel()).toBe("cancel_requested");
        }
      },
    );
    expect(record.result.snapshot).toMatchObject({
      phase: "cancelled",
      tempCreated: true,
      cleanupState: "needed",
    });
    expect(record.result.resourcesClosed).toBe(true);
    expect(performance.now() - cancelledAt).toBeLessThan(5000);
    expect(f.sessions.snapshots()[0]?.status).toBe("connected");
    await expect(lstat(record.finalPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      f.remote.metrics.mutations.some((row) => row.operation === "hardlink"),
    ).toBe(false);
  });
});

it.each(["SENTINEL_REMOTE_TEXT", "AUTH_FAILED"])(
  "discards actual server FAILURE description %s before durable receipts",
  async (message) => {
    const f = await fixture({
        hardlink: true,
        readFailure: (path: string) =>
          path.endsWith(".part") ? { code: 4, message } : null,
      }),
      record = await f.run(
        "upload",
        "poisoned-error.bin",
        Buffer.from("fixture contents"),
      );
    expect(record.result.snapshot).toMatchObject({
      phase: "failed",
      errorCode: "INTERNAL_ERROR",
      tempCreated: true,
      cleanupState: "needed",
    });
    expect(f.repo.get(record.row.taskId)?.errorCode).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(f.repo.snapshots())).not.toContain(message);
    expect(f.sessions.snapshots()[0]?.status).toBe("connected");
    await expect(lstat(record.finalPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
