import { errorCodeOf } from "../../../shared/errors";
import { ErrorPanel } from "../../ErrorPanel";
import { useEffect, useRef, useState } from "react";
import type { TerminalPastePreview } from "../../../shared/terminal-ui";
import { visibleFilePaste, visiblePaste } from "../../terminal-clipboard";
export function TerminalPasteDialog({
  preview,
  confirm,
  cancel,
}: {
  preview: TerminalPastePreview;
  confirm(): Promise<void>;
  cancel(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const file = preview.fileBracketed !== null;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    if (file) cancelButton.current?.focus();
  }, [file]);
  return (
    <dialog
      ref={dialog}
      className="connection-dialog terminal-paste-dialog"
      aria-label="터미널 붙여넣기 확인"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) cancel();
      }}
    >
      <h2>
        {preview.terminalName} {file ? "텍스트 파일 입력" : "붙여넣기"}
      </h2>
      <p>
        {preview.serverName} · {preview.endpoint}
      </p>
      <p>
        {preview.byteLength.toLocaleString()} UTF-8 byte · ␍=CR, ␊=LF, ␉=TAB.
        내용을 그대로 전송하며 줄바꿈을 추가하지 않습니다.
      </p>
      {file && (
        <p>
          {preview.text.split("\n").length -
            Number(preview.text.endsWith("\n"))}
          줄 · 마지막 줄바꿈 {preview.text.endsWith("\n") ? "있음" : "없음"} ·
          브래킷 붙여넣기 {preview.fileBracketed ? "켜짐" : "꺼짐"} · ␠=공백
        </p>
      )}
      {file && (
        <p>
          파일에 적힌 표시 기호와 다른 공백은 유니코드 번호로, 역슬래시는 두
          개로 표시합니다.
        </p>
      )}
      <pre>
        {file ? visibleFilePaste(preview.text) : visiblePaste(preview.text)}
      </pre>
      <p>
        붙여넣기는 이 서버와 터미널에 고정됩니다. 원격 셸에서 명령이 실행될 수
        있습니다.
      </p>
      {error && (
        <ErrorPanel error={error} phase={null} target={preview.terminalName} />
      )}
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void confirm()
            .catch((failure) => {
              setError(errorCodeOf(failure));
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy
          ? "입력 전송 대기…"
          : file
            ? "이 터미널에 보내기"
            : "확인하고 붙여넣기"}
      </button>
      <button ref={cancelButton} disabled={busy} onClick={cancel}>
        취소
      </button>
    </dialog>
  );
}
