import { createPortal } from "react-dom";
import { ErrorPanel } from "../../ErrorPanel";
import { errorCodeOf } from "../../../shared/errors";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type {
  TerminalDescriptor,
  TerminalPastePreview,
} from "../../../shared/terminal-ui";
import { terminalSize } from "../../../shared/terminals";
import { TerminalInputQueue } from "./terminal-input-queue";
import { secureTerminal } from "../../terminal-security";
import {
  registerTerminalClipboard,
  requestNativePaste,
} from "../../terminal-clipboard";
import { TerminalPasteDialog } from "./TerminalPasteDialog";
import { scheduleViewerFrame } from "../viewers/viewer-stream-scheduler";
import { registerTerminalDisplayGuard } from "../../terminal-display-guard";
import { usePreferences } from "../settings/preferences";
import { getTheme, terminalTheme } from "../../../shared/themes";
type Instance = { terminal: Terminal; fit: FitAddon; dispose(): void };
export function TerminalPane({
  windowId,
  visible,
  onName,
}: {
  windowId: string;
  visible: boolean;
  onName(name: string, serverName: string): void;
}) {
  const preferences = usePreferences(),
    theme = getTheme(preferences?.theme ?? "chocolate"),
    themeRef = useRef(theme);
  themeRef.current = theme;
  const memoryBlocked = useRef(false);
  const host = useRef<HTMLDivElement>(null),
    instance = useRef<Instance | null>(null),
    data = useRef<TerminalDescriptor | null>(null),
    queue = useRef<TerminalInputQueue | null>(null),
    alive = useRef(true),
    phase = useRef<"starting" | "restoring" | "live" | "failed">("starting"),
    flow = useRef(0),
    restoreKey = useRef(""),
    cursor = useRef(0),
    pulling = useRef(false),
    pasteBusy = useRef(false),
    pasteHold = useRef(false),
    writing = useRef(false),
    pasteValue = useRef<TerminalPastePreview | null>(null),
    overflow = useRef(false),
    writes = useRef(new Set<() => void>()),
    resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    pendingValue = useRef(0),
    metadata = useRef<() => Promise<void>>(async () => {}),
    show = useRef(visible);
  show.current = visible;
  const [descriptor, setDescriptor] = useState<TerminalDescriptor | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(0),
    [paste, setPaste] = useState<TerminalPastePreview | null>(null),
    [menu, setMenu] = useState(false);
  const syncInput = () => {
    const ready =
      phase.current === "live" && data.current?.inputAllowed === true;
    queue.current?.setEnabled(ready && !pasteHold.current);
    if (instance.current) {
      instance.current.terminal.options.disableStdin =
        !ready || overflow.current;
      if (instance.current.terminal.textarea)
        instance.current.terminal.textarea.disabled =
          !show.current || !ready || pasteBusy.current || overflow.current;
    }
  };
  const disposeTerminal = () => {
    for (const cancel of [...writes.current]) cancel();
    writes.current.clear();
    instance.current?.dispose();
    instance.current = null;
  };
  const paused = () => {
    phase.current = "failed";
    syncInput();
  };
  const blockDisplay = () => {
    memoryBlocked.current = true;
    flow.current++;
    paused();
    disposeTerminal();
    const lost =
      queue.current?.reset(data.current?.nextInputSequence ?? 1) ?? 0;
    if (lost) setNotice(`대기 입력 ${lost}byte를 재전송하지 않았습니다.`);
    pasteBusy.current = false;
    pasteHold.current = false;
    pasteValue.current = null;
    setPaste(null);
    setMenu(false);
    setError("DISPLAY_LIMIT");
  };
  useEffect(() => registerTerminalDisplayGuard(blockDisplay), [windowId]);
  const applySize = () => {
    const current = instance.current,
      value = data.current;
    if (
      !current ||
      !show.current ||
      !host.current?.clientWidth ||
      !host.current.clientHeight
    )
      return;
    const dimensions = current.fit.proposeDimensions();
    if (!dimensions) return;
    const size = terminalSize(dimensions.cols, dimensions.rows);
    if (
      current.terminal.cols !== size.cols ||
      current.terminal.rows !== size.rows
    )
      current.terminal.resize(size.cols, size.rows);
    if (resizeTimer.current) clearTimeout(resizeTimer.current);
    resizeTimer.current = setTimeout(() => {
      resizeTimer.current = null;
      const latest = data.current;
      if (
        latest?.terminalToken === value?.terminalToken &&
        latest?.status === "ready" &&
        latest.runtime.execution.active
      )
        void window.sshOS.terminal
          .resize(latest.terminalToken, size.cols, size.rows)
          .catch(() => {});
    }, 100);
  };
  const finishPaste = async () => {
    if (pasteHold.current) {
      try {
        const latest = await window.sshOS.terminal.get(windowId);
        if (alive.current) {
          data.current = latest;
          setDescriptor(latest);
          queue.current?.synchronize(latest.nextInputSequence);
        }
      } catch (failure) {
        paused();
        if (alive.current) setError(errorCodeOf(failure));
      }
    }
    pasteBusy.current = false;
    pasteHold.current = false;
    pasteValue.current = null;
    if (alive.current) setPaste(null);
    syncInput();
    if (show.current) instance.current?.terminal.focus();
  };
  const sendPaste = async (preview: TerminalPastePreview) => {
    try {
      await window.sshOS.terminal.paste(
        preview.confirmationToken,
        instance.current?.terminal.modes.bracketedPasteMode ?? false,
      );
      await finishPaste();
    } catch (failure) {
      setError(errorCodeOf(failure));
      await finishPaste();
      throw failure;
    }
  };
  const preparePaste = async (
    value: TerminalDescriptor,
    text: string,
    owned = false,
  ) => {
    if (!text) {
      if (owned) await finishPaste();
      return;
    }
    if (!owned) {
      if (pasteBusy.current || !value.inputAllowed) return;
      pasteBusy.current = true;
      syncInput();
    }
    try {
      await queue.current?.settled();
      if (
        !alive.current ||
        data.current?.terminalToken !== value.terminalToken ||
        !data.current.inputAllowed
      )
        throw new Error("REQUEST_CANCELLED");
      pasteHold.current = true;
      syncInput();
      const preview = await window.sshOS.terminal.previewPaste(
        value.terminalToken,
        text,
      );
      if (
        !alive.current ||
        data.current?.terminalToken !== value.terminalToken
      ) {
        await window.sshOS.terminal.releasePaste(preview.confirmationToken);
        throw new Error("REQUEST_CANCELLED");
      }
      pasteValue.current = preview;
      if (preview.requiresConfirmation) setPaste(preview);
      else await sendPaste(preview);
    } catch (failure) {
      if (alive.current) {
        setError(errorCodeOf(failure));
        await finishPaste();
      }
    }
  };
  const nativePaste = async () => {
    if (!show.current) return;
    const value = data.current;
    if (!value?.inputAllowed || pasteBusy.current) return;
    pasteBusy.current = true;
    syncInput();
    try {
      await requestNativePaste(
        () => window.sshOS.terminal.requestPaste(value.terminalToken),
        (text) => preparePaste(value, text, true),
      );
    } catch (failure) {
      if (alive.current) {
        setError(errorCodeOf(failure));
        await finishPaste();
      }
    }
  };
  const copy = () => {
    const current = instance.current?.terminal;
    if (!current?.hasSelection()) return;
    current.focus();
    if (!document.execCommand("copy")) setError("CLIPBOARD_FAILED");
  };
  const write = async (current: Instance, bytes: Uint8Array, version: number) =>
    new Promise<void>((resolve, reject) => {
      let finished = false;
      const done = (error?: Error) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          writes.current.delete(cancel);
          if (error) reject(error);
          else resolve();
        },
        cancel = () => done(new Error("REQUEST_CANCELLED")),
        timer = setTimeout(() => done(new Error("RENDER_TIMEOUT")), 5000);
      writes.current.add(cancel);
      writing.current = true;
      current.terminal.write(bytes, () => {
        writing.current = false;
        if (
          !alive.current ||
          instance.current !== current ||
          flow.current !== version
        )
          done(new Error("REQUEST_CANCELLED"));
        else done();
      });
    });
  const create = () => {
    disposeTerminal();
    const terminal = new Terminal({
        cols: 80,
        rows: 24,
        scrollback: 2000,
        disableStdin: true,
        allowProposedApi: false,
        fontSize: 14,
        lineHeight: 1.3,
        fontFamily: "ui-monospace, monospace",
        theme: terminalTheme(themeRef.current),
        linkHandler: { activate: () => {} },
      }),
      fit = new FitAddon();
    terminal.loadAddon(fit);
    const security = secureTerminal(terminal, () => {
      if (alive.current)
        setNotice("반복 출력 한도 초과 · REP500 초과 요청을 무시했습니다.");
    });
    const bindings = [
      terminal.onData((text) => {
        if (
          phase.current === "live" &&
          data.current?.inputAllowed &&
          (!pasteBusy.current || writing.current) &&
          !overflow.current
        )
          queue.current?.enqueue(new TextEncoder().encode(text));
      }),
      terminal.onBinary((text) => {
        if (
          show.current &&
          phase.current === "live" &&
          data.current?.inputAllowed &&
          (!pasteBusy.current || writing.current) &&
          !overflow.current
        )
          queue.current?.enqueue(
            Uint8Array.from(text, (char) => char.charCodeAt(0) & 255),
          );
      }),
    ];
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (!show.current) {
        event.preventDefault();
        return false;
      }
      if (pasteBusy.current) {
        event.preventDefault();
        return false;
      }
      const mac = navigator.platform.toLowerCase().includes("mac"),
        modified = mac ? event.metaKey : event.ctrlKey && event.shiftKey;
      if (modified && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copy();
        return false;
      }
      if (modified && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void nativePaste();
        return false;
      }
      return true;
    });
    terminal.open(host.current!);
    terminal.textarea?.setAttribute("aria-label", "원격 터미널 입력");
    const stopClipboard = registerTerminalClipboard(host.current!, (text) => {
      if (!show.current) return;
      const value = data.current;
      if (value) return preparePaste(value, text);
    });
    const context = (event: MouseEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setMenu(true);
    };
    host.current!.addEventListener("contextmenu", context, true);
    const value: Instance = {
      terminal,
      fit,
      dispose: () => {
        for (const binding of bindings) binding.dispose();
        security.dispose();
        stopClipboard();
        host.current?.removeEventListener("contextmenu", context, true);
        terminal.dispose();
      },
    };
    instance.current = value;
    applySize();
    return value;
  };
  const restore = async (value: TerminalDescriptor) => {
    const frozen = value.restore;
    if (!frozen || memoryBlocked.current) return;
    const version = ++flow.current;
    phase.current = "restoring";
    syncInput();
    const discarded = queue.current?.reset(frozen.nextInputSequence) ?? 0;
    if (discarded)
      setNotice(`복구 전 대기 입력 ${discarded}byte는 재전송하지 않았습니다.`);
    if (frozen.omitted)
      setNotice(
        "이전 출력이 잘렸습니다. 화면 복구가 불완전할 수 있습니다. 새 표시 시작으로 history를 비울 수 있습니다.",
      );
    const current = create();
    let position = frozen.startOffset;
    try {
      while (position < frozen.endOffset) {
        if (!alive.current || flow.current !== version)
          throw new Error("REQUEST_CANCELLED");
        const frame = await scheduleViewerFrame(() =>
          window.sshOS.terminal.next(
            value.outputToken,
            value.readGeneration,
            position,
          ),
        );
        if (frame.status === "waiting") {
          await new Promise((done) => setTimeout(done, 32));
          continue;
        }
        if (frame.batch.gap || frame.batch.omitted)
          setNotice("이전 출력 생략 · 화면 복구가 불완전할 수 있습니다.");
        if (frame.batch.nextOffset <= position)
          throw new Error("RESTORE_FAILED");
        for (const part of frame.batch.frames)
          await write(current, part.bytes, version);
        position = frame.batch.nextOffset;
      }
      if (!alive.current || flow.current !== version)
        throw new Error("REQUEST_CANCELLED");
      await window.sshOS.terminal.restoreAck(
        value.terminalToken,
        frozen.restoreToken,
        position,
      );
      if (!alive.current || flow.current !== version) return;
      cursor.current = position;
      phase.current = "live";
      await metadata.current();
      syncInput();
      applySize();
      if (show.current) current.terminal.focus();
    } catch (failure) {
      if (!alive.current || flow.current !== version) return;
      paused();
      setError(errorCodeOf(failure));
      void window.sshOS.terminal.pause(value.terminalToken).catch(() => {});
    }
  };
  const accept = (value: TerminalDescriptor) => {
    if (
      memoryBlocked.current &&
      value.status !== "blocked" &&
      value.status !== "disconnected"
    )
      return;
    const previous = data.current;
    data.current = value;
    setDescriptor(value);
    onName(value.name, value.runtime.execution.receipt.endpointSnapshot.name);
    if (value.status === "blocked") {
      blockDisplay();
      return;
    }
    if (value.status === "disconnected" || value.status === "unavailable") {
      phase.current = "failed";
      syncInput();
      if (value.status === "disconnected") {
        setError("");
        const lost = queue.current?.reset(value.nextInputSequence) ?? 0;
        if (lost)
          setNotice(
            `연결 해제 전 대기 입력 ${lost}byte는 전송하지 않았습니다.`,
          );
      }
      return;
    }
    if (value.restore && restoreKey.current !== value.restore.restoreToken) {
      restoreKey.current = value.restore.restoreToken;
      setError("");
      void restore(value);
      return;
    }
    if (previous?.terminalToken !== value.terminalToken && !value.restore)
      phase.current = "failed";
    syncInput();
  };
  useEffect(() => {
    alive.current = true;
    queue.current = new TerminalInputQueue(
      async (sequence, bytes) => {
        const value = data.current;
        if (!value) throw new Error("TOKEN_EXPIRED");
        return window.sshOS.terminal.input(
          value.terminalToken,
          sequence,
          bytes,
        );
      },
      (count) => {
        pendingValue.current = count;
        if (count === 0) {
          overflow.current = false;
          if (pendingTimer.current) clearTimeout(pendingTimer.current);
          pendingTimer.current = null;
          if (alive.current) setPending(0);
          syncInput();
        } else
          pendingTimer.current ??= setTimeout(() => {
            pendingTimer.current = null;
            if (alive.current) setPending(pendingValue.current);
          }, 100);
      },
      (message) => {
        if (!alive.current) return;
        setError(
          message.includes("\uD55C\uB3C4")
            ? "INPUT_LIMIT"
            : "INPUT_RESULT_UNKNOWN",
        );
        setNotice(message);
        if (message.includes("한도")) overflow.current = true;
        else {
          paused();
          const value = data.current;
          if (value)
            void window.sshOS.terminal
              .pause(value.terminalToken)
              .catch(() => {});
        }
        syncInput();
      },
    );
    let polling = false;
    metadata.current = async () => {
      if (polling || !alive.current) return;
      polling = true;
      try {
        const value = await window.sshOS.terminal.get(windowId);
        if (alive.current) accept(value);
      } catch (failure) {
        if (alive.current) {
          paused();
          setError(errorCodeOf(failure));
        }
      } finally {
        polling = false;
      }
    };
    void metadata.current();
    const timer = setInterval(() => {
        void metadata.current();
      }, 1000),
      observer = new ResizeObserver(applySize);
    if (host.current) observer.observe(host.current);
    return () => {
      alive.current = false;
      flow.current++;
      clearInterval(timer);
      observer.disconnect();
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      queue.current?.dispose();
      disposeTerminal();
      if (pasteValue.current)
        void window.sshOS.terminal
          .releasePaste(pasteValue.current.confirmationToken)
          .catch(() => {});
    };
  }, [windowId]);
  useEffect(() => {
    syncInput();
    applySize();
    if (visible) instance.current?.terminal.focus();
  }, [visible]);
  useEffect(() => {
    if (instance.current)
      instance.current.terminal.options.theme = terminalTheme(theme);
  }, [theme]);
  useEffect(() => {
    let stopped = false;
    const pull = async () => {
      if (
        stopped ||
        pulling.current ||
        phase.current !== "live" ||
        !data.current ||
        !instance.current
      )
        return;
      const value = data.current,
        current = instance.current,
        version = flow.current;
      pulling.current = true;
      try {
        const frame = await scheduleViewerFrame(() => {
          if (stopped || phase.current !== "live" || version !== flow.current)
            throw new Error("REQUEST_CANCELLED");
          return window.sshOS.terminal.next(
            value.outputToken,
            value.readGeneration,
            cursor.current,
          );
        });
        if (stopped || version !== flow.current || instance.current !== current)
          return;
        if (frame.status === "waiting") return;
        if (
          data.current?.terminalToken === value.terminalToken &&
          data.current.inputAllowed !== frame.inputAllowed
        ) {
          data.current = {
            ...data.current,
            inputAllowed: frame.inputAllowed,
            ...(frame.inputAllowed
              ? {
                  status: "ready" as const,
                  restore: null,
                  runtime: {
                    ...data.current.runtime,
                    execution: {
                      ...data.current.runtime.execution,
                      receipt: {
                        ...data.current.runtime.execution.receipt,
                        channelAccepted: true,
                      },
                    },
                  },
                }
              : {}),
          };
          setDescriptor(data.current);
          syncInput();
          if (frame.inputAllowed) applySize();
        }
        if (frame.batch.gap || frame.batch.omitted)
          setNotice("이전 출력 생략 · 표시 history 한도에 도달했습니다.");
        for (const part of frame.batch.frames)
          await write(current, part.bytes, version);
        cursor.current = frame.batch.nextOffset;
      } catch (failure) {
        if (
          !stopped &&
          alive.current &&
          version === flow.current &&
          !(
            failure instanceof Error &&
            failure.message.includes("REQUEST_CANCELLED")
          )
        ) {
          paused();
          setError(errorCodeOf(failure));
          void window.sshOS.terminal.pause(value.terminalToken).catch(() => {});
        }
      } finally {
        pulling.current = false;
      }
    };
    const timer = setInterval(() => {
      void pull();
    }, 32);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [windowId]);
  const reconnect = async (clear: boolean) => {
    const value = data.current;
    if (!value || (memoryBlocked.current && !clear)) return;
    const wasBlocked = memoryBlocked.current;
    phase.current = "restoring";
    syncInput();
    try {
      const next = await window.sshOS.terminal.restore(
        value.terminalToken,
        clear,
      );
      memoryBlocked.current = false;
      accept(next);
    } catch (failure) {
      memoryBlocked.current = wasBlocked;
      paused();
      setError(errorCodeOf(failure));
    }
  };
  const row = descriptor?.runtime.execution.receipt,
    ready =
      phase.current === "live" &&
      descriptor?.inputAllowed &&
      !pasteBusy.current;
  return (
    <section className="terminal-pane" aria-label="PTY 터미널">
      <div className="terminal-toolbar">
        <strong>
          {descriptor?.status === "disconnected"
            ? "연결 끊김"
            : descriptor?.status === "restoring"
              ? "화면 복구 중 · 입력 잠김"
              : row?.channelClosed
                ? "채널 종료"
                : ready
                  ? "입력 가능"
                  : "입력 잠김"}
        </strong>
        <button disabled={!instance.current} onClick={copy}>
          복사
        </button>
        <button
          disabled={!ready}
          onClick={() => {
            void nativePaste();
          }}
        >
          붙여넣기
        </button>
        <button
          disabled={
            !descriptor ||
            descriptor.status === "disconnected" ||
            descriptor.status === "blocked" ||
            memoryBlocked.current ||
            pasteBusy.current
          }
          onClick={() => {
            void reconnect(false);
          }}
        >
          표시 다시 연결
        </button>
        <button
          disabled={
            !descriptor ||
            descriptor.status === "disconnected" ||
            pasteBusy.current
          }
          onClick={() => {
            void reconnect(true);
          }}
        >
          새 표시 시작
        </button>
      </div>
      {row && (
        <div className="terminal-location">
          {row.endpointSnapshot.name} · {row.endpointSnapshot.username}@
          {row.endpointSnapshot.endpoint}
        </div>
      )}
      {row?.exitObserved && (
        <p className="terminal-notice">
          {row.exitCode !== null
            ? `종료 코드 ${row.exitCode}`
            : `종료 신호 ${row.exitSignal}`}{" "}
          · {row.channelClosed ? "채널 종료 확인" : "채널 종료 미확인"}
        </p>
      )}
      {(error || row?.errorCode) && (
        <ErrorPanel
          error={error || row?.errorCode}
          phase={row?.lastConfirmedPhase ?? null}
          target={row?.endpointSnapshot.endpoint ?? null}
          {...(row?.phase === "result_unknown"
            ? { outcome: "unknown" as const }
            : {})}
        />
      )}
      {notice && (
        <p className="terminal-notice" role="status">
          {notice}
        </p>
      )}
      {(pending > 0 || pasteBusy.current) && (
        <p className="terminal-notice" role="status">
          입력 전송 대기 · {pending.toLocaleString()}byte
          {pasteBusy.current ? " · 붙여넣기 처리 중" : ""}
        </p>
      )}
      {descriptor?.runtime.execution.recordError && (
        <p className="file-warning">
          기록 저장 실패 · 기존 터미널 입력과 세션 닫기는 사용할 수 있습니다.
        </p>
      )}
      <div
        ref={host}
        className="terminal-host"
        onPointerDown={() => setMenu(false)}
      />
      {menu && (
        <menu className="terminal-context">
          <li>
            <button
              onClick={() => {
                setMenu(false);
                copy();
              }}
            >
              선택 복사
            </button>
          </li>
          <li>
            <button
              disabled={!ready}
              onClick={() => {
                setMenu(false);
                void nativePaste();
              }}
            >
              붙여넣기
            </button>
          </li>
          <li>
            <button onClick={() => setMenu(false)}>닫기</button>
          </li>
        </menu>
      )}
      {paste &&
        createPortal(
          <TerminalPasteDialog
            preview={paste}
            confirm={() => sendPaste(paste)}
            cancel={() => {
              void window.sshOS.terminal
                .releasePaste(paste.confirmationToken)
                .catch(() => {});
              void finishPaste();
            }}
          />,
          document.getElementById("root") ?? document.body,
        )}
    </section>
  );
}
