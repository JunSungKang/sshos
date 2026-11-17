import { WebPreviewPane } from "../web-preview/WebPreviewPane";
const logo = "./sshos-icon.png";
import { reportWindowLimit, WINDOW_LIST_EVENT } from "./window-limit";
import { errorCodeOf } from "../../../shared/errors";
import { WindowList } from "./WindowList";
import { SettingsPane } from "../settings/SettingsPane";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import {
  WindowManager,
  windowModelSchema,
  resizeBounds,
  type ResizeEdge,
  type Bounds,
  type WindowKind,
  type WindowModel,
} from "../../../shared/windows";
import type { RuntimeSnapshot } from "../../../shared/contracts";
import type { SessionView } from "../../../shared/session-contracts";
import { ProfileManager } from "../connections/ProfileManager";
import { FileExplorer } from "../file-explorer/FileExplorer";
import { ProbeStatus } from "../connections/ProbeStatus";
import { TerminalPane } from "../console/TerminalPane";
import { TerminalCloseDialog } from "../../TerminalCloseDialog";
import type { TerminalClosePreview } from "../../../shared/terminal-ui";
import { ExecutionPane } from "../execution/ExecutionPane";
import { ExecutionActionDialog } from "../../ExecutionActionDialog";
import type { ExecutionActionPreview } from "../../../shared/execution-ui";
import { TransferShelf } from "../transfers/TransferShelf";
import { TaskManager } from "../tasks/TaskManager";
import { ViewerPane } from "../viewers/ViewerPane";

const labels: Record<WindowKind, string> = {
  home: "홈",
  connections: "연결",
  files: "파일",
  text: "텍스트",
  image: "이미지",
  web: "웹 미리보기",
  execution: "실행 출력",
  terminal: "터미널",
  tasks: "작업",
  settings: "설정",
};
const icons: Record<WindowKind, string> = {
  home: "홈",
  connections: "▤",
  files: "▱",
  text: "≡",
  image: "▧",
  web: "◎",
  execution: "▷",
  terminal: "›_",
  tasks: "⇅",
  settings: "⚙",
};
const getArea = (): Bounds => ({
  x: 184,
  y: 48,
  width: Math.max(1, window.innerWidth - 184),
  height: Math.max(1, window.innerHeight - 156),
});

