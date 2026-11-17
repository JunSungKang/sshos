import { useId, useState } from "react";
import type { ProfileView } from "../../../shared/models";
import type { SessionView } from "../../../shared/session-contracts";
import { ErrorPanel } from "../../ErrorPanel";
import { userMessage } from "../../../shared/errors";
import { connectionStatusLabel, hasLiveConnection } from "./connection-status";

export function ProfileCard({
  profile,
  session,
  disabled,
  connect,
  disconnect,
  open,
  edit,
  remove,
  confirmOS,
}: {
  profile: ProfileView;
  session: SessionView | undefined;
  disabled: boolean;
  connect(): void;
  disconnect(): void;
  open(): void;
  edit(): void;
  remove(): void;
  confirmOS(): void;
}) {
  const active = hasLiveConnection(session?.status);
  const connected = session?.status === "connected";
  const endpoint = `${profile.username}@${profile.host}:${profile.port}`;
  const needsConfirmation =
    connected && session.os === "unknown" && !session.osConfirmed;
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  return (
    <article
      className="profile-card"
      data-profile-id={profile.id}
      data-state={session?.status ?? "idle"}
      aria-label={profile.name}
    >
      <div className="profile-card-top">
        <h3 title={profile.name}>{profile.name}</h3>
        <span className="connection-badge">
          <i className="connection-dot" />
          {connectionStatusLabel(session?.status)}
        </span>
      </div>
      <div className="profile-endpoint" title={endpoint}>
        {endpoint}
      </div>
      <div className="profile-card-footer">
        <button
          className="primary profile-card-connect"
          disabled={disabled || (active && !connected)}
          onClick={connected ? open : connect}
          aria-label={
            connected
              ? "작업 공간 열기"
              : active
                ? connectionStatusLabel(session?.status)
                : "연결"
          }
          title={
            connected
              ? "작업 공간 열기"
              : active
                ? connectionStatusLabel(session?.status)
                : "서버 연결"
          }
        >
          {connected ? "열기" : active ? "대기 중" : "연결"}
        </button>
        <button
          className="profile-card-icon"
          aria-label="수정"
          title="접속 정보 수정"
          disabled={disabled}
          onClick={edit}
        >
          <ActionIcon kind="edit" />
        </button>
        <button
          className="profile-card-icon profile-card-delete"
          aria-label="삭제"
          title={
            active ? "연결 해제 후 삭제할 수 있습니다" : "로컬 접속 정보 삭제"
          }
          disabled={disabled || active}
          onClick={remove}
        >
          <ActionIcon kind="delete" />
        </button>
        <button
          className="profile-card-expand"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={
            session?.errorCode
              ? "오류 및 서버 상세 정보"
              : needsConfirmation
                ? "OS 확인 및 서버 상세 정보"
                : "서버 상세 정보"
          }
          onClick={() => setExpanded(!expanded)}
        >
          {session?.errorCode ? "오류" : needsConfirmation ? "확인" : "상세"}
        </button>
      </div>
      <div className="profile-card-extra" id={detailsId} hidden={!expanded}>
        <div className="profile-card-details">
          <span>
            {profile.authentication === "key" ? "SSH 개인키" : "비밀번호 인증"}
          </span>
          <span>
            {profile.hasSavedSecret ? "인증 정보 저장됨" : "접속 시 인증"}
          </span>
        </div>
        {connected && (
          <p className="profile-capabilities">
            {session.os === "supported"
              ? "Ubuntu 24.04"
              : session.os === "unsupported"
                ? "지원하지 않는 서버 OS"
                : session.osConfirmed
                  ? "OS 미확인 · 사용자 확인"
                  : "OS 미확인"}{" "}
            ·{" "}
            {session.sftp === "available"
              ? "SFTP 사용 가능"
              : session.sftp === "unavailable"
                ? "SFTP 사용 불가"
                : "기능 확인 중"}
          </p>
        )}
        {needsConfirmation && (
          <button disabled={disabled} onClick={confirmOS}>
            Ubuntu 24.04 서버임을 확인
          </button>
        )}
        {session?.errorCode && (
          <>
            <p className="profile-card-error" role="status">
              {userMessage(session.errorCode)}
            </p>
            <details className="profile-card-error-details">
              <summary>오류 자세히</summary>
              <ErrorPanel
                error={session.errorCode}
                phase={session.status}
                target={endpoint}
              />
            </details>
          </>
        )}
        {active && (
          <button
            className="profile-card-disconnect"
            disabled={disabled}
            onClick={disconnect}
          >
            연결 해제
          </button>
        )}
      </div>
    </article>
  );
}
function ActionIcon({ kind }: { kind: "edit" | "delete" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      {kind === "edit" ? (
        <path d="m12.5 3.5 4 4M3 17l4.5-1 9-9a2.8 2.8 0 0 0-4-4l-9 9L3 17Z" />
      ) : (
        <>
          <path d="M3 5h14M8 2h4M7 8v7m6-7v7M5 5l1 13h8l1-13" />
        </>
      )}
    </svg>
  );
}
