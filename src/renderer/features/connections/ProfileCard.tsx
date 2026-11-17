import type { ProfileView } from "../../../shared/models";
import type { SessionView } from "../../../shared/session-contracts";
import { ErrorPanel } from "../../ErrorPanel";
import { userMessage } from "../../../shared/errors";
import { connectionStatusLabel, hasLiveConnection } from "./connection-status";
import { ServerGlyph } from "./ServerGlyph";

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
  const endpoint = `${profile.host}:${profile.port}`;
  return (
    <article
      className="profile-card"
      data-profile-id={profile.id}
      data-state={session?.status ?? "idle"}
      aria-label={profile.name}
    >
      <div className="profile-card-top">
        <span className="profile-server-icon">
          <ServerGlyph />
        </span>
        <span className="connection-badge">
          <i className="connection-dot" />
          {connectionStatusLabel(session?.status)}
        </span>
      </div>
      <h3 title={profile.name}>{profile.name}</h3>
      <div className="profile-endpoint" title={endpoint}>
        {endpoint}
      </div>
      <div className="profile-account" title={profile.username}>
        {profile.username}
      </div>
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
      {connected && session.os === "unknown" && !session.osConfirmed && (
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
              target={`${profile.username}@${endpoint}`}
            />
          </details>
        </>
      )}
      <div className="profile-card-footer">
        <button
          className="primary profile-card-connect"
          disabled={disabled || (active && !connected)}
          onClick={connected ? open : connect}
        >
          {connected
            ? "작업 공간 열기"
            : active
              ? connectionStatusLabel(session?.status)
              : "연결"}
          <span aria-hidden="true">↗</span>
        </button>
        <div className="profile-card-tools">
          {active && (
            <button disabled={disabled} onClick={disconnect}>
              연결 해제
            </button>
          )}
          <button disabled={disabled} onClick={edit}>
            수정
          </button>
          <button
            className="profile-card-delete"
            disabled={disabled || active}
            title={
              active ? "연결 해제 후 삭제할 수 있습니다" : "로컬 접속 정보 삭제"
            }
            onClick={remove}
          >
            삭제
          </button>
        </div>
      </div>
    </article>
  );
}
