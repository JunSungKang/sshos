import { execFile, type ExecFileOptions } from "node:child_process";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rmdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { userInfo } from "node:os";
import { z } from "zod";
import { transferFailure } from "../../shared/file-policies/transfer-failure";
import type { TransferStat } from "../../shared/transfers";
import { RelayDiskLedger, type RelayDiskView } from "./relay-disk";
import {
  identity,
  inspectLocalDirectory,
  inspectLocalFile,
  type LocalDirectory,
} from "./selection";

export { RelayDiskLedger, type RelayDiskView };
export type RelayStage = {
  jobId: string;
  root: LocalDirectory;
  directory: LocalDirectory;
  volumeId: string;
  baseIdentity?: string | undefined;
  filePath: string;
  probeIdentity?: string | undefined;
};

function systemCall(
  binary: string,
  args: string[],
  options: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) =>
    execFile(
      binary,
      args,
      { ...options, encoding: "utf8" },
      (error, stdout, stderr) =>
        error ? reject(error) : resolve({ stdout, stderr }),
    ),
  );
}

async function checkDarwinAcl(path: string): Promise<void> {
  if (process.platform !== "darwin") return;
  try {
    const { stdout, stderr } = await systemCall("/bin/ls", ["-ledb", path], {
      encoding: "utf8",
      timeout: 3000,
      maxBuffer: 32768,
      env: { LC_ALL: "C", LANG: "C" },
    });
    const [header, ...entries] = stdout.trimEnd().split("\n");
    if (
      stderr ||
      !header ||
      !/^d[-rwxstST]{9}([+@])?\s/u.test(header) ||
      (header[10] === "+" && !entries.length)
    )
      throw new Error();
    const owner = "user:" + userInfo().username;
    for (const [index, line] of entries.entries()) {
      // Darwin prints an ordinal, the owning principal, optional inherited
      // marker, allow/deny, and a comma-delimited list of ACE rights.
      const entry =
        /^\s*(\d+): ((?:user:|group:)[^\r\n]+?|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}) (?:inherited )?(allow|deny) [A-Za-z_]+(?:,[A-Za-z_]+)*$/u.exec(
          line,
        );
      if (
        !entry ||
        Number(entry[1]) !== index ||
        /\s(?:allow|deny|inherited)(?:\s|$)/u.test(entry[2]!) ||
        (entry[3] === "allow" && entry[2] !== owner)
      )
        throw new Error();
    }
  } catch {
    throw new Error("PERMISSION_DENIED");
  }
}
// The path goes through a data environment variable. The script is constant.
// A protected DACL containing only the owner's inheritable full-control ACE
// protects the job, the eventual stage, and its worker-created temporary name.
const windowsAcl = [
  "$ErrorActionPreference='Stop'",
  "$d=[IO.DirectoryInfo]::new($env:SSHOS_PRIVATE_DIRECTORY)",
  "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User",
  "if($env:SSHOS_CREATE_ROOT -eq '1' -and !$d.Exists) {",
  "$acl=[Security.AccessControl.DirectorySecurity]::new()",
  "$acl.SetOwner($sid)",
  "$acl.SetAccessRuleProtection($true,$false)",
  "$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))",
  "try {$d.Create($acl)} catch {",
  "$status=$_.Exception.GetBaseException().HResult -band 65535",
  "if($status -eq 39 -or $status -eq 112) {exit 10}",
  "if($status -eq 1295) {exit 11}",
  "throw",
  "}",
  "}",
  "$d.Refresh()",
  "if(!$d.Exists -or ($d.Attributes -band [IO.FileAttributes]::ReparsePoint)) {exit 2}",
  "$acl=$d.GetAccessControl()",
  "if($env:SSHOS_STAGING_ROOT -eq '1' -and !$acl.AreAccessRulesProtected) {exit 3}",
  "$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))",
  "if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1) {exit 3}",
  "$r=$rules[0]",
  "if($r.IdentityReference.Value -ne $sid.Value -or $r.AccessControlType -ne 'Allow' -or $r.FileSystemRights -ne 'FullControl' -or [int]$r.InheritanceFlags -ne 3 -or [int]$r.PropagationFlags -ne 0) {exit 4}",
].join("\n");

