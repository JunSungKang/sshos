import { FileContextMenu } from "./FileContextMenu";
import { FilePropertiesDialog } from "./FilePropertiesDialog";
import { createPortal } from "react-dom";
import { usePreferences } from "../settings/preferences";
import { reportWindowLimit } from "../desktop/window-limit";
import { errorCodeOf } from "../../../shared/errors";
import { ErrorPanel } from "../../ErrorPanel";
import { useEffect, useRef, useState } from "react";
import type { DirectoryPage, EntryView } from "../../../shared/files";
import type { SessionView } from "../../../shared/session-contracts";
import { ExecutionDialog } from "../execution/ExecutionDialog";
import type { WindowModel } from "../../../shared/windows";
import { TransferDialog } from "../transfers/TransferDialog";
import { MutationDialog } from "./MutationDialog";
import { scheduleFilePage } from "./file-page-scheduler";
import { imageSignature } from "../../../shared/viewers/image-header";
import { FileOpenChoice } from "./FileOpenChoice";
import { scheduleViewerFrame } from "../viewers/viewer-stream-scheduler";

const explain = (error: unknown) => {
  reportWindowLimit(error);
  return errorCodeOf(error);
};
type TreeRow = {
  path: string;
  name: string;
  token: string;
  parent: string | null;
};
export function FileExplorer({
  windowId,
  session,
  generation,
  newWindow,
  openViewer,
  storageHealthy,
  openExecution,
  desktop = false,
  openFolder,
}: {
  desktop?: boolean;
  openFolder?(token: string): Promise<void>;
  openExecution(model: WindowModel): void;
  storageHealthy: boolean;
  windowId: string;
  session?: SessionView;
  generation: number;
  newWindow(): void;
  openViewer(entryToken: string, kind: "text" | "image" | "web"): Promise<void>;
}) {
  const [context, setContext] = useState<{
    x: number;
    y: number;
    row: EntryView;
  } | null>(null);
  const [properties, setProperties] = useState<string | null>(null);
  const [startFallback, setStartFallback] = useState(false);
  const [page, setPage] = useState<DirectoryPage | null>(null);
  const [rows, setRows] = useState<EntryView[]>([]);
  const [tree, setTree] = useState<TreeRow[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const preferences = usePreferences();
  const showHidden = preferences?.showHiddenFiles ?? false;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const selected = selection.length === 1 ? selection[0]! : null;
  const anchor = useRef<string | null>(null);
  const [executionEntry, setExecutionEntry] = useState<string | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null),
    [picking, setPicking] = useState(false);
  const nativeBusy = useRef(false);
  const [mutation, setMutation] = useState<{
    operation: "mkdir" | "rename" | "delete";
    token: string;
    name: string;
  } | null>(null);
  const [opening, setOpening] = useState(false);
  const openingRequest = useRef(0);
  const openingBusy = useRef(false);
  const probeToken = useRef<string | null>(null);
  const [choice, setChoice] = useState<{
    entryToken: string;
    name: string;
    path: string;
    server: string;
  } | null>(null);
  const [treeScroll, setTreeScroll] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(300);
  const [width, setWidth] = useState(800);
  const viewport = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const alive = useRef(true);
  const connected =
    session?.status === "connected" && session.generation === generation;
  const writable =
    storageHealthy &&
    connected &&
    (session.os === "supported" ||
      (session.os === "unknown" && session.osConfirmed));
  const currentView = useRef({ page, connected });
  currentView.current = { page, connected };
  const selectedRow = rows.find((row) => row.entryToken === selected);
  const observeMutation = async (id: string) => {
    const origin = page;
    setNotice("작업을 시작했습니다. 전체 작업에서 기록을 확인할 수 있습니다.");
    try {
      while (alive.current) {
        const result = await window.sshOS.task.inspect(id);
        if (!alive.current) return;
        if (
          ["completed", "failed", "partial", "result_unknown"].includes(
            result.phase,
          )
        ) {
          setNotice(
            result.phase === "completed"
              ? "작업 완료"
              : result.phase === "partial" || result.phase === "result_unknown"
                ? "결과 확인 필요 · 전체 작업에서 확인하세요."
                : "작업 실패 · 전체 작업에서 오류 코드를 확인하세요.",
          );
          if (
            result.phase === "completed" &&
            currentView.current.connected &&
            currentView.current.page?.path === origin?.path &&
            origin
          )
            await load(() => window.sshOS.file.list(origin.directoryToken));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch {
      if (alive.current) setNotice("전체 작업에서 처리 상태를 확인하세요.");
    }
  };
  const load = async (action: () => Promise<DirectoryPage>) => {
    setContext(null);
    setContext(null);
    const id = ++request.current;
    setBusy(true);
    setError("");
    setNotice("");
    setSelection([]);
    anchor.current = null;
    try {
      let result = await action();
      if (!alive.current || request.current !== id) return;
      let collected = result.entries;
      setPage(result);
      setRows(collected);
      setScroll(0);
      if (viewport.current) viewport.current.scrollTop = 0;
      while (result.nextOffset !== null) {
        result = await scheduleFilePage(() => {
          if (!alive.current || request.current !== id)
            throw new Error("REQUEST_CANCELLED");
          return window.sshOS.file.page(result.pageToken, result.nextOffset!);
        });
        if (!alive.current || request.current !== id) return;
        collected = collected.concat(result.entries);
        setRows(collected);
        setPage(result);
      }
      const parts = result.path.split("/").filter(Boolean);
      const parent =
        result.path === "/" ? null : "/" + parts.slice(0, -1).join("/");
      setTree((previous) => {
        const entries = new Map(previous.map((row) => [row.path, row]));
        entries.set(result.path, {
          path: result.path,
          name: parts.at(-1) ?? "/",
          token: result.directoryToken,
          parent,
        });
        if (result.parentToken && parent !== null)
          entries.set(parent, {
            path: parent,
            name: parts.at(-2) ?? "/",
            token: result.parentToken,
            parent: parent === "/" ? null : "/" + parts.slice(0, -2).join("/"),
          });
        for (const row of collected)
          if (row.directoryToken) {
            const path =
              (result.path === "/" ? "" : result.path) + "/" + row.name;
            entries.set(path, {
              path,
              name: row.name,
              token: row.directoryToken,
              parent: result.path,
            });
          }
        return [...entries.values()].slice(-20000);
      });
    } catch (failure) {
      if (alive.current && request.current === id) setError(explain(failure));
    } finally {
      if (alive.current && request.current === id) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void load(() => window.sshOS.file.open(windowId));
    return () => {
      alive.current = false;
      request.current++;
      openingRequest.current++;
      if (probeToken.current)
        void window.sshOS.viewer
          .releaseProbe(probeToken.current)
          .catch(() => {});
    };
  }, [windowId]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setHeight(element.clientHeight);
      setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const filtered = rows.filter(
    (row) =>
      (showHidden || !row.name.startsWith(".")) && row.name.includes(filter),
  );
  const columns = desktop ? Math.max(1, Math.floor(width / 144)) : 1;
  const rowHeight = desktop ? 144 : 42;
  const first = Math.max(0, (Math.floor(scroll / rowHeight) - 8) * columns);
  const visible = filtered.slice(
    first,
    first + (Math.ceil(height / rowHeight) + 16) * columns,
  );
  useEffect(() => {
    if (!showHidden) {
      const allowed = new Set(
        rows
          .filter((row) => !row.name.startsWith("."))
          .map((row) => row.entryToken),
      );
      setSelection((old) => old.filter((token) => allowed.has(token)));
      anchor.current = null;
    }
  }, [showHidden, rows]);
  const select = (
    token: string | null,
    event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) => {
    if (!token) return;
    let next: string[];
    if (event.shiftKey && anchor.current) {
      const a = filtered.findIndex((row) => row.entryToken === anchor.current),
        b = filtered.findIndex((row) => row.entryToken === token);
      next =
        a < 0 || b < 0
          ? [token]
          : filtered
              .slice(Math.min(a, b), Math.max(a, b) + 1)
              .flatMap((row) => (row.entryToken ? [row.entryToken] : []));
    } else if (event.ctrlKey || event.metaKey)
      next = selection.includes(token)
        ? selection.filter((value) => value !== token)
        : [...selection, token];
    else next = [token];
    if (next.length > 100) {
      setNotice("한 번에 최대100개를 선택할 수 있습니다.");
      return;
    }
    setSelection(next);
    if (!event.shiftKey) anchor.current = token;
  };
  const transfer = async (
    direction: "upload" | "download",
    entryTokens = selection,
  ) => {
    if (!writable || !page || nativeBusy.current) return;
    nativeBusy.current = true;
    setPicking(true);
    setError("");
    try {
      let result: { previewId: string } | null = null;
      if (direction === "upload") {
        const choices = await window.sshOS.transfer.pickUploadFiles();
        if (choices && alive.current)
          result = await window.sshOS.transfer.previewUpload({
            fileTokens: choices.map((row) => row.token),
            directoryToken: page.directoryToken,
          });
      } else {
        const directory = await window.sshOS.transfer.pickDownloadDirectory();
        if (directory && alive.current)
          result = await window.sshOS.transfer.previewDownload({
            entryTokens,
            directoryToken: directory.token,
          });
      }
      if (result) {
        if (alive.current) setTransferId(result.previewId);
        else await window.sshOS.transfer.releasePreview(result.previewId);
      }
    } catch (failure) {
      if (alive.current) setError(errorCodeOf(failure));
    } finally {
      nativeBusy.current = false;
      if (alive.current) setPicking(false);
    }
  };
  const observeTransfers = async (ids: string[]) => {
    const origin = page;
    setNotice(
      `${ids.length}개 전송을 등록했습니다. 창을 닫아도 전송 선반과 전체 작업에서 확인할 수 있습니다.`,
    );
    try {
      while (alive.current) {
        let offset: number | null = 0;
        const states = new Map<string, string>();
        while (offset !== null) {
          const tasks = await window.sshOS.task.list(offset);
          for (const row of tasks.rows)
            if (ids.includes(row.taskId)) states.set(row.taskId, row.phase);
          offset = tasks.nextOffset;
        }
        if (!alive.current) return;
        if (
          ids.every((id) =>
            [
              "completed",
              "failed",
              "cancelled",
              "interrupted",
              "result_unknown",
              "skipped",
            ].includes(states.get(id) ?? ""),
          )
        ) {
          if (
            ids.some((id) => states.get(id) === "completed") &&
            currentView.current.connected &&
            currentView.current.page?.path === origin?.path &&
            origin
          )
            await load(() => window.sshOS.file.list(origin.directoryToken));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch {
      /* Tasks remain owned by main; closing this observer does not cancel them. */
    }
  };
  const cancelOpen = () => {
    openingRequest.current++;
    openingBusy.current = false;
    setOpening(false);
    const token = probeToken.current;
    probeToken.current = null;
    if (token) void window.sshOS.viewer.releaseProbe(token).catch(() => {});
  };
  const open = async (row: EntryView) => {
    if (!connected || busy || opening || openingBusy.current || !row.entryToken)
      return;
    if (row.type === "directory") {
      if (desktop && openFolder) {
        void openFolder(row.directoryToken!).catch((failure) =>
          setError(explain(failure)),
        );
      } else void load(() => window.sshOS.file.enter(row.entryToken!));
      return;
    }
    if (/\.html?$/iu.test(row.name)) {
      try {
        await openViewer(row.entryToken, "web");
      } catch (e) {
        setError(explain(e));
      }
      return;
    }
    openingBusy.current = true;
    setOpening(true);
    setError("");
    const id = ++openingRequest.current;
    let token: string | null = null;
    try {
      const probe = await window.sshOS.viewer.probe(row.entryToken);
      token = probe.probeToken;
      if (!alive.current || id !== openingRequest.current) return;
      probeToken.current = token;
      const samples: Uint8Array[] = [];
      let count = 0,
        sequence = 0,
        path = "";
      while (alive.current && id === openingRequest.current) {
        const frame = await scheduleViewerFrame(() => {
          if (!alive.current || id !== openingRequest.current)
            throw new Error("REQUEST_CANCELLED");
          return window.sshOS.viewer.next(
            token!,
            probe.readGeneration,
            sequence,
          );
        });
        if (!alive.current || id !== openingRequest.current) return;
        if (frame.status === "waiting") {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        path = frame.metadata.path;
        if (frame.status === "end") break;
        count += frame.bytes.length;
        if (count > 4096) throw new Error("INPUT_INVALID");
        samples.push(frame.bytes);
        sequence++;
      }
      if (!alive.current || id !== openingRequest.current) return;
      const signature = new Uint8Array(count);
      let offset = 0;
      for (const bytes of samples) {
        signature.set(bytes, offset);
        offset += bytes.length;
      }
      if (imageSignature(signature)) await openViewer(row.entryToken, "image");
      else if (/\.(txt|md|log|json|yaml|yml|ini|conf|csv|sh)$/iu.test(row.name))
        await openViewer(row.entryToken, "text");
      else
        setChoice({
          entryToken: row.entryToken,
          name: row.name,
          path,
          server: session
            ? `${session.serverName} · ${session.username}@${session.host}:${session.port}`
            : "연결 끊김",
        });
    } catch (failure) {
      if (alive.current && id === openingRequest.current)
        setError(explain(failure));
    } finally {
      if (token) await window.sshOS.viewer.releaseProbe(token).catch(() => {});
      if (probeToken.current === token) probeToken.current = null;
      if (alive.current && id === openingRequest.current) {
        openingBusy.current = false;
        setOpening(false);
      }
    }
  };
  const visibleTree = tree
    .filter(
      (row) =>
        (showHidden ||
          !row.path.split("/").some((part) => part.startsWith("."))) &&
        !collapsed.some(
          (path) =>
            row.path !== path &&
            row.path.startsWith(path === "/" ? "/" : path + "/"),
        ),
    )
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const treeFirst = Math.max(0, Math.floor(treeScroll / 36) - 8);
  return (
    <section
      className={`file-explorer ${desktop ? "home-desktop" : ""}`}
      aria-label={desktop ? "Desktop 파일" : "파일 탐색기"}
    >
      <div className="file-toolbar">
        <button
          disabled={!writable || busy || opening || !selected}
          onClick={() => {
            if (selected) setExecutionEntry(selected);
          }}
        >
          실행
        </button>
        <button
          disabled={!writable || busy || opening || picking || !page}
          onClick={() => {
            void transfer("upload");
          }}
        >
          업로드
        </button>
        <button
          disabled={
            !writable || busy || opening || picking || selection.length === 0
          }
          onClick={() => {
            void transfer("download");
          }}
        >
          다운로드
        </button>
        {opening && <button onClick={cancelOpen}>열기 취소</button>}
        <button disabled={!connected || opening} onClick={newWindow}>
          새 파일 창
        </button>
        <button
          disabled={!writable || busy || opening || !page}
          onClick={() => {
            if (page)
              setMutation({
                operation: "mkdir",
                token: page.directoryToken,
                name: "",
              });
          }}
        >
          새 폴더
        </button>
        <button
          disabled={
            !writable ||
            busy ||
            opening ||
            selectedRow?.type !== "file" ||
            !selected
          }
          onClick={() => {
            if (selectedRow && selected)
              setMutation({
                operation: "rename",
                token: selected,
                name: selectedRow.name,
              });
          }}
        >
          이름 변경
        </button>
        <button
          disabled={!writable || busy || opening || !selected}
          onClick={() => {
            if (selectedRow && selected)
              setMutation({
                operation: "delete",
                token: selected,
                name: selectedRow.name,
              });
          }}
        >
          삭제
        </button>
        <button
          disabled={!connected || busy || opening || !page?.parentToken}
          onClick={() => {
            if (page?.parentToken)
              void load(() => window.sshOS.file.list(page.parentToken!));
          }}
        >
          상위 폴더
        </button>
        <button
          disabled={!connected || busy || opening}
          onClick={() => {
            void load(() =>
              page
                ? window.sshOS.file.list(page.directoryToken)
                : window.sshOS.file.open(windowId),
            );
          }}
        >
          새로고침
        </button>
        <input
          aria-label="현재 목록 이름 필터"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setSelection([]);
            anchor.current = null;
            setScroll(0);
            if (viewport.current) viewport.current.scrollTop = 0;
          }}
          placeholder="현재 목록에서 이름 필터"
        />
      </div>
      <div className="file-location">
        {session
          ? `${session.username}@${session.host}:${session.port}`
          : "연결 끊김"}
        <code>
          {startFallback ? "SSH 시작 경로 · " : ""}
          {page?.path ?? "폴더 확인 중"}
        </code>
      </div>
      {!connected && (
        <p className="file-warning" role="status">
          연결 끊김 · 마지막 조회 {page?.listedAt ?? "없음"} · 다시 연결한 뒤
          파일 창을 다시 여세요.
        </p>
      )}
      {desktop && error && !page && (
        <p>
          홈 경로를 확인하지 못했습니다.{" "}
          <button
            onClick={() => {
              setStartFallback(true);
              void load(() => window.sshOS.file.openStart(windowId));
            }}
          >
            SSH 시작 경로 열기
          </button>
        </p>
      )}
      {!busy && page && filtered.length === 0 && (
        <p className="directory-empty">
          {filter
            ? "일치하는 항목이 없습니다."
            : rows.length
              ? "숨김 항목만 있습니다. Settings에서 숨김파일 보기를 켜세요."
              : "빈 폴더입니다."}
        </p>
      )}
      {error && (
        <ErrorPanel error={error} phase={null} target={page?.path ?? null} />
      )}
      <div className="file-panels">
        {!desktop && (
          <nav
            className="file-tree"
            aria-label="폴더 트리"
            onScroll={(event) => setTreeScroll(event.currentTarget.scrollTop)}
          >
            <div
              style={{ height: visibleTree.length * 36, position: "relative" }}
            >
              {visibleTree
                .slice(treeFirst, treeFirst + 100)
                .map((row, index) => (
                  <div
                    key={row.path}
                    style={{
                      position: "absolute",
                      top: (treeFirst + index) * 36,
                      left: Math.min(8, row.path.split("/").length - 1) * 10,
                      height: 36,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <button
                      aria-label={`${row.path} ${collapsed.includes(row.path) ? "펼치기" : "접기"}`}
                      onClick={() =>
                        setCollapsed((value) =>
                          value.includes(row.path)
                            ? value.filter((path) => path !== row.path)
                            : [...value, row.path],
                        )
                      }
                    >
                      {collapsed.includes(row.path) ? "▸" : "▾"}
                    </button>
                    <button
                      disabled={!connected || busy || opening}
                      title={row.path}
                      onClick={() => {
                        void load(() => window.sshOS.file.list(row.token));
                      }}
                    >
                      ▱ {row.name}
                    </button>
                  </div>
                ))}
            </div>
          </nav>
        )}
        <div className="file-table">
          {!desktop && (
            <div className="file-columns">
              <span>이름</span>
              <span>크기</span>
              <span>종류</span>
            </div>
          )}
          <div
            ref={viewport}
            className="file-rows"
            onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
            role="list"
            aria-label="파일 목록"
          >
            <div
              style={{
                height: Math.ceil(filtered.length / columns) * rowHeight,
                position: "relative",
              }}
            >
              {visible.map((row, index) => (
                <button
                  key={row.entryToken ?? `${first + index}:${row.name}`}
                  role="listitem"
                  className={`file-row ${desktop ? "desktop-entry" : ""} ${row.entryToken && selection.includes(row.entryToken) ? "selected" : ""}`}
                  style={{
                    position: "absolute",
                    top:
                      Math.floor((first + index) / columns) * rowHeight +
                      (desktop ? 12 : 0),
                    height: desktop ? 120 : rowHeight,
                    left: desktop ? ((first + index) % columns) * 144 + 12 : 0,
                    width: desktop ? 120 : "100%",
                  }}
                  title={`${row.name} · mode ${row.mode === null ? "?" : (row.mode & 0o777).toString(8)}`}
                  aria-selected={Boolean(
                    row.entryToken && selection.includes(row.entryToken),
                  )}
                  onClick={(event) => select(row.entryToken, event)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (row.entryToken && connected && !busy && !opening) {
                      setSelection([row.entryToken]);
                      anchor.current = row.entryToken;
                      setContext({ x: event.clientX, y: event.clientY, row });
                    }
                  }}
                  onDoubleClick={() => open(row)}
                  onKeyDown={(event) => {
                    if (
                      (event.key === "ContextMenu" ||
                        (event.key === "F10" && event.shiftKey)) &&
                      row.entryToken
                    ) {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setSelection([row.entryToken]);
                      setContext({ x: rect.left + 16, y: rect.top + 16, row });
                      return;
                    }
                    if (
                      event.key === "Enter" &&
                      !event.nativeEvent.isComposing &&
                      event.keyCode !== 229
                    ) {
                      event.preventDefault();
                      open(row);
                    }
                  }}
                >
                  <span>
                    <i
                      aria-hidden="true"
                      className={
                        row.type === "directory" ? "entry-folder" : "entry-file"
                      }
                    >
                      {row.type === "directory"
                        ? ""
                        : row.type === "file"
                          ? "≡"
                          : "↗"}
                    </i>
                    <b>{row.name}</b>
                  </span>
                  {!desktop && (
                    <span>
                      {row.size === null ? "?" : row.size.toLocaleString()}
                    </span>
                  )}
                  {!desktop && (
                    <span>
                      {!row.operable && ["file", "directory"].includes(row.type)
                        ? "이름 미지원 · 조회만"
                        : row.type === "directory"
                          ? "폴더"
                          : row.type === "file"
                            ? "파일"
                            : row.type === "symlink"
                              ? "링크 · 조회만"
                              : "특수 · 조회만"}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {context &&
        createPortal(
          <FileContextMenu
            x={context.x}
            y={context.y}
            writable={writable}
            close={() => setContext(null)}
            open={() => void open(context.row)}
            remove={() =>
              setMutation({
                operation: "delete",
                token: context.row.entryToken!,
                name: context.row.name,
              })
            }
            rename={() =>
              setMutation({
                operation: "rename",
                token: context.row.entryToken!,
                name: context.row.name,
              })
            }
            properties={() => setProperties(context.row.entryToken!)}
          />,
          document.getElementById("root") ?? document.body,
        )}
      {properties &&
        createPortal(
          <FilePropertiesDialog
            token={properties}
            close={() => setProperties(null)}
          />,
          document.getElementById("root") ?? document.body,
        )}
      {executionEntry &&
        createPortal(
          <ExecutionDialog
            entryToken={executionEntry}
            directories={tree.map((row) => ({
              token: row.token,
              path: row.path,
            }))}
            close={() => setExecutionEntry(null)}
            started={openExecution}
          />,
          document.getElementById("root") ?? document.body,
        )}
      {transferId &&
        createPortal(
          <TransferDialog
            id={transferId}
            close={() => setTransferId(null)}
            started={(ids) => {
              void observeTransfers(ids);
            }}
          />,
          document.getElementById("root") ?? document.body,
        )}
      {mutation &&
        createPortal(
          <MutationDialog
            operation={mutation.operation}
            targetToken={mutation.token}
            initialName={mutation.name}
            close={() => setMutation(null)}
            started={(id) => {
              void observeMutation(id);
            }}
          />,
          document.getElementById("root") ?? document.body,
        )}
      {choice &&
        createPortal(
          <FileOpenChoice
            name={choice.name}
            path={choice.path}
            server={choice.server}
            downloadEnabled={Boolean(writable && !picking)}
            download={() => {
              const token = choice.entryToken;
              setChoice(null);
              void transfer("download", [token]);
            }}
            close={() => setChoice(null)}
            openText={() => {
              const token = choice.entryToken;
              setChoice(null);
              void openViewer(token, "text").catch((failure) => {
                if (alive.current) setError(explain(failure));
              });
            }}
          />,
          document.getElementById("root") ?? document.body,
        )}
      <output className="file-status" aria-live="polite">
        {opening
          ? "열기 형식 확인 중"
          : busy
            ? `읽는 중 · ${rows.length}개`
            : `${filtered.length}개 표시 / ${rows.length}개 조회 · ${selection.length}개 선택`}
        {page?.partial ? " · 일부 목록: 개수 또는 용량 한도 도달" : ""} · 마지막
        조회{" "}
        {page?.listedAt ? new Date(page.listedAt).toLocaleTimeString() : "없음"}
        {notice ? ` · ${notice}` : ""}
      </output>
    </section>
  );
}
