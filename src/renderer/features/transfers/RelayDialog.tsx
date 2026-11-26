import { useEffect, useRef, useState } from "react";
import { errorCodeOf, userMessage } from "../../../shared/errors";
import { remotePathSchema, validName } from "../../../shared/files";
import type {
  RelayEndpoint,
  RelayPreview,
  RelayView,
} from "../../../shared/relay";
import type { SessionView } from "../../../shared/session-contracts";
import { canRelay, joinRemotePath, type RelaySource } from "./relay-input";

export type RelayIntent =
  | { kind: "copy"; source: RelaySource; destination: SessionView | null }
  | { kind: "retry"; job: RelayView };

const bytes = (value: string | number) =>
  BigInt(value).toLocaleString("ko-KR") + " byte";
const directoryOf = (path: string) =>
  path.slice(0, path.lastIndexOf("/")) || "/";

export function RelayEndpointLabel({
  label,
  endpoint,
}: {
  label: string;
  endpoint: RelayEndpoint;
}) {
  return (
    <div className="relay-endpoint">
      <small>{label}</small>
      <strong>
        {endpoint.name} · {endpoint.username}@{endpoint.endpoint}
      </strong>
      <code>{endpoint.path}</code>
    </div>
  );
}

function SpaceEstimate({
  preview,
  retained,
}: {
  preview: RelayPreview;
  retained: boolean;
}) {
  const disk = preview.disk;
  return (
    <section aria-label="저장 공간" className="relay-space">
      <strong>저장 공간</strong>
      <dl>
        <dt>파일 크기</dt>
        <dd>{bytes(preview.size)}</dd>
        {disk ? (
          <>
            <dt>PC 임시 공간 · 10% 여유</dt>
            <dd>{bytes(disk.marginBytes)}</dd>
            <dt>PC 최소 필요 공간</dt>
            <dd>{bytes(disk.requiredBytes)}</dd>
            <dt>PC 사용 가능 공간</dt>
            <dd>{bytes(disk.effectiveBytes)}</dd>
            <dt>PC 임시 디스크 식별자</dt>
            <dd>{disk.volumeId}</dd>
          </>
        ) : (
          <>
            <dt>PC 임시 디스크</dt>
            <dd>
              {retained
                ? "검증한 기존 임시 파일을 사용합니다."
                : "사용 가능한 공간을 확인할 수 없습니다."}
            </dd>
          </>
        )}
        <dt>도착 서버 사용 가능 공간</dt>
        <dd>
          {preview.remoteAvailableBytes === null
            ? "미확인 · 쓰기 중 공간이 부족할 수 있습니다."
            : bytes(preview.remoteAvailableBytes)}
        </dd>
      </dl>
      {disk && disk.shortfallBytes > 0 && (
        <p role="alert">
          복사를 시작할 수 없습니다. PC의 임시 저장 공간이{" "}
          {bytes(disk.shortfallBytes)} 부족합니다.
        </p>
      )}
    </section>
  );
}

