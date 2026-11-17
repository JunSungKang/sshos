import { ErrorPanel } from "../../ErrorPanel";
import { errorCodeOf } from "../../../shared/errors";
import { useEffect, useRef, useState } from "react";
import type {
  TransferPreviewPage,
  TransferPreviewRow,
} from "../../../shared/transfer-preview";
import { scheduleFilePage } from "../file-explorer/file-page-scheduler";
const errorCode = errorCodeOf;
export function TransferDialog({
  id,
  close,
  started,
}: {
  id: string;
  close(): void;
  started(ids: string[]): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    alive = useRef(true),
    reading = useRef(false),
    operation = useRef(false);
  const [page, setPage] = useState<TransferPreviewPage | null>(null),
    [rows, setRows] = useState<TransferPreviewRow[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [drafts, setDrafts] = useState<Record<number, string>>({});
  const refresh = async () => {
    if (reading.current || operation.current) return;
    reading.current = true;
    try {
      let offset: number | null = 0,
        all: TransferPreviewRow[] = [],
        header: TransferPreviewPage | null = null;
      while (offset !== null) {
        const value = await scheduleFilePage(() =>
          window.sshOS.transfer.getPreview(id, offset!),
        );
        if (!alive.current) return;
        if (header && header.revision !== value.revision) return;
        header = value;
        all = all.concat(value.rows);
        offset = value.nextOffset;
      }
      if (alive.current && header) {
        setPage(header);
        setRows(all);
      }
    } catch (failure) {
      if (alive.current) setError(errorCode(failure));
    } finally {
      reading.current = false;
    }
  };
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 500);
    return () => {
      alive.current = false;
      clearInterval(timer);
      void window.sshOS.transfer.releasePreview(id).catch(() => {});
    };
  }, [id]);
  const update = async (
    row: TransferPreviewRow,
    change: { name?: string; selected?: boolean },
  ) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setPage((value) => (value ? { ...value, confirmationToken: null } : null));
    try {
      await window.sshOS.transfer.updatePreview(id, row.index, change);
      if (change.name !== undefined)
        setDrafts((value) => {
          const copy = { ...value };
          delete copy[row.index];
          return copy;
        });
    } catch (failure) {
      if (alive.current) setError(errorCode(failure));
    } finally {
      operation.current = false;
      if (alive.current) {
        setBusy(false);
        void refresh();
      }
    }
  };
  const hasDraft = rows.some(
    (row) => drafts[row.index] !== undefined && drafts[row.index] !== row.name,
  );
  const start = async () => {
    if (operation.current || !page?.confirmationToken || hasDraft) return;
    operation.current = true;
    setBusy(true);
    setError("");
    const token = page.confirmationToken;
    setPage((value) => (value ? { ...value, confirmationToken: null } : null));
    try {
      const ids = await window.sshOS.transfer.start(token);
      if (alive.current) {
        started(ids);
        close();
      }
    } catch (failure) {
      if (alive.current) setError(errorCode(failure));
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="connection-dialog transfer-dialog"
      aria-label="파일 전송 확인"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          (event.nativeEvent.isComposing || event.keyCode === 229)
        )
          event.preventDefault();
      }}
    >
      <h2>{page?.direction === "download" ? "다운로드" : "업로드"} 확인</h2>
      {page && (
        <>
          <p>
            {page.serverName} · {page.endpoint}
          </p>
          <code>{page.hostKeyFingerprint}</code>
          <p>
            모든 항목을 확인하세요. 충돌 항목은 다른 이름을 적용하거나 선택을
            해제할 수 있습니다.
          </p>
        </>
      )}
      <div className="transfer-candidates" aria-label="전송 항목">
        {rows.map((row) => (
          <article key={row.index} data-transfer-index={row.index}>
            <label className="transfer-select">
              <input
                type="checkbox"
                aria-label={`${row.name} 전송 선택`}
                checked={row.selected}
                disabled={busy || page?.status !== "ready"}
                onChange={(event) => {
                  void update(row, { selected: event.target.checked });
                }}
              />
              <strong>{row.name}</strong>
              <span>
                {
                  {
                    checking: "확인 중",
                    valid: "유효",
                    conflict: "이름 충돌",
                    unsupported: "미지원",
                  }[row.status]
                }
              </span>
            </label>
            <p>
              원본 {row.sourceLabel}
              <br />
              대상 {row.destinationLabel}
              <br />
              {row.size === null
                ? "크기 미확인"
                : `${row.size.toLocaleString()} byte`}
            </p>
            {row.errorCode && (
              <ErrorPanel
                error={row.errorCode}
                phase={null}
                target={`${row.sourceLabel} -> ${row.destinationLabel}`}
              />
            )}
            <div className="transfer-rename">
              <input
                aria-label={`${row.index + 1}번째 대상 이름`}
                value={drafts[row.index] ?? row.name}
                disabled={busy || page?.status !== "ready"}
                onChange={(event) =>
                  setDrafts((value) => ({
                    ...value,
                    [row.index]: event.target.value,
                  }))
                }
              />
              <button
                disabled={
                  busy ||
                  page?.status !== "ready" ||
                  drafts[row.index] === undefined ||
                  drafts[row.index] === row.name
                }
                onClick={() => {
                  void update(row, { name: drafts[row.index]! });
                }}
              >
                이름 적용
              </button>
            </div>
          </article>
        ))}
      </div>
      <p>
        전량 SHA-256 read-back으로 내용을 대조합니다. 업로드는 원격 파일을 다시
        읽으므로 전송량과 시간이 증가합니다. 기존 파일을 덮어쓰지 않습니다.
      </p>
      {page?.expiresAt && (
        <p>확인 유효 시각 {new Date(page.expiresAt).toLocaleTimeString()}</p>
      )}
      {(error || page?.errorCode) && (
        <ErrorPanel
          error={error || page?.errorCode}
          phase={null}
          target={page?.serverName ?? null}
        />
      )}
      <button
        disabled={
          busy ||
          page?.status !== "ready" ||
          !page.confirmationToken ||
          hasDraft
        }
        onClick={() => {
          void start();
        }}
      >
        {busy
          ? "변경·전송 등록 처리 중…"
          : page?.status === "checking"
            ? "항목 확인 중…"
            : `유효한 ${page?.selectedCount ?? 0}개만 전송 · 나머지 ${(page?.total ?? 0) - (page?.selectedCount ?? 0)}개 제외`}
      </button>
      <button disabled={busy} onClick={close}>
        전체 취소
      </button>
    </dialog>
  );
}
