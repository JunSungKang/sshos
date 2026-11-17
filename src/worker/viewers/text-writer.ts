import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { Stats } from "ssh2";
import { errorCodeOf } from "../../shared/errors";
import {
  mutationReceiptSchema,
  type MutationReceipt,
} from "../../shared/mutations";
import {
  encodeEditedText,
  type TextBaseline,
} from "../../shared/viewers/editor";
import {
  decodeText,
  TEXT_LIMIT,
  type DecodedText,
} from "../../shared/viewers/text";
import {
  controlCall,
  verifyDirectory,
  type ControlAccess,
} from "../remote-files/sftp-control";
import type { PathLocks } from "../../shared/file-policies/path-locks";
import type { WorkerReceiptWriter } from "../receipt-writer";
type Prepared = {
  serverId: string;
  generation: number;
  baseline: TextBaseline;
  tempPath: string;
  format: DecodedText;
  busy: boolean;
  finishAfter?: boolean;
};
type Preparation = { serverId: string; generation: number; cancelled: boolean };
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const attributes = (s: Stats) => [s.size, s.mtime, s.mode, s.uid, s.gid];
export class TextWriter {
  private readonly tasks = new Map<string, Prepared>();
  private readonly preparations = new Map<string, Preparation>();
  constructor(
    private readonly control: (
      serverId: string,
      generation: number,
    ) => ControlAccess,
    private readonly locks: PathLocks,
    private readonly writer: WorkerReceiptWriter,
    private readonly withMetadata: <T>(
      serverId: string,
      generation: number,
      action: () => Promise<T>,
    ) => Promise<T> = (_serverId, _generation, action) => action(),
  ) {}
  private async read(
    control: ControlAccess,
    path: string,
  ): Promise<{ bytes: Buffer; stat: Stats }> {
    const sftp = control.sftp,
      before = await controlCall<Stats>(control, (done) =>
        sftp.lstat(path, done),
      );
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size > TEXT_LIMIT ||
      before.size < 0
    )
      throw new Error("PATH_UNSUPPORTED");
    const handle = await controlCall<Buffer>(control, (done) =>
      sftp.open(path, "r", done),
    );
    try {
      const stat = await controlCall<Stats>(control, (done) =>
        sftp.fstat(handle, done),
      );
      if (
        !stat.isFile() ||
        JSON.stringify(attributes(stat)) !== JSON.stringify(attributes(before))
      )
        throw new Error("SOURCE_CHANGED");
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const read = await controlCall<number>(control, (done) =>
          sftp.read(
            handle,
            bytes,
            offset,
            Math.min(32768, bytes.length - offset),
            offset,
            (error, count) => done(error, count),
          ),
        );
        if (!read) throw new Error("SOURCE_CHANGED");
        offset += read;
      }
      const after = await controlCall<Stats>(control, (done) =>
        sftp.fstat(handle, done),
      );
      if (
        JSON.stringify(attributes(after)) !== JSON.stringify(attributes(stat))
      )
        throw new Error("SOURCE_CHANGED");
      return { bytes, stat };
    } finally {
      await controlCall<void>(control, (done) =>
        sftp.close(handle, (error) => done(error, undefined)),
      );
    }
  }
  private unchanged(
    value: { bytes: Buffer; stat: Stats },
    baseline: TextBaseline,
  ): void {
    if (
      hash(value.bytes) !== baseline.sha256 ||
      JSON.stringify(attributes(value.stat)) !==
        JSON.stringify([
          baseline.size,
          baseline.mtime,
          baseline.mode,
          baseline.uid,
          baseline.gid,
        ])
    )
      throw new Error("SOURCE_CHANGED");
  }
  async prepare(
    serverId: string,
    generation: number,
    taskId: string,
    baseline: TextBaseline,
    tempPath: string,
  ) {
    if (
      this.tasks.has(taskId) ||
      this.preparations.has(taskId) ||
      this.tasks.size + this.preparations.size >= 100
    )
      throw new Error("REQUEST_BUSY");
    if (
      posix.dirname(baseline.path) !== baseline.parent ||
      tempPath !== posix.join(baseline.parent, `.sshos-edit-${taskId}.tmp`)
    )
      throw new Error("PATH_UNSUPPORTED");
    const preparation: Preparation = { serverId, generation, cancelled: false };
    this.preparations.set(taskId, preparation);
    let acquired = false,
      installed = false;
    try {
      return await this.withMetadata(serverId, generation, async () => {
        if (preparation.cancelled) throw new Error("REQUEST_CANCELLED");
        acquired = this.locks.acquire(taskId, serverId, [
          { path: baseline.parent, mode: "keep" },
          { path: baseline.path, mode: "write" },
          { path: tempPath, mode: "write" },
        ]);
        if (!acquired) throw new Error("REQUEST_BUSY");
        const control = this.control(serverId, generation);
        await verifyDirectory(control, baseline.parent);
        const original = await this.read(control, baseline.path);
        this.unchanged(original, baseline);
        if (preparation.cancelled) throw new Error("REQUEST_CANCELLED");
        if (original.stat.mode & 0o7000) throw new Error("PATH_UNSUPPORTED");
        const format = decodeText(original.bytes);
        if (format.lineEnding === "mixed")
          throw new Error("TEXT_EDIT_UNSUPPORTED");
        // Keep format metadata only; original file contents are not an edit cache.
        this.tasks.set(taskId, {
          serverId,
          generation,
          baseline,
          tempPath,
          format: { ...format, text: "", lineStarts: new Uint32Array(0) },
          busy: false,
        });
        installed = true;
        return {
          stat: {
            type: "file" as const,
            size: baseline.size,
            mtime: baseline.mtime,
            mode: baseline.mode,
          },
        };
      });
    } finally {
      this.preparations.delete(taskId);
      if (acquired && !installed) this.locks.release(taskId);
    }
  }
  async save(
    serverId: string,
    generation: number,
    initial: MutationReceipt,
    raw: Uint8Array,
  ) {
    const row = mutationReceiptSchema.parse(initial),
      task = this.tasks.get(row.taskId);
    if (
      !task ||
      task.busy ||
      task.serverId !== serverId ||
      task.generation !== generation ||
      row.serverId !== serverId ||
      row.generation !== generation ||
      row.backendEpoch !== this.writer.epoch ||
      row.operation !== "edit" ||
      row.phase !== "prepared" ||
      row.source !== task.baseline.path ||
      row.destination !== row.source ||
      row.parent !== task.baseline.parent ||
      row.tempPath !== task.tempPath
    )
      throw new Error("INPUT_INVALID");
    task.busy = true;
    let receipt = row,
      created = false,
      publishSent = false,
      recordError = false;
    const deadline = performance.now() + 60000;
    let native: ControlAccess;
    try {
      native = this.control(serverId, generation);
    } catch (error) {
      task.busy = false;
      throw error;
    }
    const control: ControlAccess = {
      ...native,
      check: () => {
        native.check();
        if (performance.now() > deadline) throw new Error("IO_TIMEOUT");
      },
    };
    const persist = async (change: Partial<MutationReceipt>) => {
      receipt = { ...receipt, ...change, updatedAt: new Date().toISOString() };
      await this.writer.persist(receipt);
      if (change.phase !== "completed") control.check();
    };
    try {
      decodeText(raw);
      const draft = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(raw),
        bytes = encodeEditedText(draft, task.format),
        expected = hash(bytes),
        sftp = control.sftp;
      await verifyDirectory(control, task.baseline.parent);
      this.unchanged(
        await this.read(control, task.baseline.path),
        task.baseline,
      );
      await persist({ phase: "dispatched", stage: "text_temp_intent" });
      const handle = await controlCall<Buffer>(control, (done) =>
        sftp.open(task.tempPath, "wx", 0o600, done),
      );
      created = true;
      try {
        for (let offset = 0; offset < bytes.length; offset += 32768)
          await controlCall<void>(control, (done) =>
            sftp.write(
              handle,
              Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length),
              offset,
              Math.min(32768, bytes.length - offset),
              offset,
              (error) => done(error, undefined),
            ),
          );
        const temp = await controlCall<Stats>(control, (done) =>
          sftp.fstat(handle, done),
        );
        if (temp.uid !== task.baseline.uid || temp.gid !== task.baseline.gid)
          await controlCall<void>(control, (done) =>
            sftp.fchown(handle, task.baseline.uid, task.baseline.gid, (error) =>
              done(error, undefined),
            ),
          );
        await controlCall<void>(control, (done) =>
          sftp.fchmod(handle, task.baseline.mode & 0o777, (error) =>
            done(error, undefined),
          ),
        );
      } finally {
        await controlCall<void>(control, (done) =>
          sftp.close(handle, (error) => done(error, undefined)),
        );
      }
      const staged = await this.read(control, task.tempPath);
      if (
        hash(staged.bytes) !== expected ||
        staged.stat.uid !== task.baseline.uid ||
        staged.stat.gid !== task.baseline.gid ||
        (staged.stat.mode & 0o777) !== (task.baseline.mode & 0o777)
      )
        throw new Error("VERIFY_MISMATCH");
      await persist({
        stage: "text_temp_verified",
        lastConfirmedPhase: "text_temp_verified",
        destinationCreated: true,
      });
      this.unchanged(
        await this.read(control, task.baseline.path),
        task.baseline,
      );
      await verifyDirectory(control, task.baseline.parent);
      await persist({ stage: "text_replace_intent" });
      this.unchanged(
        await this.read(control, task.baseline.path),
        task.baseline,
      );
      const ready = await this.read(control, task.tempPath);
      if (
        hash(ready.bytes) !== expected ||
        ready.stat.uid !== task.baseline.uid ||
        ready.stat.gid !== task.baseline.gid ||
        (ready.stat.mode & 0o777) !== (task.baseline.mode & 0o777)
      )
        throw new Error("VERIFY_MISMATCH");
      await controlCall<void>(control, (done) => {
        try {
          publishSent = true;
          sftp.ext_openssh_rename(task.tempPath, task.baseline.path, (error) =>
            done(error, undefined),
          );
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Server does not support this extended request"
          ) {
            publishSent = false;
            throw new Error("ATOMIC_RENAME_UNSUPPORTED");
          }
          throw error;
        }
      });
      const final = await this.read(control, task.baseline.path);
      if (
        hash(final.bytes) !== expected ||
        final.stat.uid !== task.baseline.uid ||
        final.stat.gid !== task.baseline.gid ||
        (final.stat.mode & 0o777) !== (task.baseline.mode & 0o777)
      )
        throw new Error("VERIFY_MISMATCH");
      await persist({
        phase: "completed",
        stage: "text_saved",
        lastConfirmedPhase: "text_saved",
        sourceRemovalConfirmed: true,
        errorCode: null,
      });
    } catch (error) {
      const uncertain =
        publishSent ||
        (receipt.stage === "text_temp_intent" &&
          !created &&
          typeof (error as { code?: unknown }).code !== "number");
      receipt = {
        ...receipt,
        phase: uncertain ? "result_unknown" : created ? "partial" : "failed",
        stage: receipt.stage,
        errorCode: uncertain ? "RESULT_UNKNOWN" : errorCodeOf(error),
        updatedAt: new Date().toISOString(),
      };
      try {
        await this.writer.persist(receipt);
      } catch {
        recordError = true;
      }
    } finally {
      raw.fill(0);
      task.busy = false;
      if (task.finishAfter !== undefined) {
        this.tasks.delete(row.taskId);
        if (!task.finishAfter) this.locks.release(row.taskId);
      }
    }
    return { receipt, recordError };
  }
  finish(
    serverId: string,
    generation: number,
    taskId: string,
    keepRestriction: boolean,
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      const preparation = this.preparations.get(taskId);
      if (preparation) {
        if (
          preparation.serverId !== serverId ||
          preparation.generation !== generation
        )
          throw new Error("TOKEN_EXPIRED");
        preparation.cancelled = true;
        return;
      }
      if (!keepRestriction) this.locks.release(taskId);
      return;
    }
    if (task.serverId !== serverId || task.generation !== generation)
      throw new Error("TOKEN_EXPIRED");
    if (task.busy) {
      task.finishAfter =
        task.finishAfter === undefined
          ? keepRestriction
          : task.finishAfter && keepRestriction;
      return;
    }
    this.tasks.delete(taskId);
    if (!keepRestriction) this.locks.release(taskId);
  }
}
