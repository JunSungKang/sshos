import { ErrorPanel } from "../../ErrorPanel";
import { errorCodeOf } from "../../../shared/errors";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MutationPreview } from "../../../shared/mutations";
const names = { mkdir: "새 폴더", rename: "이름 변경", delete: "삭제" };
export function MutationDialog({
  operation,
  targetToken,
  initialName,
  close,
  started,
}: {
  operation: "mkdir" | "rename" | "delete";
  targetToken: string;
  initialName: string;
  close(): void;
  started(taskId: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(operation === "rename" ? initialName : "");
  const [preview, setPreview] = useState<MutationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!preview)
        setPreview(
          await window.sshOS.file.previewMutation({
            operation,
            targetToken,
            ...(operation !== "delete" ? { name } : {}),
          }),
        );
      else {
        const id = await window.sshOS.file.startMutation(
          preview.confirmationToken,
        );
        started(id);
        close();
      }
    } catch (failure) {
      setError(errorCodeOf(failure));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="connection-dialog"
      aria-label={`${names[operation]} 확인`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
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
        <h2>{names[operation]}</h2>
        {preview ? (
          <>
            <p>
              {preview.serverName} · {preview.username}@{preview.endpoint}
            </p>
            {preview.source && (
              <p>
                원본 <code>{preview.source}</code>
              </p>
            )}
            {preview.destination && (
              <p>
                대상 <code>{preview.destination}</code>
              </p>
            )}
            <p>
              {operation === "delete"
                ? "선택한 항목과 그 안의 모든 파일·폴더를 영구 삭제합니다. 휴지통으로 이동하지 않습니다."
                : operation === "rename"
                  ? "새 이름이 이미 있으면 중단합니다. 변경 후 원본과 대상 경로를 확인합니다."
                  : "대상 위치에 권한 0700의 새 폴더를 만듭니다. 기존 이름이 있으면 중단합니다."}
            </p>
            <p>60초 안에 확인해야 합니다.</p>
          </>
        ) : operation !== "delete" ? (
          <label>
            새 이름
            <input
              autoFocus
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        ) : (
          <p>{initialName} 항목의 서버와 전체 경로를 확인하세요.</p>
        )}
        {error && (
          <ErrorPanel
            error={error}
            phase={null}
            target={initialName || name || null}
          />
        )}
        <button disabled={busy} type="submit">
          {busy
            ? "확인 중…"
            : preview
              ? "확인하고 작업 시작"
              : "서버와 경로 미리 보기"}
        </button>
        <button type="button" disabled={busy} onClick={close}>
          취소
        </button>
      </form>
    </dialog>
  );
}
