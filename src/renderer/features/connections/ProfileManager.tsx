import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { errorCodeOf } from "../../../shared/errors";
import { ErrorPanel } from "../../ErrorPanel";
import {
  profileViewSchema,
  type ProfileDraft,
  type ProfileView,
} from "../../../shared/models";
import {
  hostChallengeSchema,
  sessionViewSchema,
  type HostChallenge,
  type SessionView,
  type SessionCredentials,
} from "../../../shared/session-contracts";
import { ConnectionPrompt, HostTrustPrompt } from "../../ConnectionPrompt";
import { ProfileEditor } from "./ProfileEditor";
import { ProfileCard } from "./ProfileCard";
import { hasLiveConnection } from "./connection-status";
import "./connections.css";

const profileTarget = (profile: ProfileView) =>
  `${profile.name} | ${profile.username}@${profile.host}:${profile.port}`;

export function ProfileManager({
  disabled,
  selectServer,
  visible,
}: {
  disabled: boolean;
  selectServer(id: string): void;
  visible: boolean;
}) {
  const [profiles, setProfiles] = useState<ProfileView[]>([]);
  const [editor, setEditor] = useState<{ profile: ProfileView | null } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [errorTarget, setErrorTarget] = useState<string | null>(null);
  const report = (value: unknown, target: string | null) => {
    setError(errorCodeOf(value));
    setErrorTarget(target);
  };
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [challenges, setChallenges] = useState<HostChallenge[]>([]);
  const [connecting, setConnecting] = useState<ProfileView | null>(null);
  const profileRead = useRef(0);
  const refresh = async () => {
    const request = ++profileRead.current;
    const rows = (await window.sshOS.profile.list()).map((row) =>
      profileViewSchema.parse(row),
    );
    if (request === profileRead.current) setProfiles(rows);
  };
  useEffect(() => {
    if (!disabled && visible)
      void refresh().catch((e) => report(e, "로컬 연결 프로필 목록"));
  }, [disabled, visible]);
  useEffect(() => {
    let alive = true;
    const update = () => {
      void window.sshOS.session
        .list()
        .then((value) => {
          if (alive) {
            setSessions(
              value.sessions.map((row) => sessionViewSchema.parse(row)),
            );
            setChallenges(
              value.challenges.map((row) => hostChallengeSchema.parse(row)),
            );
          }
        })
        .catch(() => {});
    };
    update();
    const timer = setInterval(update, 500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const attempt = (profile: ProfileView, credentials: SessionCredentials) => {
    setBusy(true);
    setError("");
    void window.sshOS.session
      .connect(profile.id, credentials)
      .catch((e) => report(e, profileTarget(profile)))
      .finally(() => setBusy(false));
  };
  const runTrust = (challenge: HostChallenge, approve: boolean) => {
    setBusy(true);
    setError("");
    void (
      approve
        ? window.sshOS.trust.approve(challenge.challengeId)
        : window.sshOS.trust.reject(challenge.challengeId)
    )
      .catch((e) => report(e, challenge.endpoint))
      .finally(() => setBusy(false));
  };
  const save = async (draft: ProfileDraft) => {
    setBusy(true);
    setError("");
    try {
      if (editor?.profile)
        await window.sshOS.profile.update(editor.profile.id, draft);
      else await window.sshOS.profile.create(draft);
      // The write ACK is final. A list-read failure must not keep a successful
      // create dialog open and encourage duplicate submission.
      await refresh().catch((e) => report(e, "로컬 연결 프로필 목록"));
    } finally {
      setBusy(false);
    }
  };
  const disconnect = (profile: ProfileView) => {
    setBusy(true);
    setError("");
    void window.sshOS.session
      .disconnect(profile.id)
      .catch((e) => report(e, profileTarget(profile)))
      .finally(() => setBusy(false));
  };
  const remove = (profile: ProfileView) => {
    if (
      !window.confirm(
        `${profile.name}의 로컬 연결 프로필을 삭제할까요? 원격 서버의 파일은 삭제하지 않습니다.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    void window.sshOS.profile
      .delete(profile.id)
      .then(refresh)
      .catch((e) => report(e, profileTarget(profile)))
      .finally(() => setBusy(false));
  };
  const host = document.getElementById("root") ?? document.body;
  return (
    <section className="connection-library" aria-label="연결 관리자">
      <div className="connection-library-heading">
        <div>
          <span className="connection-eyebrow">CONNECT</span>
          <h2>
            내 서버{" "}
            <span>
              {profiles.length}
              <small> / 10</small>
            </span>
          </h2>
          <p>저장한 서버에 연결하거나 작업 공간을 여세요.</p>
        </div>
        <div className="connection-library-actions">
          <button
            disabled={disabled || busy}
            onClick={() => {
              setError("");
              void refresh().catch((e) => report(e, "로컬 연결 프로필 목록"));
            }}
          >
            목록 새로고침
          </button>
          <button
            className="primary"
            disabled={disabled || busy || profiles.length >= 10}
            onClick={() => {
              setError("");
              setEditor({ profile: null });
            }}
          >
            <span aria-hidden="true">＋</span> 서버 추가
          </button>
        </div>
      </div>
      {error && <ErrorPanel error={error} phase={null} target={errorTarget} />}
      {profiles.length === 0 ? (
        <div className="connection-library-empty">
          <span aria-hidden="true">＋</span>
          <h3>첫 서버를 추가하세요</h3>
          <p>
            접속 정보는 이 기기에 보관됩니다.
            <br />
            비밀번호와 키 암호는 연결할 때 입력합니다.
          </p>
          <button
            className="primary"
            disabled={disabled || busy}
            onClick={() => setEditor({ profile: null })}
          >
            첫 서버 추가
          </button>
        </div>
      ) : (
        <div className="profile-card-grid">
          {profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              session={sessions.find((row) => row.serverId === profile.id)}
              disabled={disabled || busy}
              connect={() => setConnecting(profile)}
              disconnect={() => disconnect(profile)}
              open={() => selectServer(profile.id)}
              edit={() => {
                setError("");
                setEditor({ profile });
              }}
              remove={() => remove(profile)}
              confirmOS={() => {
                const session = sessions.find(
                  (row) => row.serverId === profile.id,
                );
                if (session)
                  void window.sshOS.session
                    .confirmOS(profile.id, session.generation)
                    .catch((e) => report(e, profileTarget(profile)));
              }}
            />
          ))}
        </div>
      )}
      {editor &&
        createPortal(
          <ProfileEditor
            profile={editor.profile}
            disabled={disabled}
            identityLocked={Boolean(
              editor.profile &&
                sessions.some(
                  (row) =>
                    row.serverId === editor.profile!.id &&
                    hasLiveConnection(row.status),
                ),
            )}
            save={save}
            close={() => setEditor(null)}
          />,
          host,
        )}
      {connecting &&
        createPortal(
          <ConnectionPrompt
            profile={connecting}
            close={() => setConnecting(null)}
            submit={(credentials) => attempt(connecting, credentials)}
          />,
          host,
        )}
      {challenges[0] &&
        createPortal(
          <HostTrustPrompt
            key={challenges[0].challengeId}
            challenge={challenges[0]}
            busy={busy}
            approve={() => runTrust(challenges[0]!, true)}
            reject={() => runTrust(challenges[0]!, false)}
          />,
          host,
        )}
    </section>
  );
}