async function privateDirectory(
  path: string,
  createRoot = false,
  stagingRoot = false,
): Promise<LocalDirectory> {
  try {
    if (process.platform === "win32") {
      const windows = process.env.SystemRoot;
      if (!windows || !/^[a-z]:[\\/]/iu.test(windows))
        throw new Error("PERMISSION_DENIED");
      await systemCall(
        join(
          windows,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsAcl],
        {
          windowsHide: true,
          timeout: 15000,
          maxBuffer: 32768,
          env: {
            ...process.env,
            SSHOS_PRIVATE_DIRECTORY: path,
            SSHOS_CREATE_ROOT: createRoot ? "1" : "0",
            SSHOS_STAGING_ROOT: stagingRoot ? "1" : "0",
          },
        },
      );
    } else {
      if (createRoot) {
        try {
          await mkdir(path, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      const stat = await lstat(path, { bigint: true });
      if (
        stat.uid !== BigInt(process.getuid!()) ||
        (stat.mode & 0o777n) !== 0o700n
      )
        throw new Error("PERMISSION_DENIED");
      await checkDarwinAcl(path);
    }
    const directory = await inspectLocalDirectory(path);
    if (directory.path !== path) throw new Error("PATH_CHANGED");
    return directory;
  } catch (error) {
    const status = (error as { code?: string | number }).code;
    if (process.platform === "win32" && typeof status === "number") {
      if (status === 10) throw new Error("LOCAL_DISK_FULL");
      if (status === 11) throw new Error("LOCAL_QUOTA_EXCEEDED");
      throw new Error("PERMISSION_DENIED");
    }
    throw transferFailure(error, null, true);
  }
}

async function removeKnownFile(path: string, expected: string): Promise<void> {
  let stat;
  try {
    stat = await lstat(path, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!stat.isFile() || identity(stat) !== expected)
    throw new Error("PATH_CHANGED");
  await unlink(path);
}

/** Reports the stage location even when a proof or its cleanup could not complete. */
export class RelayStageCreationError extends Error {
  constructor(
    code: string,
    readonly stage: RelayStage,
  ) {
    super(code);
  }
}

export class RelayStaging {
  constructor(
    private readonly userData: string,
    readonly disk = new RelayDiskLedger(),
  ) {}

  private async base(): Promise<LocalDirectory> {
    const base = await inspectLocalDirectory(this.userData);
    if (resolve(this.userData) !== base.path) throw new Error("PATH_CHANGED");
    if (process.platform !== "win32") {
      const stat = await lstat(base.path, { bigint: true });
      if (
        identity(stat) !== base.identity ||
        stat.uid !== BigInt(process.getuid!()) ||
        (stat.mode & 0o022n) !== 0n
      )
        throw new Error("PERMISSION_DENIED");
      await checkDarwinAcl(base.path);
    }
    return base;
  }

  private async root(
    create: boolean,
    suppliedBase?: LocalDirectory,
  ): Promise<LocalDirectory> {
    const base = suppliedBase ?? (await this.base());
    const path = join(base.path, "relay-staging");
    if (!create) {
      try {
        await lstat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return base;
        throw error;
      }
    }
    return privateDirectory(path, create, true);
  }

  async preview(size: number): Promise<RelayDiskView> {
    return this.disk.preview(await this.root(false), size);
  }

  async create(
    jobId: string,
    size: number,
    volumeId: string,
  ): Promise<RelayStage> {
    if (!z.uuid().safeParse(jobId).success) throw new Error("INPUT_INVALID");
    const base = await this.base();
    const root = await this.root(true, base);
    await this.disk.reserveRelay(jobId, root, size, volumeId);
    let stage: RelayStage | undefined;
    try {
      const path = join(root.path, jobId);
      await mkdir(path, { mode: 0o700 });
      const directory = await inspectLocalDirectory(path);
      stage = {
        jobId,
        root,
        baseIdentity: base.identity,
        directory,
        volumeId,
        filePath: join(path, "payload"),
      };
      await this.checkDirectories(stage);
      await this.probeLinks(stage);
      return stage;
    } catch (error) {
      const failure = transferFailure(error, null, true);
      if (stage) {
        try {
          await this.discard(stage, null);
        } catch {
          throw new RelayStageCreationError(failure.message, stage);
        }
      } else await this.disk.release(jobId);
      throw failure;
    }
  }

  // Test on the selected filesystem before A sends payload. No directory sweep.
  private async probeLinks(stage: RelayStage): Promise<void> {
    const source = join(stage.directory.path, "probe");
    const target = join(stage.directory.path, "probe-link");
    const handle = await open(
      source,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
      0o600,
    );
    let expected: string | undefined;
    let linked = false;
    try {
      expected = identity(await handle.stat({ bigint: true }));
      stage.probeIdentity = expected;
      await handle.sync();
      try {
        await link(source, target);
      } catch (error) {
        throw transferFailure(error, "final_link_ack", true);
      }
      linked = true;
    } finally {
      await handle.close();
      if (expected) {
        if (linked) await removeKnownFile(target, expected);
        await removeKnownFile(source, expected);
        delete stage.probeIdentity;
      }
    }
  }

  private async checkRoot(
    stage: RelayStage,
    allowMissing = false,
  ): Promise<boolean> {
    const base = await this.base();
    if (
      !z.uuid().safeParse(stage.jobId).success ||
      (stage.baseIdentity !== undefined &&
        stage.baseIdentity !== base.identity) ||
      stage.root.path !== join(base.path, "relay-staging") ||
      stage.directory.path !== join(stage.root.path, stage.jobId) ||
      stage.filePath !== join(stage.directory.path, "payload")
    )
      throw new Error("PATH_CHANGED");
    const root = await this.root(false, base);
    if (
      root.path === base.path &&
      allowMissing &&
      stage.baseIdentity === base.identity &&
      base.identity.split(":", 1)[0] === stage.volumeId &&
      (await inspectLocalDirectory(base.path)).identity === base.identity
    )
      return false;
    if (root.identity !== stage.root.identity || root.path !== stage.root.path)
      throw new Error("PATH_CHANGED");
    return true;
  }

  private async checkDirectories(stage: RelayStage): Promise<void> {
    await this.checkRoot(stage);
    const directory = await privateDirectory(stage.directory.path);
    const stat = await lstat(directory.path, { bigint: true });
    if (
      directory.identity !== stage.directory.identity ||
      stat.dev.toString() !== stage.volumeId
    )
      throw new Error("PATH_CHANGED");
  }

  async recheck(stage: RelayStage, size: number): Promise<void> {
    await this.checkDirectories(stage);
    return this.disk.recheck(stage.jobId, stage.directory, size);
  }

  async verify(stage: RelayStage): Promise<TransferStat> {
    await this.checkDirectories(stage);
    const file = await inspectLocalFile(stage.filePath);
    if (file.parent.identity !== stage.directory.identity)
      throw new Error("PATH_CHANGED");
    return file.stat;
  }

  async retain(
    stage: RelayStage,
    size: number,
    fileIdentity: string,
  ): Promise<void> {
    const stat = await this.verify(stage);
    if (stat.identity !== fileIdentity || stat.size !== size)
      throw new Error("SOURCE_CHANGED");
    return this.disk.retained(stage.jobId, stage.volumeId, size);
  }

  async restore(stage: RelayStage, size: number): Promise<void> {
    // Recovery can charge a recorded volume even when it is offline or its
    // directory changed. Restoring a margin grants no file access or dispatch.
    if (
      !z.uuid().safeParse(stage.jobId).success ||
      !/^\d{1,32}$/u.test(stage.volumeId)
    )
      throw new Error("STORAGE_INVALID");
    return this.disk.retained(stage.jobId, stage.volumeId, size);
  }

  async removeTemp(
    stage: RelayStage,
    taskId: string,
    fileIdentity: string,
  ): Promise<void> {
    try {
      if (!z.uuid().safeParse(taskId).success || !fileIdentity)
        throw new Error("INPUT_INVALID");
      await this.checkDirectories(stage);
      await removeKnownFile(
        join(stage.directory.path, `.sshos-${taskId}.part`),
        fileIdentity,
      );
    } catch (error) {
      throw transferFailure(error, null, true);
    }
  }

  async discard(
    stage: RelayStage,
    fileIdentity: string | null,
    temp?: { taskId: string; identity: string },
  ): Promise<void> {
    try {
      if (!(await this.checkRoot(stage, true))) {
        await this.disk.release(stage.jobId);
        return;
      }
      try {
        await lstat(stage.directory.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await this.disk.release(stage.jobId);
        return;
      }
      await this.checkDirectories(stage);
      if (temp) await this.removeTemp(stage, temp.taskId, temp.identity);
      if (stage.probeIdentity) {
        await removeKnownFile(
          join(stage.directory.path, "probe-link"),
          stage.probeIdentity,
        );
        await removeKnownFile(
          join(stage.directory.path, "probe"),
          stage.probeIdentity,
        );
      }
      if (fileIdentity) await removeKnownFile(stage.filePath, fileIdentity);
      await this.checkDirectories(stage);
      await rmdir(stage.directory.path);
      await this.disk.release(stage.jobId);
    } catch (error) {
      throw transferFailure(error, null, true);
    }
  }
}
