import { posix } from "node:path";
import { mutationClaims } from "../../shared/file-policies/mutation-claims";
import { PathLocks } from "../../shared/file-policies/path-locks";
import {
  mutationSpecSchema,
  initialStatSchema,
  type MutationSpec,
  type InitialStat,
  type MutationResult,
} from "../../shared/mutations";
import { errorCodeOf } from "../../shared/errors";
import { UbuntuMetadata } from "./metadata/ubuntu-metadata";
import { runCommand, type CommandAccess } from "./metadata/command-runner";
import {
  quotePath,
  renameEnvironmentCommand,
} from "./metadata/ubuntu-commands";
type Prepared = {
  serverId: string;
  generation: number;
  spec: MutationSpec;
  stat: InitialStat | null;
  busy: boolean;
  sent: boolean;
};
/** Identity-checked server operations. Intent persistence is owned by main before step(). */
export class FileMutations {
  private readonly tasks = new Map<string, Prepared>();
  constructor(
    private readonly access: (
      serverId: string,
      generation: number,
    ) => CommandAccess,
    private readonly locks: PathLocks,
  ) {}
  private validate(raw: MutationSpec): MutationSpec {
    const spec = mutationSpecSchema.parse(raw);
    if (
      spec.operation === "mkdir"
        ? spec.source !== null ||
          spec.destination === null ||
          spec.type !== null
        : !spec.source ||
          !spec.type ||
          (spec.operation === "delete"
            ? spec.destination !== null
            : !spec.destination)
    )
      throw new Error("INPUT_INVALID");
    for (const path of [spec.source, spec.destination])
      if (path && (path === "/" || posix.dirname(path) !== spec.parent))
        throw new Error("PATH_UNSUPPORTED");
    if (spec.source && spec.source === spec.destination)
      throw new Error("NAME_CONFLICT");
    return spec;
  }
  private async verifyRenameSupport(access: CommandAccess, parent: string) {
    // GNU mv's renameatu fallback can race on unsupported filesystems/kernels.
    // Fail closed for unverified mounts and syscall-filtered processes instead
    // of silently weakening the destination-preservation policy.
    try {
      const response = await runCommand(
        access,
        renameEnvironmentCommand(parent),
        1024,
        15000,
      );
      const match =
        /^Linux ([0-9]{1,3})\.([0-9]{1,3})(?:[.-][0-9A-Za-z.+_-]+)?\n(ef53|9123683e|1021994|58465342)\nSeccomp:[ \t]+0\n$/u.exec(
          response.bytes.toString("utf8"),
        );
      if (
        response.code !== 0 ||
        response.stderr ||
        response.truncated ||
        !match ||
        Number(match[1]) < 6 ||
        (Number(match[1]) === 6 && Number(match[2]) < 8)
      )
        throw new Error("NOREPLACE_UNSUPPORTED");
    } catch {
      throw new Error("NOREPLACE_UNSUPPORTED");
    }
  }
  private async inspectWith(
    access: CommandAccess,
    spec: MutationSpec,
  ): Promise<InitialStat | null> {
    const metadata = new UbuntuMetadata(access);
    await metadata.verifyDirectory(spec.parent);
    let stat: InitialStat | null = null;
    if (spec.source) {
      const value = await metadata.properties(spec.source);
      if (value.type !== spec.type) throw new Error("SOURCE_CHANGED");
      stat = initialStatSchema.parse({
        type: spec.type,
        size: value.size,
        mtime: value.mtime,
        mode: value.mode,
        identity: `${value.device}:${value.inode}`,
      });
    }
    if (spec.destination) {
      const q = quotePath(spec.destination);
      const response = await runCommand(
        access,
        `test ! -e ${q} && test ! -L ${q}`,
        1024,
        15000,
      );
      if (response.code !== 0 || response.stderr)
        throw new Error("NAME_CONFLICT");
    }
    return stat;
  }
  async inspect(serverId: string, generation: number, raw: MutationSpec) {
    return this.inspectWith(
      this.access(serverId, generation),
      this.validate(raw),
    );
  }
  async prepare(
    serverId: string,
    generation: number,
    taskId: string,
    raw: MutationSpec,
    expected: InitialStat | null,
  ): Promise<boolean> {
    if (this.tasks.has(taskId)) throw new Error("REQUEST_BUSY");
    if (this.tasks.size >= 100) throw new Error("TASK_LIMIT");
    const spec = this.validate(raw);
    if (!this.locks.acquire(taskId, serverId, mutationClaims(spec)))
      return false;
    try {
      const stat = await this.inspect(serverId, generation, spec);
      if (JSON.stringify(stat) !== JSON.stringify(expected))
        throw new Error("SOURCE_CHANGED");
      this.tasks.set(taskId, {
        serverId,
        generation,
        spec,
        stat,
        busy: false,
        sent: false,
      });
      return true;
    } catch (e) {
      this.locks.release(taskId);
      throw e;
    }
  }
  async step(
    serverId: string,
    generation: number,
    taskId: string,
    stage: "first" | "remove_source",
  ): Promise<MutationResult> {
    const task = this.tasks.get(taskId);
    if (!task || task.serverId !== serverId || task.generation !== generation)
      throw new Error("TOKEN_EXPIRED");
    if (task.busy || task.sent || stage !== "first")
      throw new Error("REQUEST_BUSY");
    task.busy = true;
    const result = (
      phase: MutationResult["phase"],
      errorCode: string | null,
      confirmed = false,
    ): MutationResult => ({
      phase,
      errorCode,
      destinationCreated: confirmed && task.spec.operation !== "delete",
      sourceRemovalConfirmed: confirmed && task.spec.operation !== "mkdir",
      lastConfirmedPhase: confirmed ? "command_verified" : "prepared",
    });
    try {
      const access = this.access(serverId, generation),
        spec = task.spec;
      const now = await this.inspectWith(access, spec);
      if (JSON.stringify(now) !== JSON.stringify(task.stat))
        throw new Error("SOURCE_CHANGED");
      if (spec.operation === "rename")
        await this.verifyRenameSupport(access, spec.parent);
      const src = spec.source ? quotePath(spec.source) : "",
        dst = spec.destination ? quotePath(spec.destination) : "";
      const command =
        spec.operation === "delete"
          ? `/usr/bin/rm -rf --one-file-system --preserve-root=all -- ${src}`
          : spec.operation === "mkdir"
            ? `/usr/bin/mkdir -m 0700 -- ${dst}`
            : `/usr/bin/mv -nT --no-copy -- ${src} ${dst}`;
      task.sent = true;
      const executed = await runCommand(access, command, 8192, 60000);
      if (executed.truncated || executed.code === null)
        return result("result_unknown", "RESULT_UNKNOWN");
      if (executed.code !== 0 || executed.stderr)
        return result(
          spec.operation === "delete" ? "partial" : "result_unknown",
          "RESULT_UNKNOWN",
        );
      await new UbuntuMetadata(access).verifyDirectory(spec.parent);
      if (spec.operation !== "mkdir") {
        const absent = await runCommand(
          access,
          `test ! -e ${src} && test ! -L ${src}`,
          1024,
          15000,
        );
        if (absent.code !== 0 || absent.stderr)
          return result(
            spec.operation === "rename" ? "failed" : "result_unknown",
            spec.operation === "rename" ? "NAME_CONFLICT" : "RESULT_UNKNOWN",
          );
      }
      if (spec.destination) {
        const value = await new UbuntuMetadata(access).properties(
          spec.destination,
        );
        if (
          spec.operation === "mkdir"
            ? value.type !== "directory"
            : `${value.device}:${value.inode}` !== task.stat?.identity
        )
          return result("result_unknown", "RESULT_UNKNOWN");
      }
      return result("completed", null, true);
    } catch (e) {
      return result(
        task.sent ? "result_unknown" : "failed",
        task.sent ? "RESULT_UNKNOWN" : errorCodeOf(e),
      );
    } finally {
      task.busy = false;
    }
  }
  finish(taskId: string, keepRestriction: boolean) {
    const task = this.tasks.get(taskId);
    if (task?.busy) throw new Error("REQUEST_BUSY");
    this.tasks.delete(taskId);
    if (!keepRestriction) this.locks.release(taskId);
  }
}
