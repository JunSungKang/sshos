import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ProfileDraft, ProfileView } from "../../../shared/models";
import { errorCodeOf } from "../../../shared/errors";
import { ErrorPanel } from "../../ErrorPanel";
import { ServerGlyph } from "./ServerGlyph";

export function ProfileEditor({
  profile,
  identityLocked,
  disabled,
  save,
  close,
}: {
  profile: ProfileView | null;
  identityLocked: boolean;
  disabled: boolean;
  save(draft: ProfileDraft): Promise<void>;
  close(): void;
}) {
  const [draft, setDraft] = useState<ProfileDraft>(() => ({
    name: profile?.name ?? "",
    host: profile?.host ?? "",
    port: profile?.port ?? 22,
    username: profile?.username ?? "",
    authentication: profile?.authentication ?? "password",
  }));
  const [keyName, setKeyName] = useState(profile?.keyFilename ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const node = dialog.current!;
    const opener = document.activeElement;
    node.showModal();
    nameInput.current?.focus();
    return () => {
      alive.current = false;
      node.close();
      requestAnimationFrame(() => {
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      });
    };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      await save(draft);
      close();
    } catch (e) {
      if (alive.current) setError(errorCodeOf(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="connection-dialog profile-editor"
      aria-label={profile ? "접속 설정 수정" : "서버 추가"}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="profile-editor-heading">
        <span className="profile-server-icon">
          <ServerGlyph />
        </span>
        <div>
          <h2>{profile ? "접속 설정 수정" : "새 서버 추가"}</h2>
          <p>연결 정보를 저장하고 필요할 때 접속하세요.</p>
        </div>
        <button
          type="button"
          aria-label="접속 설정 닫기"
          disabled={busy}
          onClick={close}
        >
          ×
        </button>
      </div>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.nativeEvent.isComposing || event.keyCode === 229)
          )
            event.preventDefault();
        }}
      >
        <fieldset disabled={disabled || busy}>
          <label>
            서버 이름
            <input
              ref={nameInput}
              required
              value={draft.name}
              placeholder="예: 개발 서버"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <fieldset disabled={identityLocked}>
            <label>
              호스트
              <input
                required
                placeholder="서버 주소 또는 IP"
                value={draft.host}
                onChange={(e) => setDraft({ ...draft, host: e.target.value })}
              />
            </label>
            <div className="field-row">
              <label>
                포트
                <input
                  required
                  type="number"
                  min="1"
                  max="65535"
                  value={draft.port}
                  onChange={(e) =>
                    setDraft({ ...draft, port: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                사용자명
                <input
                  required
                  value={draft.username}
                  onChange={(e) =>
                    setDraft({ ...draft, username: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              인증 방식
              <select
                aria-label="인증 방식"
                value={draft.authentication}
                onChange={(e) => {
                  const { keyToken: _token, ...rest } = draft;
                  setDraft({
                    ...rest,
                    authentication:
                      e.target.value === "key" ? "key" : "password",
                  });
                  setKeyName("");
                }}
              >
                <option value="password">비밀번호</option>
                <option value="key">SSH 개인키</option>
              </select>
            </label>
            {draft.authentication === "key" && (
              <div className="key-picker">
                <button
                  type="button"
                  onClick={() => {
                    void window.sshOS.profile
                      .pickKey()
                      .then((selected) => {
                        if (selected && alive.current) {
                          setDraft((current) =>
                            current.authentication === "key"
                              ? { ...current, keyToken: selected.token }
                              : current,
                          );
                          setKeyName(selected.filename);
                        }
                      })
                      .catch((e) => {
                        if (alive.current) setError(errorCodeOf(e));
                      });
                  }}
                >
                  개인키 선택
                </button>
                <span>{keyName || "선택한 파일 없음"}</span>
              </div>
            )}
          </fieldset>
          {identityLocked && (
            <p className="profile-editor-note">
              연결 중에는 서버 이름만 변경할 수 있습니다.
            </p>
          )}
          <p className="help">
            비밀번호와 키 암호는 연결할 때 입력합니다. 기본적으로 저장하지
            않습니다.
          </p>
          {error && (
            <ErrorPanel
              error={error}
              phase={null}
              target={`${draft.name} | ${draft.username}@${draft.host}:${draft.port}`}
            />
          )}
          <div className="dialog-actions">
            <button type="button" onClick={close}>
              취소
            </button>
            <button className="primary" type="submit">
              {busy ? "저장 중…" : profile ? "설정 저장" : "서버 등록"}
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}
