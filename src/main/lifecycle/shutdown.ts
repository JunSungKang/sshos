import { displayName } from "../../shared/files";
import { errorCodeOf, type ErrorCode } from "../../shared/errors";
import {
  receiptUnresolved,
  type OperationReceipt,
} from "../../shared/receipts";
export type ShutdownScope = { serverId: string; generation: number } | null;
export const inShutdownScope = (
  row: OperationReceipt,
  scope: ShutdownScope,
): boolean =>
  !scope ||
  (row.serverId === scope.serverId && row.generation === scope.generation) ||
  (row.kind === "server_relay" &&
    row.target.serverId === scope.serverId &&
    row.target.generation === scope.generation);

export function relayQuitInventory(
  rows: OperationReceipt[],
  canDiscard: (id: string) => boolean,
) {
  const children = new Map(
    rows.flatMap((row) =>
      row.kind === "file_transfer" && row.relayParentId
        ? [[row.taskId, row] as const]
        : [],
    ),
  );
  let verified = 0,
    verifiedBytes = 0,
    partial = 0,
    recordedTransfers = 0,
    recordedBytes = 0;
  const candidates = new Map<string, string>();
  for (const row of rows) {
    if (row.kind !== "server_relay" || !row.stageArea) continue;
    const child = children.get(row.downloadId);
    const download =
      child?.relayParentId === row.taskId && child.direction === "download"
        ? child
        : undefined;
    const verifiedStage =
      row.stageStat &&
      row.digest &&
      row.stageStat.size === row.size &&
      !row.recoveryUncertain;
    if (verifiedStage) {
      verified++;
      verifiedBytes += row.size;
    } else {
      partial++;
      if (download?.localTempIdentity) {
        recordedTransfers++;
        recordedBytes += download.transferredBytes;
      }
    }
    if (
      row.recoveryUncertain ||
      row.publication === "unknown" ||
      !canDiscard(row.taskId) ||
      !(
        verifiedStage ||
        download?.localTempIdentity ||
        row.stageArea.probeIdentity
      )
    )
      continue;
    // Freeze the exact job, attempt and owned objects shown in the dialog.
    candidates.set(
      row.taskId,
      JSON.stringify([
        row.updatedAt,
        row.stageArea,
        row.stageStat,
        row.digest,
        row.downloadId,
        row.uploadId,
        download?.localTempIdentity,
        row.phase,
      ]),
    );
  }
  const parts: string[] = [];
  if (verified)
    parts.push(
      `PC에 보관된 검증 사본 ${verified}개 · 파일 크기 합계 ${verifiedBytes.toLocaleString("ko-KR")} B`,
    );
  if (partial)
    parts.push(
      `부분 파일 또는 상태 미확인 ${partial}건 · 실제 크기 미확인` +
        (recordedTransfers
          ? ` (그중 ${recordedTransfers}건의 전송 기록 ${recordedBytes.toLocaleString("ko-KR")} B)`
          : ""),
    );
  return { count: verified + partial, candidates, detail: parts.join("\n") };
}

