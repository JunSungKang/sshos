import { useEffect, useRef, useState } from "react";
import { userMessage } from "../../../shared/errors";
import type { RelayView } from "../../../shared/relay";
import { RelayEndpointLabel } from "./RelayDialog";
import { useRelayActions, useRelayJobs } from "./RelayWorkspace";

const phaseLabel: Record<RelayView["phase"], string> = {
  queued: "전송 대기",
  receiving: "출발 서버에서 받는 중",
  verifying_local: "PC 임시 파일 검증 중",
  waiting_to_send: "도착 서버 전송 대기",
  sending: "도착 서버로 보내는 중",
  verifying_remote: "도착 서버에서 다시 읽어 검증 중",
  publishing: "도착 서버에 최종 파일 생성 중",
  completed: "복사 완료",
  failed: "실패",
  interrupted: "중단됨",
  result_unknown: "결과 확인 필요",
  cancelled: "취소됨",
  waiting_for_space: "PC 임시 공간 재확인 필요",
};
const cleanupLabel: Record<RelayView["localCleanup"], string> = {
  none: "정리 대상 확인 없음",
  needed: "정리 필요",
  unknown: "정리 결과 확인 필요",
  confirmed: "정리 완료",
};
const confirmedLabels: Record<string, string> = {
  ...phaseLabel,
  accepted: "복사 요청 접수",
  temp_created: "임시 파일 생성 확인",
  bytes_and_handles_closed: "바이트 전송과 파일 닫힘 확인",
  content_verified: "파일 내용 검증",
  local_stage_verified: "PC 임시 파일 검증",
  destination_confirmed: "대상 파일 생성 확인",
  temp_removed: "임시 파일 제거 확인",
};
const locationLabels = {
  source: "출발 서버",
  pc: "이 PC",
  destination: "도착 서버",
};
export function relayInFlight(job: RelayView) {
  return ![
    "completed",
    "failed",
    "interrupted",
    "result_unknown",
    "cancelled",
    "waiting_for_space",
  ].includes(job.phase);
}
function RelayProgress({ job }: { job: RelayView }) {
  const moving = [
    "receiving",
    "verifying_local",
    "sending",
    "verifying_remote",
  ].includes(job.phase);
  return (
    <span className="transfer-progress">
      <span>
        {phaseLabel[job.phase]}
        {moving && (
          <>
            {" "}
            · {job.bytes.toLocaleString()} / {job.size.toLocaleString()} byte
            {job.rate !== null && (
              <> · {Math.round(job.rate).toLocaleString()} byte/s</>
            )}
          </>
        )}
      </span>
      {moving && (
        <progress
          aria-label={phaseLabel[job.phase]}
          max={Math.max(job.size, 1)}
          value={job.bytes}
        />
      )}
    </span>
  );
}

