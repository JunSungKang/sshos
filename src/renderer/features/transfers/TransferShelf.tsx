import { useEffect, useState } from "react";
import type { TransferShelf as Shelf } from "../../../shared/transfer-ui";
import { useRelayJobs } from "./RelayWorkspace";
import { RelayShelfCard, relayInFlight } from "./RelayTasks";
export const transferLabels: Record<string, string> = {
  queued: "전송 대기",
  preparing: "전송 준비",
  transferring: "전송 중",
  verifying: "내용 확인 중",
  finalize_intent_pending: "최종 파일 생성 중",
  finalizing: "최종 파일 생성 중",
  cancel_requested: "취소 처리 중",
  completed: "완료",
  failed: "실패",
  interrupted: "중단됨",
  cancelled: "취소됨",
  result_unknown: "결과 확인 필요",
  skipped: "건너뜀",
};
export function TransferProgress({
  phase,
  total,
  transferred,
  verified,
  speed,
}: {
  phase: string;
  total: number;
  transferred: number;
  verified: number;
  speed: number | null;
}) {
  const verifying = phase === "verifying",
    count = verifying ? verified : transferred;
  return (
    <span className="transfer-progress">
      <span>
        {transferLabels[phase] ?? phase} · {count.toLocaleString()} /{" "}
        {total.toLocaleString()} byte
        {speed === null
          ? ""
          : ` · ${Math.round(speed).toLocaleString()} byte/s`}
      </span>
      <progress
        aria-label={verifying ? "내용 확인 진행률" : "파일 전송 진행률"}
        max={Math.max(1, total)}
        value={count}
      />
    </span>
  );
}
export function TransferShelf({ openTasks }: { openTasks(): void }) {
  const { jobs, listError } = useRelayJobs();
  const relays = jobs.filter(
    (row) =>
      relayInFlight(row) && !["queued", "waiting_to_send"].includes(row.phase),
  );
  const relayQueued = jobs.filter((row) =>
    ["queued", "waiting_to_send"].includes(row.phase),
  ).length;
  const relayUnresolved = jobs.filter((row) => row.needsAttention).length;
  const relayFailed = jobs.filter((row) =>
    ["failed", "interrupted", "result_unknown"].includes(row.phase),
  ).length;
  const [snapshot, setSnapshot] = useState<Shelf>({
      active: [],
      queued: 0,
      registering: 0,
      unresolved: 0,
      failed: 0,
    }),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await window.sshOS.transfer.shelf();
        if (alive) {
          setSnapshot(value);
          setError("");
        }
      } catch {
        if (alive) setError("전송 상태 확인 실패");
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 250);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <aside className="transfers" aria-label="전송 상태">
      <strong>전송</strong>
      {relays.slice(0, 2).map((job) => (
        <RelayShelfCard job={job} key={job.id} />
      ))}
      {snapshot.active.length === 0 && relays.length === 0 ? (
        <span>
          {error ||
            (relayQueued ? "서버 간 복사 대기 중" : "진행 중인 전송 없음")}
        </span>
      ) : (
        snapshot.active.map((row) => (
          <div className="shelf-task" key={row.taskId}>
            <strong title={row.name}>
              {row.serverName} · {row.name}
            </strong>
            <TransferProgress
              phase={row.phase}
              total={row.totalBytes}
              transferred={row.transferredBytes}
              verified={row.verifiedBytes}
              speed={row.bytesPerSecond}
            />
            <button
              disabled={!row.cancelable}
              onClick={() => {
                void window.sshOS.transfer
                  .cancel(row.taskId)
                  .catch(() =>
                    setError("취소 수락 여부를 전체 작업에서 확인하세요."),
                  );
              }}
            >
              취소
            </button>
            {row.cleanupPending && <small>연결 정리 확인 대기</small>}
          </div>
        ))
      )}
      <span>
        대기 {snapshot.queued + relayQueued} · 등록 {snapshot.registering} ·
        실패/중단 {snapshot.failed + relayFailed} · 확인 필요{" "}
        {snapshot.unresolved + relayUnresolved}
      </span>
      <button onClick={openTasks}>전체 작업</button>
      {listError && <span role="status">서버 간 복사 상태 확인 실패</span>}
      {error && snapshot.active.length > 0 && (
        <span role="status">{error}</span>
      )}
    </aside>
  );
}