/** Restrict all deletions to the native dialog's original, identity-bound selection. */
export async function discardQuitStages(
  candidates: ReadonlyMap<string, string>,
  current: () => ReadonlyMap<string, string>,
  discard: (id: string, stillAuthorized: () => boolean) => Promise<void>,
  budgetMs: number,
): Promise<{ completed: number; error: ErrorCode | null }> {
  let completed = 0,
    expired = false;
  const deadline = performance.now() + budgetMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ completed: number; error: ErrorCode }>(
    (resolve) => {
      timer = setTimeout(() => {
        expired = true;
        resolve({ completed, error: "IO_TIMEOUT" });
      }, budgetMs);
    },
  );
  const work = (async () => {
    try {
      for (const [id, version] of candidates) {
        if (expired || performance.now() >= deadline)
          throw new Error("IO_TIMEOUT");
        await discard(
          id,
          () =>
            !expired &&
            performance.now() < deadline &&
            current().get(id) === version,
        );
        completed++;
      }
      return { completed, error: null };
    } catch (error) {
      return { completed, error: errorCodeOf(error) };
    }
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    expired = true;
    clearTimeout(timer);
  }
}
export function shutdownSummary(
  rows: OperationReceipt[],
  active: (id: string) => boolean,
  scope: ShutdownScope,
  stageDetail?: string,
): string {
  const selected = rows.filter(
      (row) =>
        inShutdownScope(row, scope) &&
        !(row.kind === "file_transfer" && row.relayParentId),
    ),
    live = selected.filter((row) => active(row.taskId)),
    counts = { transfer: 0, queued: 0, mutation: 0, exec: 0, pty: 0 };
  for (const row of live) {
    if (row.kind === "file_transfer" || row.kind === "server_relay") {
      if (row.phase === "queued") counts.queued++;
      else counts.transfer++;
    } else if (row.kind === "file_mutation") counts.mutation++;
    else if (row.kind === "gui_exec") counts.exec++;
    else counts.pty++;
  }
  const bounded = (value: string) =>
    Array.from(displayName(value)).slice(0, 160).join("");
  const lines = live
    .slice(0, 110)
    .map(
      (row) =>
        `${row.kind === "server_relay" ? `서버 간 복사 → ${bounded(row.target.name)}` : row.kind === "file_transfer" ? row.direction : row.kind === "file_mutation" ? row.operation : row.kind === "pty" ? "PTY" : "실행"} · ${bounded(row.endpointSnapshot.name)} · ${bounded(row.source ?? row.destination ?? "대화형 셸")}`,
    )
    .map((line) => Array.from(line).slice(0, 120).join(""));
  if (live.length > 110)
    lines.push(`나머지 ${live.length - 110}개는 전체 작업에서 확인하세요.`);
  const stages =
    stageDetail ??
    relayQuitInventory(
      rows.filter((row) => inShutdownScope(row, scope)),
      () => false,
    ).detail;
  if (stages) lines.push(stages);
  return `전송 ${counts.transfer} · 대기 ${counts.queued} · 파일 변경 ${counts.mutation} · GUI 실행 ${counts.exec} · PTY ${counts.pty} · 미확인 ${selected.filter(receiptUnresolved).length}\n${lines.join("\n")}\n원격 프로세스 전체 종료는 보장하지 않습니다. 확인하지 못한 결과는 불명으로 보존합니다.`;
}
export type ShutdownPorts = {
  interrupt(): Promise<void>;
  finalizing(): boolean;
  disconnect(): Promise<void>;
  active(): boolean;
  settled(): Promise<void>;
};
/** One shared monotonic budget; a delayed cancellation cannot prevent socket-close dispatch. */
export async function runShutdown(
  ports: ShutdownPorts,
  budgetMs = 10000,
): Promise<{ timedOut: boolean }> {
  let expired = false,
    disconnecting: Promise<void> | null = null;
  const deadline = performance.now() + budgetMs;
  const disconnect = () =>
    (disconnecting ??= Promise.resolve()
      .then(() => ports.disconnect())
      .catch(() => {}));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: boolean }>((done) => {
    timer = setTimeout(() => {
      expired = true;
      void disconnect();
      done({ timedOut: true });
    }, budgetMs);
  });
  const work = (async () => {
    try {
      await ports.interrupt();
    } catch {}
    if (expired) return { timedOut: true };
    while (ports.finalizing() && performance.now() < deadline && !expired)
      await new Promise((done) => setTimeout(done, 20));
    if (expired) return { timedOut: true };
    await disconnect();
    while (ports.active() && performance.now() < deadline && !expired)
      await new Promise((done) => setTimeout(done, 20));
    if (expired) return { timedOut: true };
    await ports.settled();
    return { timedOut: false };
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
