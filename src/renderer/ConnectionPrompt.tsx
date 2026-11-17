import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ProfileView } from "../shared/models";
import type {
  HostChallenge,
  SessionCredentials,
} from "../shared/session-contracts";

export function ConnectionPrompt({
  profile,
  close,
  submit,
}: {
  profile: ProfileView;
  close(): void;
  submit(input: SessionCredentials): void;
}) {
  const [value, setValue] = useState("");
  const [save, setSave] = useState(false);
  const [saved, setSaved] = useState(profile.hasSavedSecret);
  const box = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = box.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const input: SessionCredentials = { saveSecret: save };
    if (!saved) {
      if (profile.authentication === "password") input.password = value;
      else if (value) input.passphrase = value;
    }
    setValue("");
    close();
    submit(input);
  };
  return (
    <dialog
      ref={box}
      className="connection-dialog"
      onCancel={(event) => {
        event.preventDefault();
        setValue("");
        close();
      }}
    >
      <form
        onSubmit={onSubmit}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.nativeEvent.isComposing || event.keyCode === 229)
          )
            event.preventDefault();
        }}
      >
        <h2>{profile.name} 연결</h2>
        <p>
          {profile.username}@{profile.host}:{profile.port}
        </p>
        {profile.hasSavedSecret && (
          <label className="check">
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
            />
            저장한 인증 정보 사용
          </label>
        )}
        {!saved && (
          <label>
            {profile.authentication === "password"
              ? "비밀번호"
              : "개인키 암호 (설정한 경우)"}
            <input
              autoFocus
              type="password"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={save}
            onChange={(e) => setSave(e.target.checked)}
          />
          OS 암호화로 인증 정보 저장
        </label>
        <p className="help">
          처음 보는 서버는 지문 확인 후 새 연결에서 인증합니다.
        </p>
        <button type="submit" className="primary">
          연결
        </button>
        <button
          type="button"
          onClick={() => {
            setValue("");
            close();
          }}
        >
          취소
        </button>
      </form>
    </dialog>
  );
}

export function HostTrustPrompt({
  challenge,
  approve,
  reject,
  busy,
}: {
  challenge: HostChallenge;
  approve(): void;
  reject(): void;
  busy: boolean;
}) {
  const box = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = box.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={box}
      className="connection-dialog"
      onCancel={(event) => {
        event.preventDefault();
        reject();
      }}
    >
      <h2>서버 지문 확인</h2>
      <p>{challenge.endpoint}</p>
      <code>{challenge.fingerprint}</code>
      <p>
        신뢰하는 경로에서 확인한 서버 지문과 비교하세요. 승인하기 전에는 이
        서버에 인증 정보를 보내지 않습니다.
      </p>
      <button disabled={busy} className="primary" onClick={approve}>
        지문을 확인하고 연결
      </button>
      <button disabled={busy} onClick={reject}>
        취소
      </button>
    </dialog>
  );
}
