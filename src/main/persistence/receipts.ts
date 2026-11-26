import { mkdir, lstat, opendir, unlink, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { AtomicJSONStore } from "./store";
import { type MutationReceipt } from "../../shared/mutations";
import {
  fileReceiptSchema,
  receiptUnresolved as unresolved,
  receiptTerminal as terminal,
  type FileReceipt,
} from "../../shared/receipts";
import {
  currentRelayLeg,
  recoverRelay,
  relayTerminal,
  relayUnresolved,
} from "../../shared/relay";
import { recoverExecution } from "../../shared/executions";
import { recoverTransfer } from "../../shared/transfers";
import {
  claimsConflict,
  type PathClaim,
} from "../../shared/file-policies/path-locks";
import { transferClaims } from "../../shared/file-policies/transfer-claims";

export function recoverMutation(
  receipt: MutationReceipt,
  backup: boolean,
): MutationReceipt {
  if (backup || ["dispatched"].includes(receipt.phase))
    return {
      ...receipt,
      phase: "result_unknown",
      errorCode: "RESULT_UNKNOWN",
      recoveryUncertain: backup,
      recoveredFromPhase: receipt.phase,
      ...(backup ? { acknowledgedAt: null } : {}),
    };
  if (receipt.phase === "prepared")
    return {
      ...receipt,
      phase: "failed",
      errorCode: "CONNECTION_LOST",
      recoveredFromPhase: "prepared",
    };
  return receipt;
}
export class ReceiptRepository {
  private readonly stores = new Map<string, AtomicJSONStore<FileReceipt>>();
  private readonly damaged = new Set<string>();
  private fault = false;
  private version = 0;
  private pendingRevision = -1;
  private pendingRows: FileReceipt[] = [];
  private relayBudgets = new Map<string, number>();
  private requiredEvidenceSlots = 0;
  get revision(): number {
    return this.version;
  }
  get(id: string): FileReceipt | undefined {
    return this.stores.get(id)?.snapshot();
  }
  private tail: Promise<void> = Promise.resolve();
  private constructor(
    readonly root: string,
    private readonly onDirectorySyncUnavailable?: () => void,
  ) {}
  get faulted(): boolean {
    return (
      this.fault || [...this.stores.values()].some((store) => store.faulted)
    );
  }
  markFault(): void {
    this.fault = true;
  }
  async settled(): Promise<void> {
    await this.tail;
    await Promise.all(
      [...this.stores.values()].map((store) => store.settled()),
    );
  }
  static async open(
    dataRoot: string,
    continuity?: { epoch: string; executionIds: ReadonlySet<string> },
    onDirectorySyncUnavailable?: () => void,
  ): Promise<ReceiptRepository> {
    const root = resolve(dataRoot, "receipts");
    try {
      const stat = await lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("STORAGE_FAILED");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(root, { mode: 0o700 });
    }
    const actual = await realpath(root);
    const relation = relative(await realpath(dataRoot), actual);
    if (
      !relation ||
      isAbsolute(relation) ||
      relation === ".." ||
      relation.startsWith(`..${sep}`)
    )
      throw new Error("STORAGE_FAILED");
    const repo = new ReceiptRepository(actual, onDirectorySyncUnavailable);
    const ids = new Set<string>();
    const entries = await opendir(actual);
    for await (const entry of entries) {
      const match = /^([a-f0-9-]{36})\.json(?:\.bak)?$/u.exec(entry.name);
      if (match) ids.add(match[1]!);
    }
    let loadedSincePrune = 0;
    for (const id of ids) {
      const store = repo.newStore(id);
      let loaded: Awaited<ReturnType<typeof store.load>>;
      try {
        loaded = await store.load();
        if (loaded.value.taskId !== id) throw new Error("STORAGE_FAILED");
      } catch {
        repo.damaged.add(id);
        continue;
      }
      const keepExecution =
        !loaded.recovered &&
        continuity?.epoch === loaded.value.backendEpoch &&
        continuity.executionIds.has(id) &&
        (loaded.value.kind === "gui_exec" || loaded.value.kind === "pty");
      const recovered = keepExecution
        ? loaded.value
        : loaded.value.kind === "file_mutation"
          ? recoverMutation(loaded.value, loaded.recovered)
          : loaded.value.kind === "file_transfer"
            ? recoverTransfer(loaded.value, loaded.recovered)
            : loaded.value.kind === "server_relay"
              ? recoverRelay(loaded.value, loaded.recovered)
              : recoverExecution(loaded.value, loaded.recovered);
      repo.stores.set(id, store);
      if (recovered !== loaded.value) {
        try {
          await store.save(recovered);
        } catch {
          repo.fault = true;
        }
      }
      // One startup cleanup pass, processed in batches so legitimate completed
      // history cannot hit the retained-record bound before pruning is reached.
      if (++loadedSincePrune >= 1000) {
        await repo.prune(continuity?.executionIds, true);
        if (repo.stores.size + repo.damaged.size > 5000)
          throw new Error("STORAGE_FAILED");
        loadedSincePrune = 0;
      }
    }
    // Resolve cross-file checkpoints only after the complete set of known IDs is loaded.
    // A backed-up, missing or damaged child can never authorize dispatch or prove publication.
    for (const parent of repo.snapshots()) {
      if (
        parent.kind !== "server_relay" ||
        parent.recoveryUncertain ||
        !parent.recoveredFromPhase ||
        parent.phase !== "result_unknown" ||
        !parent.uploadId
      )
        continue;
      const child = repo.get(parent.uploadId);
      if (
        child?.kind !== "file_transfer" ||
        child.recoveryUncertain ||
        child.direction !== "upload" ||
        !currentRelayLeg(parent, child)
      )
        continue;
      if (
        child.phase === "completed" &&
        child.dispatchAllowed &&
        child.destinationCreated &&
        child.streamSha256 === parent.digest &&
        parent.digest &&
        child.verifiedBytes === parent.size &&
        child.transferredBytes === parent.size
      ) {
        await repo.save({
          ...parent,
          phase: "completed",
          publication: "confirmed",
          lastConfirmedPhase: "destination_confirmed",
          remoteCleanup: child.cleanupState,
          errorCode: null,
        });
      } else if (
        !child.dispatchAllowed &&
        !child.destinationCreated &&
        child.phase !== "result_unknown"
      ) {
        await repo.save({
          ...parent,
          phase: "interrupted",
          publication: "none",
          remoteCleanup: child.cleanupState,
          errorCode: "CONNECTION_LOST",
        });
      }
    }
    await repo.prune(continuity?.executionIds);
    if (repo.stores.size + repo.damaged.size > 5000)
      throw new Error("STORAGE_FAILED");
    return repo;
  }
  private newStore(id: string): AtomicJSONStore<FileReceipt> {
    return new AtomicJSONStore(
      resolve(this.root, `${id}.json`),
      fileReceiptSchema,
      65536,
      this.onDirectorySyncUnavailable,
    );
  }
  snapshots(): FileReceipt[] {
    return [...this.stores.values()]
      .map((store) => store.snapshot())
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          a.taskId.localeCompare(b.taskId),
      );
  }
  damagedIds(): string[] {
    return [...this.damaged];
  }
  checkNew(
    serverId: string,
    claims: PathClaim[],
    localClaims: PathClaim[] = [],
    ownRelay?: string,
  ): void {
    if (this.faulted) throw new Error("STORAGE_FAILED");
    // A100-row registration rechecks every claim before each durable write/RPC.
    // Unresolved rows change only with this repository revision, so do not clone
    // and sort all historical receipts for every individual claim.
    if (this.pendingRevision !== this.version) {
      const rows = [...this.stores.values()].map((store) => store.snapshot());
      this.pendingRows = rows.filter(unresolved);
      this.relayBudgets.clear();
      const children = new Map<string, number>();
      for (const row of this.pendingRows)
        if (row.kind === "file_transfer" && row.relayParentId)
          children.set(
            row.relayParentId,
            1 + (children.get(row.relayParentId) ?? 0),
          );
      this.requiredEvidenceSlots = this.pendingRows.length;
      for (const parent of rows)
        if (parent.kind === "server_relay" && !relayTerminal(parent)) {
          const occupied =
            (children.get(parent.taskId) ?? 0) + (unresolved(parent) ? 1 : 0);
          const promised = Math.max(0, 3 - occupied);
          this.relayBudgets.set(parent.taskId, promised);
          this.requiredEvidenceSlots += promised;
        }
      this.pendingRevision = this.version;
    }
    const pending = this.pendingRows;
    if (
      this.requiredEvidenceSlots -
        (ownRelay ? (this.relayBudgets.get(ownRelay) ?? 0) : 0) >=
      100
    )
      throw new Error("UNRESOLVED_LIMIT");
    if (
      pending.some(
        (row) =>
          row.kind === "server_relay" &&
          !row.acknowledgedAt &&
          row.publication === "unknown" &&
          row.target.serverId === serverId &&
          claimsConflict(claims, [{ path: row.destination, mode: "write" }]),
      )
    )
      throw new Error("RESULT_UNKNOWN");
    if (
      pending.some(
        (row) =>
          (row.kind === "file_transfer" || row.kind === "file_mutation") &&
          row.serverId === serverId &&
          claimsConflict(
            claims,
            [
              ...new Set(
                (row.kind === "file_mutation"
                  ? [row.source, row.destination, row.tempPath ?? null]
                  : row.direction === "upload"
                    ? [row.destination, row.tempPath]
                    : [row.source]
                ).filter((path): path is string => path !== null),
              ),
            ].map((path) => ({ path, mode: "write" })),
          ),
      )
    )
      throw new Error("RESULT_UNKNOWN");
    if (
      localClaims.length &&
      pending.some(
        (row) =>
          row.kind === "file_transfer" &&
          claimsConflict(localClaims, transferClaims(row).local),
      )
    )
      throw new Error("RESULT_UNKNOWN");
  }
  private parentOwns(id: string, child?: FileReceipt): boolean {
    for (const store of this.stores.values()) {
      const row = store.snapshot();
      if (
        row.kind === "server_relay" &&
        (row.legIds.includes(id) ||
          (child?.kind === "file_transfer" &&
            child.relayParentId === row.taskId)) &&
        (!relayTerminal(row) || relayUnresolved(row))
      )
        return true;
    }
    return false;
  }
  checkRelayAdmission(): void {
    this.checkNew("", []);
    if (this.requiredEvidenceSlots + 3 > 100)
      throw new Error("UNRESOLVED_LIMIT");
    if (this.stores.size + this.damaged.size + 3 > 5000)
      throw new Error("TASK_LIMIT");
  }
  async save(receipt: FileReceipt): Promise<void> {
    const operation = this.tail.then(async () => {
      if (this.faulted) throw new Error("STORAGE_FAILED");
      const parsed = fileReceiptSchema.parse(receipt);
      if (
        parsed.kind === "file_transfer" &&
        parsed.phase === "finalize_intent_pending"
      )
        throw new Error("INPUT_INVALID");
      let store = this.stores.get(receipt.taskId);
      if (store) {
        const previous = store.snapshot();
        const immutable = (row: FileReceipt) =>
          row.kind === "file_mutation"
            ? [
                row.kind,
                row.taskId,
                row.serverId,
                row.generation,
                row.backendEpoch,
                row.endpointSnapshot,
                row.hostKeyFingerprint,
                row.operation,
                row.source,
                row.destination,
                row.parent,
                row.sourceInitialStat,
                row.tempPath,
                row.createdAt,
              ]
            : row.kind === "server_relay"
              ? [
                  row.kind,
                  row.taskId,
                  row.backendEpoch,
                  row.origin,
                  row.sourceStat,
                  row.target.serverId,
                  row.target.host,
                  row.target.username,
                  row.target.port,
                  row.target.hostKeyFingerprint,
                  row.createdAt,
                ]
              : row.kind === "file_transfer"
                ? [
                    row.kind,
                    row.taskId,
                    row.serverId,
                    row.generation,
                    row.backendEpoch,
                    row.endpointSnapshot,
                    row.hostKeyFingerprint,
                    row.relayParentId,
                    row.direction,
                    row.source,
                    row.destination,
                    row.tempPath,
                    row.remoteParent,
                    row.localParent,
                    row.sourceInitialStat,
                    row.totalBytes,
                    row.createdAt,
                  ]
                : [
                    row.kind,
                    row.taskId,
                    row.serverId,
                    row.generation,
                    row.backendEpoch,
                    row.endpointSnapshot,
                    row.hostKeyFingerprint,
                    row.executionId,
                    row.terminalId,
                    row.source,
                    row.cwd,
                    row.createdAt,
                  ];
        if (
          JSON.stringify(immutable(previous)) !==
          JSON.stringify(immutable(parsed))
        )
          throw new Error("INPUT_INVALID");
        if (
          previous.kind === "file_transfer" &&
          parsed.kind === "file_transfer" &&
          ((previous.localTempIdentity &&
            previous.localTempIdentity !== parsed.localTempIdentity) ||
            (previous.streamSha256 &&
              previous.streamSha256 !== parsed.streamSha256))
        )
          throw new Error("INPUT_INVALID");
        if (
          previous.kind === "server_relay" &&
          parsed.kind === "server_relay" &&
          (previous.legIds.some((id, index) => parsed.legIds[index] !== id) ||
            (previous.downloadId !== parsed.downloadId &&
              previous.legIds.includes(parsed.downloadId)) ||
            (parsed.uploadId !== null &&
              previous.uploadId !== parsed.uploadId &&
              previous.legIds.includes(parsed.uploadId)) ||
            (previous.publication === "confirmed" &&
              parsed.publication !== "confirmed") ||
            (previous.digest && parsed.digest !== previous.digest))
        )
          throw new Error("INPUT_INVALID");
        if (
          previous.kind !== "server_relay" &&
          terminal(previous) &&
          previous.phase !== parsed.phase
        )
          throw new Error("INPUT_INVALID");
      }
      // Existing child identity is immutable. An older attempt can still receive
      // a cleanup acknowledgement, but may never become the current leg again.
      if (!store && parsed.kind === "file_transfer" && parsed.relayParentId) {
        const parent = this.get(parsed.relayParentId);
        if (
          parent?.kind !== "server_relay" ||
          !parent.stageArea ||
          (parsed.direction === "upload" &&
            (!parent.stageStat || !parent.digest)) ||
          !currentRelayLeg(parent, parsed)
        )
          throw new Error("INPUT_INVALID");
      }
      try {
        if (!store) {
          if (this.damaged.has(receipt.taskId))
            throw new Error("STORAGE_FAILED");
          store = this.newStore(receipt.taskId);
          await store.initialize(parsed);
          this.stores.set(receipt.taskId, store);
        } else await store.save(parsed);
        this.version++;
      } catch {
        this.fault = true;
        throw new Error("STORAGE_FAILED");
      }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  private async remove(id: string): Promise<void> {
    for (const suffix of [".json", ".json.bak"]) {
      try {
        await unlink(resolve(this.root, id + suffix));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    this.stores.delete(id);
    this.damaged.delete(id);
    this.version++;
  }
  async acknowledge(id: string): Promise<void> {
    const store = this.stores.get(id);
    if (!store || !unresolved(store.snapshot()))
      throw new Error("INPUT_INVALID");
    await this.save({
      ...store.snapshot(),
      acknowledgedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  async forget(id: string): Promise<void> {
    const operation = this.tail.then(async () => {
      const row = this.get(id);
      if (
        this.parentOwns(id, row) ||
        (row?.kind === "file_transfer" &&
          row.relayParentId &&
          this.damaged.has(row.relayParentId)) ||
        (this.damaged.has(id) &&
          this.snapshots().some(
            (r) => r.kind === "file_transfer" && r.relayParentId === id,
          ))
      )
        throw new Error("REQUEST_BUSY");
      if (!this.damaged.has(id) && (!row || !terminal(row) || unresolved(row)))
        throw new Error("INPUT_INVALID");
      await this.remove(id);
    });
    this.tail = operation.catch(() => {});
    await operation;
  }
  private async prune(
    preserved: ReadonlySet<string> = new Set(),
    partialScan = false,
  ): Promise<void> {
    const rows = this.snapshots();
    const protectedParents = rows.filter(
      (row) =>
        row.kind === "server_relay" &&
        (!relayTerminal(row) || relayUnresolved(row)),
    );
    const protectedLegs = new Set(
      protectedParents.flatMap((row) =>
        row.kind === "server_relay" ? row.legIds : [],
      ),
    );
    const protectedParentIds = new Set(
      protectedParents.map((row) => row.taskId),
    );
    const eligible = rows.filter(
      (row) =>
        terminal(row) &&
        !unresolved(row) &&
        !preserved.has(row.taskId) &&
        !(
          row.kind === "file_transfer" &&
          row.relayParentId &&
          (partialScan ||
            protectedLegs.has(row.taskId) ||
            protectedParentIds.has(row.relayParentId) ||
            this.damaged.has(row.relayParentId))
        ),
    );
    for (const [index, row] of eligible.entries())
      if (
        index >= 1000 ||
        Date.now() - Date.parse(row.updatedAt) > 30 * 86400000
      )
        await this.remove(row.taskId);
  }
}