export function RelayDialog({
  intent,
  sessions,
  close,
}: {
  intent: RelayIntent;
  sessions: SessionView[];
  close(): void;
}) {
  const retry = intent.kind === "retry" ? intent.job : null;
  const origin = intent.kind === "copy" ? intent.source : intent.job.source;
  const choices = sessions.filter(
    (session) =>
      canRelay(session) &&
      session.serverId !== origin.serverId &&
      (!retry || session.serverId === retry.destination.serverId),
  );
  const initial =
    intent.kind === "copy"
      ? intent.destination
      : choices.find((row) => row.serverId === intent.job.destination.serverId);
  const [targetToken, setTargetToken] = useState(initial?.sessionToken ?? "");
  const target = choices.find((row) => row.sessionToken === targetToken);
  const [directory, setDirectory] = useState(
    retry
      ? directoryOf(retry.destination.path)
      : (initial?.homePath ?? initial?.initialPath ?? "/"),
  );
  const [name, setName] = useState(
    intent.kind === "copy"
      ? intent.source.name
      : (intent.job.destination.path.split("/").at(-1) ?? ""),
  );
  const [folders, setFolders] = useState<{
    path: string;
    directories: string[];
    nextOffset: number | null;
    partial: boolean;
    previousOffsets: number[];
  } | null>(null);
  const [preview, setPreview] = useState<RelayPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const sourceLive =
    (retry && retry.phase !== "waiting_for_space") ||
    sessions.some(
      (row) =>
        canRelay(row) &&
        row.serverId === origin.serverId &&
        row.generation === origin.generation,
    );
  const revision = useRef(0);
  const ownedToken = useRef<string | null>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const activeStart = useRef(false);
  function release(token: string | null) {
    if (token) void window.sshOS.relay.releasePreview(token).catch(() => {});
  }
  function reset() {
    revision.current++;
    release(ownedToken.current);
    ownedToken.current = null;
    setPreview(null);
    setBusy(false);
    setError("");
  }
  useEffect(() => {
    modal.current?.showModal();
    return () => {
      revision.current++;
      release(ownedToken.current);
    };
  }, []);
  const authority = Boolean(target && sourceLive);
  useEffect(() => {
    if (!authority) {
      reset();
      setFolders(null);
    }
  }, [authority]);
  function editFolder(path: string) {
    reset();
    setDirectory(path);
    setFolders(null);
  }
  async function browse(
    path: string,
    offset = 0,
    previousOffsets: number[] = [],
  ) {
    if (!authority || !remotePathSchema.safeParse(path).success) return;
    reset();
    setBusy(true);
    const request = revision.current;
    try {
      const result = await window.sshOS.relay.folders(
        targetToken,
        path,
        offset,
      );
      if (request !== revision.current) return;
      setDirectory(result.path);
      setFolders({ ...result, previousOffsets });
    } catch (failure) {
      if (request === revision.current) setError(userMessage(failure));
    } finally {
      if (request === revision.current) setBusy(false);
    }
  }
  async function check() {
    if (!authority || activeStart.current || uncertain) return;
    reset();
    setBusy(true);
    const request = revision.current;
    try {
      const destination = {
        destinationSessionToken: targetToken,
        directory,
        name,
      };
      const result =
        intent.kind === "retry"
          ? await window.sshOS.relay.retryPreview({
              ...destination,
              parentId: intent.job.id,
            })
          : await window.sshOS.relay.preview({
              ...destination,
              entryToken: intent.source.entryToken,
            });
      if (request !== revision.current) {
        release(result.confirmationToken);
        return;
      }
      ownedToken.current = result.confirmationToken;
      setPreview(result);
    } catch (failure) {
      if (request === revision.current) setError(userMessage(failure));
    } finally {
      if (request === revision.current) setBusy(false);
    }
  }
  async function start() {
    const token = ownedToken.current;
    if (
      activeStart.current ||
      !authority ||
      !token ||
      !preview ||
      preview.errorCode ||
      Date.parse(preview.expiresAt) <= Date.now()
    )
      return;
    activeStart.current = true;
    ownedToken.current = null;
    setStarting(true);
    try {
      await window.sshOS.relay.start(token);
      close();
    } catch (failure) {
      const code = errorCodeOf(failure);
      const unknown = [
        "INTERNAL_ERROR",
        "RESULT_UNKNOWN",
        "IO_TIMEOUT",
        "ENGINE_STOPPED",
        "STORAGE_FAILED",
      ].includes(code);
      setUncertain(unknown);
      setError(
        unknown
          ? "접수 결과를 확인하지 못했습니다. 닫은 뒤 전체 작업에서 접수 여부를 확인하세요."
          : userMessage(code),
      );
      setPreview(null);
      setStarting(false);
    } finally {
      activeStart.current = false;
    }
  }
  const valid =
    authority &&
    validName(name) &&
    remotePathSchema.safeParse(directory).success;
  const expired = Boolean(
    preview && Date.parse(preview.expiresAt) <= Date.now(),
  );
  return (
    <dialog
      ref={modal}
      className="connection-dialog relay-dialog"
      aria-label="다른 서버로 복사"
      onCancel={(event) => {
        if (activeStart.current) event.preventDefault();
        else close();
      }}
    >
      <h2>
        {retry
          ? retry.phase === "waiting_for_space"
            ? "복사 공간 다시 확인"
            : "도착 서버로 다시 보내기"
          : "다른 서버로 복사"}
      </h2>
      {!preview && (
        <div className="relay-endpoint">
          <small>원본</small>
          <strong>
            {sessions.find((row) => row.serverId === origin.serverId)
              ?.serverName ?? retry?.source.name}
          </strong>
          <code>{origin.path}</code>
        </div>
      )}
      <fieldset disabled={starting || uncertain}>
        <label>
          도착 서버
          <select
            value={target?.sessionToken ?? ""}
            onChange={(event) => {
              const selected = choices.find(
                (row) => row.sessionToken === event.target.value,
              );
              setTargetToken(event.target.value);
              editFolder(
                retry
                  ? directoryOf(retry.destination.path)
                  : (selected?.homePath ?? selected?.initialPath ?? "/"),
              );
            }}
          >
            <option value="">연결된 서버 선택</option>
            {choices.map((row) => (
              <option key={row.sessionToken} value={row.sessionToken!}>
                {row.serverName} · {row.username}@{row.host}:{row.port}
              </option>
            ))}
          </select>
        </label>
        {!choices.length && (
          <p>다른 서버를 연결하고 SFTP 사용 가능 상태를 확인하세요.</p>
        )}
        {!sourceLive && (
          <p role="alert">
            원본 연결이 변경됐습니다. 다시 연결한 뒤 파일을 다시 선택하세요.
          </p>
        )}
        <label>
          도착 폴더 · 절대 경로
          <input
            value={directory}
            onChange={(event) => editFolder(event.target.value)}
          />
        </label>
        <div>
          <button
            disabled={
              !authority ||
              busy ||
              !remotePathSchema.safeParse(directory).success
            }
            onClick={() => void browse(directory)}
          >
            폴더 찾아보기
          </button>
        </div>
        {folders && (
          <section className="relay-folders" aria-label="도착 폴더 탐색">
            <strong>{folders.path}</strong>
            {folders.path !== "/" && (
              <button
                disabled={busy}
                onClick={() => void browse(directoryOf(folders.path))}
              >
                상위 폴더
              </button>
            )}
            {folders.directories.map((folder) => (
              <button
                disabled={busy}
                key={folder}
                onClick={() =>
                  void browse(joinRemotePath(folders.path, folder))
                }
              >
                {folder} /
              </button>
            ))}
            {!folders.directories.length && (
              <span>이 페이지에 하위 폴더가 없습니다.</span>
            )}
            {folders.partial && (
              <span>
                일부 폴더만 표시합니다. 원하는 폴더의 절대 경로를 입력할 수
                있습니다.
              </span>
            )}
            {folders.previousOffsets.length > 0 && (
              <button
                disabled={busy}
                onClick={() =>
                  void browse(
                    folders.path,
                    folders.previousOffsets.at(-1)!,
                    folders.previousOffsets.slice(0, -1),
                  )
                }
              >
                이전 폴더 목록
              </button>
            )}
            {folders.nextOffset !== null && (
              <button
                disabled={busy}
                onClick={() =>
                  void browse(folders.path, folders.nextOffset!, [
                    ...folders.previousOffsets,
                    folders.nextOffset! - folders.directories.length,
                  ])
                }
              >
                다음 폴더 목록
              </button>
            )}
          </section>
        )}
        <label>
          도착 파일 이름
          <input
            value={name}
            onChange={(event) => {
              reset();
              setName(event.target.value);
            }}
          />
        </label>
      </fieldset>
      {preview && (
        <>
          <RelayEndpointLabel label="출발 서버" endpoint={preview.source} />
          <RelayEndpointLabel
            label="도착 서버"
            endpoint={preview.destination}
          />
          <SpaceEstimate
            preview={preview}
            retained={Boolean(retry && retry.phase !== "waiting_for_space")}
          />
          {preview.errorCode && (
            <p role="alert">{userMessage(preview.errorCode)}</p>
          )}
          {expired && (
            <p role="alert">
              미리보기가 만료됐습니다. 공간과 대상을 다시 확인하세요.
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="relay-actions">
        <button disabled={starting} onClick={close}>
          닫기
        </button>
        <button
          disabled={!valid || busy || starting || uncertain}
          onClick={() => void check()}
        >
          {busy
            ? "확인 중…"
            : preview || error
              ? "공간 다시 확인"
              : "복사 미리보기"}
        </button>
        <button
          className="primary"
          disabled={
            !authority ||
            !preview?.confirmationToken ||
            Boolean(preview.errorCode) ||
            expired ||
            busy ||
            starting ||
            uncertain
          }
          onClick={() => void start()}
        >
          {starting ? "접수 중…" : "복사 시작"}
        </button>
      </div>
    </dialog>
  );
}