export function DesktopShell({
  snapshot,
  error,
}: {
  snapshot: RuntimeSnapshot | null;
  error: boolean;
}) {
  const [windowList, setWindowList] = useState(false);
  useEffect(() => {
    const show = () => setWindowList(true);
    window.addEventListener(WINDOW_LIST_EVENT, show);
    return () => window.removeEventListener(WINDOW_LIST_EVENT, show);
  }, []);
  const modeRequest = useRef(0);
  const nextId = useRef("");
  const openingWindows = useRef(new Set<string>());
  const manager = useRef<WindowManager | null>(null);
  if (!manager.current)
    manager.current = new WindowManager(getArea(), () => nextId.current);
  const [windows, setWindows] = useState<WindowModel[]>([]);
  const [titles, setTitles] = useState<
    Record<string, { name: string; serverName: string }>
  >({});
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [activeServer, setActiveServer] = useState<string | null>(null);
  const [terminalClose, setTerminalClose] = useState<{
    preview: TerminalClosePreview;
    windowId: string;
  } | null>(null);
  const [textClose, setTextClose] = useState<WindowModel | null>(null);
  const textCloseDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (textClose) textCloseDialog.current?.showModal();
  }, [textClose]);
  const [executionClose, setExecutionClose] = useState<{
    preview: ExecutionActionPreview;
    windowId: string;
  } | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (snapshot && snapshot.powerSequence > 0)
      setNotice("절전 전 연결을 종료했습니다. 서버에 다시 연결하세요.");
  }, [snapshot?.powerSequence]);
  useEffect(() => {
    let alive = true;
    void window.sshOS.session
      .selectActiveServer(activeServer)
      .catch(async () => {
        if (!alive) return;
        await window.sshOS.session.selectActiveServer(null).catch(() => {});
        if (alive && activeServer)
          setNotice(
            "활성 서버의 응답시간 측정을 시작하지 못했습니다. 서버를 다시 선택하세요.",
          );
      });
    return () => {
      alive = false;
    };
  }, [activeServer]);
  const [shellHydrated, setShellHydrated] = useState(false);
  const [preferredTerminal, setPreferredTerminal] = useState<string | null>(
    null,
  );
  const [displayMode, setDisplayMode] = useState<"desktop" | "console">(
    "desktop",
  );
  const initialSessionBatch = useRef(true);
  const [panel, setPanel] = useState<WindowKind | null>("connections");
  const [panelWindow, setPanelWindow] = useState<string | null>(null);
  const openedHomes = useRef(new Set<string>());
  useEffect(() => {
    let alive = true;
    void window.sshOS.desktop
      .getShellState()
      .then((value) => {
        if (alive) {
          setDisplayMode(value.mode);
          setActiveServer(value.selectedServerId);
          setShellHydrated(true);
        }
      })
      .catch(() => {
        if (alive) setShellHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (shellHydrated)
      void window.sshOS.desktop
        .updateShellState({ mode: displayMode, selectedServerId: activeServer })
        .catch(() => {});
  }, [displayMode, activeServer, shellHydrated]);
  const mirrored = useRef(new Map<string, string>());
  const update = () => {
    const rows = manager.current!.snapshot();
    setWindows(rows);
  };
  const restoreWindow = (id: string) => {
    const target = manager
      .current!.snapshot()
      .find((row) => row.windowId === id);
    if (target?.kind === "terminal") setPreferredTerminal(id);
    manager.current!.restore(id);
    update();
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`.internal-window[data-window-id="${id}"]`)
        ?.focus(),
    );
  };
  const openFor = async (
    kind: WindowKind,
    session?: SessionView,
    newWindow = false,
  ) => {
    if (kind === "files" && newWindow) {
      setPanel(null);
      setDisplayMode("desktop");
    }
    const openingKey = `${kind}:${session?.serverId}:${session?.generation}`;
    if (openingWindows.current.has(openingKey)) return;
    openingWindows.current.add(openingKey);
    try {
      if (["files", "terminal"].includes(kind) && session && !newWindow) {
        const previous = manager
          .current!.snapshot()
          .filter(
            (row) =>
              row.kind === kind &&
              row.serverId === session.serverId &&
              row.sessionGeneration === session.generation,
          )
          .sort((a, b) => b.lastFocusedSequence - a.lastFocusedSequence)[0];
        if (previous) {
          restoreWindow(previous.windowId);
          return;
        }
      }
      const registered = windowModelSchema.parse(
        await (kind === "terminal" && session?.sessionToken
          ? window.sshOS.terminal.open(session.sessionToken)
          : window.sshOS.desktop.registerWindow(
              kind,
              session?.sessionToken ?? undefined,
            )),
      );
      if (
        manager
          .current!.snapshot()
          .some((row) => row.windowId === registered.windowId)
      )
        manager.current!.restore(registered.windowId);
      else {
        nextId.current = registered.windowId;
        manager.current!.open(
          kind,
          registered.serverId,
          registered.sessionGeneration,
          registered.resourceId,
        );
      }
      if (kind === "terminal") setPreferredTerminal(registered.windowId);
      setNotice("");
      update();
    } catch (error) {
      reportWindowLimit(error);
      setNotice(
        "창을 열지 못했습니다. 연결 상태 또는 열린 창 수를 확인하세요.",
      );
    } finally {
      openingWindows.current.delete(openingKey);
    }
  };
  const openViewer = async (
    entryToken: string,
    kind: "text" | "image" | "web",
  ) => {
    setPanel(null);
    setDisplayMode("desktop");
    const registered = windowModelSchema.parse(
      await (kind === "web"
        ? window.sshOS.web.open(entryToken)
        : window.sshOS.viewer.open(entryToken, kind)),
    );
    try {
      if (
        manager
          .current!.snapshot()
          .some((row) => row.windowId === registered.windowId)
      )
        manager.current!.restore(registered.windowId);
      else {
        nextId.current = registered.windowId;
        manager.current!.open(
          kind,
          registered.serverId,
          registered.sessionGeneration,
          registered.resourceId,
        );
      }
      update();
    } catch (error) {
      if (
        !manager
          .current!.snapshot()
          .some((row) => row.windowId === registered.windowId)
      )
        await window.sshOS.desktop
          .closeWindow(registered.windowId)
          .catch(() => {});
      throw error;
    }
  };
  const addExecutionWindow = (registered: WindowModel) => {
    setPanel(null);
    setDisplayMode("desktop");
    if (
      manager
        .current!.snapshot()
        .some((row) => row.windowId === registered.windowId)
    )
      manager.current!.restore(registered.windowId);
    else {
      nextId.current = registered.windowId;
      manager.current!.open(
        "execution",
        registered.serverId,
        registered.sessionGeneration,
        registered.resourceId,
      );
    }
    update();
  };
  const reopenExecution = (id: string) => {
    void window.sshOS.execution
      .reopen(id)
      .then(addExecutionWindow)
      .catch((error) => {
        reportWindowLimit(error);
        setNotice(
          "출력 창을 열지 못했습니다. 열린 창 한도와 기록 상태를 확인하세요.",
        );
      });
  };
  const removeWindow = (id: string) => {
    manager.current!.close(id);
    mirrored.current.delete(id);
    setTitles((value) => {
      const next = { ...value };
      delete next[id];
      return next;
    });
    update();
  };
  const closeWindow = async (row: WindowModel) => {
    try {
      if (row.kind === "terminal") {
        const preview = await window.sshOS.terminal.previewClose(row.windowId);
        if (preview.active) {
          setTerminalClose({ preview, windowId: row.windowId });
          return;
        }
      }
      if (row.kind === "execution") {
        const preview = await window.sshOS.execution.previewAction(
          row.windowId,
          "close_window",
        );
        if (preview.active) {
          setExecutionClose({ preview, windowId: row.windowId });
          return;
        }
      }
      await window.sshOS.desktop.closeWindow(row.windowId);
      removeWindow(row.windowId);
    } catch (error) {
      if (errorCodeOf(error) === "TEXT_UNSAVED") {
        setTextClose(row);
        return;
      }
      setNotice("창을 닫지 못했습니다. 실행 상태를 확인한 뒤 다시 시도하세요.");
    }
  };
  useEffect(() => {
    let alive = true;
    void window.sshOS.desktop
      .getWindowSnapshot()
      .then((rows) => {
        if (!alive) return;
        if (rows.length) {
          manager.current!.restoreSnapshot(
            rows.map((row) => windowModelSchema.parse(row)),
          );
          update();
        } else {
          setPanel("connections");
          void openFor("connections");
        }
      })
      .catch(() => setNotice("작업 공간 상태를 불러오지 못했습니다."));
    const resized = () => {
      manager.current!.resizeArea(getArea());
      update();
    };
    window.addEventListener("resize", resized);
    const timer = setInterval(() => {
      const rows = manager.current!.snapshot();
      for (const row of rows) {
        const {
          kind: _kind,
          serverId: _server,
          sessionGeneration: _generation,
          resourceId: _resource,
          ...layout
        } = row;
        const serialized = JSON.stringify(layout);
        if (mirrored.current.get(row.windowId) === serialized) continue;
        mirrored.current.set(row.windowId, serialized);
        void window.sshOS.desktop.updateWindowLayout(layout).catch(() => {
          mirrored.current.delete(row.windowId);
        });
      }
    }, 250);
    const pollSessions = () => {
      void window.sshOS.session
        .list()
        .then((value) => {
          if (alive) setSessions(value.sessions);
        })
        .catch(() => {});
    };
    pollSessions();
    const poll = setInterval(pollSessions, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(poll);
      window.removeEventListener("resize", resized);
    };
  }, []);
  useEffect(() => {
    for (const session of sessions) {
      const key = `${session.serverId}:${session.generation}`;
      if (
        session.status === "connected" &&
        session.sessionToken &&
        !openedHomes.current.has(key)
      ) {
        openedHomes.current.add(key);
        for (const old of manager
          .current!.snapshot()
          .filter(
            (row) =>
              row.kind === "home" &&
              row.serverId === session.serverId &&
              row.sessionGeneration !== session.generation,
          )) {
          void window.sshOS.desktop
            .closeWindow(old.windowId)
            .then(() => removeWindow(old.windowId))
            .catch(() => {});
        }
        if (initialSessionBatch.current)
          setActiveServer((current) => current ?? session.serverId);
        else setActiveServer(session.serverId);
        setPanel((current) => (current === "connections" ? null : current));
        void openFor("home", session);
      }
    }
    if (sessions.length) initialSessionBatch.current = false;
  }, [sessions]);
  const selected = sessions.find((row) => row.serverId === activeServer);
  const currentConsole =
    windows.find(
      (row) =>
        row.kind === "terminal" &&
        row.serverId === activeServer &&
        row.windowId === preferredTerminal,
    ) ??
    windows
      .filter(
        (row) =>
          row.kind === "terminal" &&
          row.serverId === activeServer &&
          row.sessionGeneration === selected?.generation,
      )
      .sort((a, b) => b.lastFocusedSequence - a.lastFocusedSequence)[0];
  const attachRegistered = (registered: WindowModel, activate = true) => {
    if (
      manager
        .current!.snapshot()
        .some((row) => row.windowId === registered.windowId)
    )
      manager.current!.restore(registered.windowId);
    else {
      nextId.current = registered.windowId;
      manager.current!.open(
        registered.kind,
        registered.serverId,
        registered.sessionGeneration,
        registered.resourceId,
      );
    }
    if (activate) {
      setPanel(null);
      setDisplayMode("desktop");
    }
    update();
  };
  const openFolder = async (token: string) => {
    const request = modeRequest.current;
    const registered = windowModelSchema.parse(
      await window.sshOS.file.openFolder(token),
    );
    attachRegistered(registered, request === modeRequest.current);
  };
  const chooseMode = async (mode: "desktop" | "console") => {
    const request = ++modeRequest.current;
    setPanel(null);
    setDisplayMode(mode);
    if (mode !== "console") return;
    try {
      const current = await window.sshOS.session.list();
      if (request !== modeRequest.current) return;
      setSessions(current.sessions);
      const available = current.sessions.filter(
        (row) => row.status === "connected" && row.sessionToken,
      );
      const latest = activeServer
        ? current.sessions.find((row) => row.serverId === activeServer)
        : available.length === 1
          ? available[0]
          : undefined;
      if (latest && !activeServer) setActiveServer(latest.serverId);
      if (latest && currentConsole?.sessionGeneration !== latest.generation)
        setPreferredTerminal(null);
      if (
        latest?.status === "connected" &&
        latest.sessionToken &&
        !manager
          .current!.snapshot()
          .some(
            (row) =>
              row.kind === "terminal" &&
              row.serverId === latest.serverId &&
              row.sessionGeneration === latest.generation,
          )
      )
        await openFor("terminal", latest);
    } catch {
      setNotice("터미널 연결 상태를 확인하지 못했습니다. 다시 시도하세요.");
    }
  };
  const openPanel = async (kind: WindowKind) => {
    setPanel(kind);
    if (kind === "files") {
      if (!selected || selected.status !== "connected") return;
      await openFor(kind, selected);
      const row = manager
        .current!.snapshot()
        .filter(
          (row) =>
            row.kind === "files" &&
            row.serverId === selected.serverId &&
            row.sessionGeneration === selected.generation,
        )
        .sort((a, b) => b.lastFocusedSequence - a.lastFocusedSequence)[0];
      setPanelWindow(row?.windowId ?? null);
    } else await openFor(kind);
  };
  const isHidden = (row: WindowModel) =>
    ["connections", "settings", "tasks"].includes(row.kind)
      ? panel !== row.kind
      : row.kind === "files" &&
          panel === "files" &&
          row.windowId === panelWindow
        ? false
        : displayMode !== "desktop" || row.serverId !== activeServer;
  const foreground = windows
    .filter(
      (row) =>
        row.kind !== "home" &&
        row.kind !== "terminal" &&
        row.mode !== "minimized" &&
        !isHidden(row),
    )
    .sort((a, b) => b.lastFocusedSequence - a.lastFocusedSequence)[0]?.windowId;
  return (
    <main className={`desktop mode-${displayMode}`}>
      <aside className="sidebar">
        <div className="brand">
          <img src={logo} alt="" />
          <strong>
            sshOS<small>시오스</small>
          </strong>
        </div>
        <nav aria-label="주 메뉴">
          {(
            [
              ["connections", "Connect"],
              ["files", "sFTP"],
              ["settings", "Settings"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              aria-pressed={panel === kind}
              disabled={kind === "files" && selected?.status !== "connected"}
              onClick={() => {
                void openPanel(kind);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <strong>{selected?.serverName ?? "서버 선택 안 됨"}</strong>
          <span>
            {selected?.status === "connected"
              ? "연결됨"
              : selected?.status === "disconnected"
                ? "연결 끊김"
                : (selected?.status ?? "연결 대기")}
          </span>
          {selected?.status === "connected" && (
            <ProbeStatus
              value={snapshot?.probe}
              serverId={selected.serverId}
              generation={selected.generation}
            />
          )}
        </div>
      </aside>
      <header>
        <select
          className="active-server-select"
          aria-label="활성 서버"
          value={activeServer ?? ""}
          onChange={(event) => {
            modeRequest.current++;
            setPreferredTerminal(null);
            setActiveServer(event.target.value || null);
            setPanel(null);
          }}
        >
          <option value="">서버 선택</option>
          {sessions.map((row) => (
            <option key={row.serverId} value={row.serverId}>
              {row.serverName}
            </option>
          ))}
        </select>
        <nav className="mode-switch" aria-label="작업 모드">
          <button
            aria-pressed={displayMode === "desktop"}
            onClick={() => chooseMode("desktop")}
          >
            Desktop
          </button>
          <button
            aria-pressed={displayMode === "console"}
            onClick={() => chooseMode("console")}
          >
            Console
          </button>
        </nav>
      </header>
      <div className="desktop-area">
        {!selected && (
          <p className="workspace-empty">
            Connect에서 작업할 서버에 연결하세요.
          </p>
        )}
        {displayMode === "console" &&
          selected &&
          !windows.some(
            (row) =>
              row.kind === "terminal" &&
              row.serverId === selected.serverId &&
              row.sessionGeneration === selected.generation,
          ) && (
            <div className="workspace-empty">
              <p>터미널이 열려 있지 않습니다.</p>
              <button
                disabled={selected.status !== "connected"}
                onClick={() => {
                  void openFor("terminal", selected);
                }}
              >
                터미널 열기
              </button>
            </div>
          )}
        {windows.map((row) =>
          row.kind === "home" ? (
            <section
              key={row.windowId}
              className="desktop-home"
              hidden={
                displayMode !== "desktop" ||
                row.serverId !== activeServer ||
                row.sessionGeneration !== selected?.generation
              }
              inert={
                displayMode !== "desktop" ||
                row.serverId !== activeServer ||
                panel !== null
              }
            >
              <FileExplorer
                desktop
                openFolder={openFolder}
                windowId={row.windowId}
                generation={row.sessionGeneration!}
                {...(sessions.find(
                  (session) => session.serverId === row.serverId,
                )
                  ? {
                      session: sessions.find(
                        (session) => session.serverId === row.serverId,
                      )!,
                    }
                  : {})}
                newWindow={() => {
                  if (selected) void openFor("files", selected, true);
                }}
                openViewer={openViewer}
                openExecution={addExecutionWindow}
                storageHealthy={Boolean(
                  snapshot && snapshot.storage.status !== "unavailable",
                )}
              />
            </section>
          ) : row.kind === "terminal" ? (
            <section
              key={row.windowId}
              role="region"
              aria-label={`${titles[row.windowId]?.name ?? "터미널"} · ${sessions.find((s) => s.serverId === row.serverId)?.serverName ?? ""}`}
              data-terminal-window-id={row.windowId}
              className="console-workspace"
              hidden={
                displayMode !== "console" ||
                row.windowId !== currentConsole?.windowId
              }
              inert={
                displayMode !== "console" ||
                row.windowId !== currentConsole?.windowId ||
                panel !== null
              }
            >
              <div className="console-tabs">
                {windows
                  .filter(
                    (t) => t.kind === "terminal" && t.serverId === activeServer,
                  )
                  .map((t) => (
                    <div
                      className="console-tab"
                      data-active={t.windowId === row.windowId}
                      data-terminal-id={t.windowId}
                      key={t.windowId}
                    >
                      <button
                        className="console-tab-select"
                        data-window-id={t.windowId}
                        aria-pressed={t.windowId === row.windowId}
                        onClick={() => restoreWindow(t.windowId)}
                      >
                        {titles[t.windowId]?.name ?? "터미널"}
                        {t.sessionGeneration !== selected?.generation
                          ? " · 이전 연결"
                          : ""}
                      </button>
                      <button
                        className="console-tab-close"
                        aria-label={`${titles[t.windowId]?.name ?? "터미널"} 탭 닫기`}
                        title="탭 닫기"
                        onClick={() => {
                          void closeWindow(t);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                <button
                  onClick={() => {
                    if (selected) void openFor("terminal", selected, true);
                  }}
                >
                  새 터미널
                </button>
              </div>
              <TerminalPane
                windowId={row.windowId}
                visible={
                  displayMode === "console" &&
                  row.windowId === currentConsole?.windowId &&
                  panel === null
                }
                onName={(name, serverName) =>
                  setTitles((value) => ({
                    ...value,
                    [row.windowId]: { name, serverName },
                  }))
                }
              />
            </section>
          ) : (
            <WindowFrame
              blocked={
                panel !== null &&
                !(
                  ["connections", "settings", "tasks"].includes(row.kind) ||
                  (panel === "files" && row.windowId === panelWindow)
                )
              }
              hidden={isHidden(row)}
              overlay={
                ["connections", "settings", "tasks"].includes(row.kind) ||
                (row.windowId === panelWindow && panel === "files")
              }
              key={row.windowId}
              model={row}
              title={`${labels[row.kind]}${titles[row.windowId] ? ` / ${titles[row.windowId]!.name}` : ""}${row.serverId ? ` · ${sessions.find((session) => session.serverId === row.serverId)?.serverName ?? titles[row.windowId]?.serverName ?? "연결 끊김"}` : ""}`}
              focus={() => {
                manager.current!.focus(row.windowId);
                update();
              }}
              minimize={() => {
                manager.current!.minimize(row.windowId);
                update();
              }}
              maximize={() => {
                manager.current!.toggleMaximize(row.windowId);
                update();
              }}
              move={(bounds) => {
                manager.current!.moveResize(row.windowId, bounds);
                update();
              }}
              close={() => {
                if (
                  ["connections", "settings", "tasks"].includes(row.kind) ||
                  (panel === "files" && row.windowId === panelWindow)
                )
                  setPanel(null);
                else void closeWindow(row);
              }}
            >
              {row.kind === "web" ? (
                <WebPreviewPane
                  windowId={row.windowId}
                  visible={
                    foreground === row.windowId &&
                    row.mode !== "minimized" &&
                    displayMode === "desktop" &&
                    !panel
                  }
                />
              ) : row.kind === "execution" ? (
                <ExecutionPane
                  windowId={row.windowId}
                  visible={row.mode !== "minimized"}
                  onName={(name, serverName) =>
                    setTitles((value) => ({
                      ...value,
                      [row.windowId]: { name, serverName },
                    }))
                  }
                />
              ) : row.kind === "text" || row.kind === "image" ? (
                <ViewerPane
                  windowId={row.windowId}
                  kind={row.kind}
                  onName={(name, serverName) =>
                    setTitles((value) => ({
                      ...value,
                      [row.windowId]: { name, serverName },
                    }))
                  }
                  {...(sessions.find(
                    (session) => session.serverId === row.serverId,
                  )
                    ? {
                        session: sessions.find(
                          (session) => session.serverId === row.serverId,
                        )!,
                      }
                    : {})}
                />
              ) : row.kind === "files" ? (
                <FileExplorer
                  openExecution={addExecutionWindow}
                  storageHealthy={Boolean(
                    snapshot && snapshot.storage.status !== "unavailable",
                  )}
                  openViewer={openViewer}
                  newWindow={() => {
                    const session = sessions.find(
                      (value) => value.serverId === row.serverId,
                    );
                    if (session) void openFor("files", session, true);
                  }}
                  windowId={row.windowId}
                  generation={row.sessionGeneration!}
                  {...(sessions.find(
                    (session) => session.serverId === row.serverId,
                  )
                    ? {
                        session: sessions.find(
                          (session) => session.serverId === row.serverId,
                        )!,
                      }
                    : {})}
                />
              ) : row.kind === "connections" ? (
                <ProfileManager
                  disabled={
                    !snapshot || snapshot.storage.status === "unavailable"
                  }
                />
              ) : row.kind === "settings" ? (
                <SettingsPane
                  version={snapshot?.appVersion ?? "0.1.0"}
                  visible={panel === "settings"}
                />
              ) : row.kind === "tasks" ? (
                <TaskManager openExecution={reopenExecution} />
              ) : (
                <section className="app-content">
                  <h2>{labels[row.kind]}</h2>
                  <p>서버 연결과 기능 지원 상태를 확인하세요.</p>
                </section>
              )}
            </WindowFrame>
          ),
        )}
        {notice && (
          <p className="desktop-notice" role="alert">
            {notice}
          </p>
        )}
        {snapshot?.storage.status === "unavailable" && (
          <div className="storage-error" role="alert">
            <p>
              앱 데이터를 읽지 못했습니다. 기존 데이터를 초기화하지 않고 변경
              기능을 잠갔습니다.
            </p>
            <p>{snapshot.storage.path}</p>
            <button
              onClick={() => {
                void window.sshOS.settings
                  .retryStorage()
                  .catch(() => setNotice("저장소를 다시 확인하지 못했습니다."));
              }}
            >
              저장소 다시 확인
            </button>
          </div>
        )}
        <div className="engine-state">
          <output aria-live="polite" data-testid="engine-state">
            {error
              ? "앱 상태를 확인하지 못했습니다."
              : snapshot?.engine === "ready"
                ? "연결 엔진 준비됨"
                : snapshot?.engine === "stopped"
                  ? "연결 엔진이 종료됐습니다."
                  : "연결 엔진 시작 중"}
          </output>
          {snapshot?.engine === "stopped" && (
            <button
              disabled={engineBusy}
              onClick={() => {
                setEngineBusy(true);
                void window.sshOS.lifecycle
                  .restartEngine()
                  .catch(() =>
                    setNotice(
                      "연결 엔진을 다시 시작하지 못했습니다. 다시 시도하세요.",
                    ),
                  )
                  .finally(() => setEngineBusy(false));
              }}
            >
              연결 엔진 다시 시작
            </button>
          )}
        </div>
      </div>
      {windowList && (
        <WindowList
          rows={windows.filter((row) => row.kind !== "home")}
          title={(row) =>
            `${titles[row.windowId]?.name ?? labels[row.kind]}${row.serverId ? " · " + (sessions.find((session) => session.serverId === row.serverId)?.serverName ?? titles[row.windowId]?.serverName ?? "연결 끊김") : ""}`
          }
          dismiss={() => setWindowList(false)}
          select={(id) => {
            const row = windows.find((value) => value.windowId === id);
            if (!row) return;
            modeRequest.current++;
            setWindowList(false);
            if (row.serverId) setActiveServer(row.serverId);
            if (["connections", "settings", "tasks"].includes(row.kind))
              setPanel(row.kind);
            else {
              setPanel(null);
              setDisplayMode(row.kind === "terminal" ? "console" : "desktop");
            }
            restoreWindow(id);
          }}
          closeWindow={(row) => {
            setWindowList(false);
            void closeWindow(row);
          }}
        />
      )}
      {snapshot?.closing && (
        <div className="shutdown-overlay" role="status">
          작업 정리 후 종료 중 · 승인 후 최대10초
        </div>
      )}
      {textClose && (
        <dialog
          ref={textCloseDialog}
          className="connection-dialog"
          aria-label="텍스트 창 닫기 확인"
          onCancel={() => setTextClose(null)}
        >
          <h2>편집 내용을 버리고 닫을까요?</h2>
          <p>저장하지 않은 편집 내용은 사라집니다.</p>
          <button onClick={() => setTextClose(null)}>계속 편집</button>
          <button
            onClick={() => {
              const target = textClose;
              void window.sshOS.viewer
                .discardEditing(target.windowId)
                .then(() => window.sshOS.desktop.closeWindow(target.windowId))
                .then(() => {
                  removeWindow(target.windowId);
                  setTextClose(null);
                })
                .catch(() => setNotice("텍스트 창을 닫지 못했습니다."));
            }}
          >
            변경 버리고 닫기
          </button>
        </dialog>
      )}
      {terminalClose && (
        <TerminalCloseDialog
          preview={terminalClose.preview}
          close={() => setTerminalClose(null)}
          done={() => removeWindow(terminalClose.windowId)}
        />
      )}
      {executionClose && (
        <ExecutionActionDialog
          preview={executionClose.preview}
          close={() => setExecutionClose(null)}
          hidden={() => removeWindow(executionClose.windowId)}
        />
      )}
      <TransferShelf
        openTasks={() => {
          void openPanel("tasks");
        }}
      />
      {displayMode === "desktop" && (
        <footer className="taskbar">
          {windows
            .filter(
              (row) =>
                ![
                  "home",
                  "terminal",
                  "connections",
                  "settings",
                  "tasks",
                ].includes(row.kind) && row.serverId === activeServer,
            )
            .map((row) => (
              <button
                className={row.focused ? "active" : ""}
                data-window-id={row.windowId}
                key={row.windowId}
                onClick={() => restoreWindow(row.windowId)}
              >
                {icons[row.kind]}{" "}
                {titles[row.windowId]?.name ?? labels[row.kind]}
              </button>
            ))}
        </footer>
      )}
    </main>
  );
}

function WindowFrame({
  hidden = false,
  overlay = false,
  blocked = false,
  model,
  title,
  focus,
  minimize,
  maximize,
  close,
  move,
  children,
}: {
  hidden?: boolean;
  overlay?: boolean;
  blocked?: boolean;
  model: WindowModel;
  title: string;
  focus(): void;
  minimize(): void;
  maximize(): void;
  close(): void;
  move(bounds: Bounds): void;
  children: React.ReactNode;
}) {
  const drag = useRef<{
    x: number;
    y: number;
    bounds: Bounds;
    edge: ResizeEdge | null;
    pointer: number;
  } | null>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [keyboard, setKeyboard] = useState<{
    kind: "move" | "resize";
    start: Bounds;
  } | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (
      !hidden &&
      !blocked &&
      model.focused &&
      root.current &&
      !root.current.contains(document.activeElement)
    )
      root.current.focus();
  }, [model.focused, hidden, blocked]);
  const begin = (event: PointerEvent<HTMLElement>, edge: ResizeEdge | null) => {
    if (
      overlay ||
      model.mode !== "normal" ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest("button")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      bounds: { ...model.bounds },
      edge,
      pointer: event.pointerId,
    };
  };
  const flush = () => {
    frame.current = null;
    const current = drag.current;
    const point = latest.current;
    if (!current || !point) return;
    const dx = point.x - current.x;
    const dy = point.y - current.y;
    move(
      current.edge
        ? resizeBounds(
            current.bounds,
            current.edge,
            dx,
            dy,
            model.kind,
            getArea(),
          )
        : {
            ...current.bounds,
            x: current.bounds.x + dx,
            y: current.bounds.y + dy,
          },
    );
  };
  const pointerMove = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    latest.current = { x: event.clientX, y: event.clientY };
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  };
  const end = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      flush();
    }
    drag.current = null;
    latest.current = null;
  };
  useEffect(() => {
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("blur", end);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);
  const tab = (event: KeyboardEvent) => {
    if (
      event.key !== "Tab" ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      keyboard ||
      (event.target as HTMLElement).closest("dialog[open],.terminal-host")
    )
      return;
    const controls = [
      ...root.current!.querySelectorAll<HTMLElement>(
        "button,input,select,textarea,a[href],[tabindex]",
      ),
    ].filter(
      (node) =>
        node.tabIndex >= 0 &&
        !node.matches(":disabled") &&
        node.getClientRects().length > 0 &&
        !node.closest("[inert]"),
    );
    const index = controls.indexOf(document.activeElement as HTMLElement),
      next = event.shiftKey ? index - 1 : index + 1;
    event.preventDefault();
    if (index < 0 && !event.shiftKey) {
      controls[0]?.focus();
      return;
    }
    if (next >= 0 && next < controls.length) {
      controls[next]!.focus();
      return;
    }
    if (overlay) {
      (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
      return;
    }
    document
      .querySelector<HTMLElement>(
        `.taskbar [data-window-id="${model.windowId}"]`,
      )
      ?.focus();
  };
  const key = (event: KeyboardEvent) => {
    if (overlay && event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!keyboard) return;
    if (event.key === "Escape") {
      event.preventDefault();
      move(keyboard.start);
      setKeyboard(null);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      setKeyboard(null);
      return;
    }
    if (
      !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
    )
      return;
    event.preventDefault();
    const amount = event.shiftKey ? 1 : 10;
    const dx =
      event.key === "ArrowLeft"
        ? -amount
        : event.key === "ArrowRight"
          ? amount
          : 0;
    const dy =
      event.key === "ArrowUp"
        ? -amount
        : event.key === "ArrowDown"
          ? amount
          : 0;
    move(
      keyboard.kind === "move"
        ? { ...model.bounds, x: model.bounds.x + dx, y: model.bounds.y + dy }
        : {
            ...model.bounds,
            width: Math.max(1, model.bounds.width + dx),
            height: Math.max(1, model.bounds.height + dy),
          },
    );
  };
  return (
    <section
      ref={root}
      data-window-id={model.windowId}
      hidden={hidden}
      className={`internal-window ${overlay ? "navigation-window" : ""} ${model.focused ? "focused" : ""} ${model.mode === "minimized" ? "is-minimized" : ""}`}
      aria-label={title}
      role="region"
      tabIndex={-1}
      aria-hidden={model.mode === "minimized"}
      inert={hidden || blocked || model.mode === "minimized"}
      onKeyDownCapture={tab}
      onKeyDown={key}
      onFocusCapture={() => {
        if (!model.focused) focus();
      }}
      onPointerDown={focus}
      style={{
        position: "fixed",
        left: model.bounds.x,
        top: model.bounds.y,
        width: model.bounds.width,
        height: model.bounds.height,
        zIndex: overlay ? 100000 : 10 + model.lastFocusedSequence,
      }}
    >
      <div
        className="window-title"
        onPointerDown={(event) => begin(event, null)}
        onPointerMove={pointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) maximize();
        }}
      >
        <button
          hidden={overlay}
          aria-label={`${title} 창 메뉴`}
          onClick={() => setMenu(!menu)}
        >
          ⋮
        </button>
        <strong>{title}</strong>
        <button aria-label={`${title} 최소화`} onClick={minimize}>
          −
        </button>
        <button aria-label={`${title} 최대화 또는 복원`} onClick={maximize}>
          □
        </button>
        <button aria-label={`${title} 닫기`} onClick={close}>
          ×
        </button>
      </div>
      {menu && (
        <menu className="window-menu">
          <li>
            <button
              onClick={() => {
                setKeyboard({ kind: "move", start: { ...model.bounds } });
                setMenu(false);
                root.current?.focus();
              }}
            >
              이동
            </button>
          </li>
          <li>
            <button
              onClick={() => {
                setKeyboard({ kind: "resize", start: { ...model.bounds } });
                setMenu(false);
                root.current?.focus();
              }}
            >
              크기 조절
            </button>
          </li>
        </menu>
      )}
      <div className="window-body">{children}</div>
      {model.mode === "normal" &&
        (["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeEdge[]).map(
          (edge) => (
            <div
              key={edge}
              className={`window-resize edge-${edge}`}
              aria-hidden="true"
              onPointerDown={(event) => begin(event, edge)}
              onPointerMove={pointerMove}
              onPointerUp={end}
              onPointerCancel={end}
            />
          ),
        )}
    </section>
  );
}