export function RelayShelfCard({ job }: { job: RelayView }) {
  const [error, setError] = useState("");
  return (
    <div className="shelf-task relay-shelf-card" aria-label="서버 간 복사">
      <strong title={job.source.path + " → " + job.destination.path}>
        {job.source.name} → {job.destination.name} ·{" "}
        {job.destination.path.split("/").at(-1)}
      </strong>
      <RelayProgress job={job} />
      {job.cancelable && (
        <button
          onClick={() =>
            void window.sshOS.relay
              .cancel(job.id)
              .catch((failure) => setError(userMessage(failure)))
          }
        >
          취소
        </button>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

export function RelayTaskList() {
  const { jobs, listError } = useRelayJobs();
  return (
    <>
      {listError && <p role="alert">서버 간 복사 기록을 읽을 수 없습니다.</p>}
      {jobs.map((job) => (
        <RelayTaskCard key={job.id} job={job} />
      ))}
    </>
  );
}

function RelayTaskCard({ job }: { job: RelayView }) {
  const actions = useRelayActions();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inspected, setInspected] = useState<{
    present: boolean | null;
    size: number | null;
    path: string;
    phase: RelayView["phase"];
    at: number;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<
    "discard" | "acknowledge" | null
  >(null);
  const modal = useRef<HTMLDialogElement>(null);
  const running = useRef(false);
  useEffect(() => {
    if (confirmation) modal.current?.showModal();
  }, [confirmation]);
  async function action(
    kind: "cancel" | "inspect" | "discard" | "acknowledge",
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setInspected(null);
    try {
      if (kind === "inspect") {
        const evidence = await window.sshOS.relay.inspect(job.id);
        setInspected({
          ...evidence,
          path: job.destination.path,
          phase: job.phase,
          at: Date.now(),
        });
      } else if (kind === "discard") {
        await window.sshOS.relay.discard(job.id);
      } else if (kind === "acknowledge") {
        await window.sshOS.relay.acknowledge(job.id);
      } else await window.sshOS.relay.cancel(job.id);
    } catch (failure) {
      setError(userMessage(failure));
    } finally {
      running.current = false;
      setBusy(false);
      setConfirmation(null);
    }
  }
  const cleanupPending = [job.localCleanup, job.remoteCleanup].some(
    (value) => value === "needed" || value === "unknown",
  );
  return (
    <article className="relay-task" aria-label="서버 간 복사">
      <strong>
        서버 간 복사 · {job.source.name} → {job.destination.name}
      </strong>
      <span className="task-phase">
        {phaseLabel[job.phase]}
        {job.publication === "confirmed" && cleanupPending
          ? " · 임시 파일 정리 필요"
          : ""}
      </span>
      <div className="relay-route">
        <RelayEndpointLabel label="출발 서버" endpoint={job.source} />
        <RelayEndpointLabel label="도착 서버" endpoint={job.destination} />
      </div>
      {relayInFlight(job) && <RelayProgress job={job} />}
      <p>
        파일 크기 {job.size.toLocaleString()} byte · 마지막 확인 단계{" "}
        {confirmedLabels[job.lastConfirmedPhase] ?? job.lastConfirmedPhase}
      </p>
      <p>
        도착 서버 최종 파일 ·{" "}
        {
          {
            none: "생성 확인 없음",
            unknown: "생성 결과 확인 필요",
            confirmed: "생성 확인",
          }[job.publication]
        }
      </p>
      <p>
        PC 임시 파일 · {cleanupLabel[job.localCleanup]}
        <br />
        도착 서버 임시 파일 · {cleanupLabel[job.remoteCleanup]}
      </p>
      {job.localStagePath && (
        <div className="relay-endpoint">
          <small>
            PC 작업 위치
            {job.localStageBytes !== null && (
              <> · 확인된 크기 {job.localStageBytes.toLocaleString()} byte</>
            )}
          </small>
          <code>{job.localStagePath}</code>
        </div>
      )}
      {job.remoteTempPath && (
        <div className="relay-endpoint">
          <small>도착 서버 임시 파일 경로</small>
          <code>{job.remoteTempPath}</code>
        </div>
      )}
      {job.errorCode && (
        <p role="status">
          {job.failureLocation && (
            <strong>{locationLabels[job.failureLocation]} · </strong>
          )}
          {userMessage(job.errorCode)}
        </p>
      )}
      {job.publication === "unknown" && (
        <p>
          도착 경로의 현재 상태를 확인하세요. 현재 파일만으로 이전 복사의 성공
          여부를 확정할 수 없습니다.
        </p>
      )}
      <div className="relay-actions">
        {job.cancelable && (
          <button disabled={busy} onClick={() => void action("cancel")}>
            복사 취소
          </button>
        )}
        <button disabled={busy} onClick={() => void action("inspect")}>
          도착 경로 확인
        </button>
        {job.retryable && (
          <button disabled={busy} onClick={() => actions?.retry(job)}>
            {job.phase === "waiting_for_space"
              ? "공간 다시 확인"
              : "다시 보내기 미리보기"}
          </button>
        )}
        {job.discardable && (
          <button disabled={busy} onClick={() => setConfirmation("discard")}>
            PC 임시 파일 정리
          </button>
        )}
        {job.acknowledgeable && (
          <button
            disabled={busy}
            onClick={() => setConfirmation("acknowledge")}
          >
            확인 후 기록 닫기
          </button>
        )}
      </div>
      {inspected &&
        inspected.path === job.destination.path &&
        inspected.phase === job.phase && (
          <p role="status">
            확인 시점의 도착 경로 ·{" "}
            {new Date(inspected.at).toLocaleTimeString("ko-KR")} ·{" "}
            {inspected.present === null
              ? "상태 미확인"
              : inspected.present
                ? "파일 있음"
                : "파일 없음"}
            {inspected.size !== null && (
              <> · {inspected.size.toLocaleString()} byte</>
            )}
          </p>
        )}
      {error && <p role="alert">{error}</p>}
      {confirmation && (
        <dialog
          ref={modal}
          className="connection-dialog"
          aria-label="복사 작업 확인"
          onCancel={(event) => {
            if (running.current) event.preventDefault();
            else setConfirmation(null);
          }}
        >
          <h2>
            {confirmation === "discard"
              ? "PC 임시 파일 정리"
              : "확인 후 기록 닫기"}
          </h2>
          <p>
            {job.source.name} · {job.source.path} → {job.destination.name} ·{" "}
            {job.destination.path}
          </p>
          <p>
            {confirmation === "discard"
              ? "이 복사 작업의 PC 임시 파일을 삭제합니다. 검증된 임시 파일을 지운 뒤에는 출발 서버에서 새로 받아야 합니다."
              : "도착 경로와 임시 파일을 직접 확인했나요? 작업 제한을 해제합니다. 기록에는 원래 결과가 남습니다."}
          </p>
          <button
            autoFocus
            disabled={busy}
            onClick={() => setConfirmation(null)}
          >
            닫기
          </button>
          <button
            disabled={
              busy ||
              (confirmation === "discard"
                ? !job.discardable
                : !job.acknowledgeable)
            }
            onClick={() => void action(confirmation)}
          >
            {confirmation === "discard" ? "임시 파일 삭제" : "확인했음"}
          </button>
        </dialog>
      )}
    </article>
  );
}
