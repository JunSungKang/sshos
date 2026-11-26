import { useEffect, useRef, type Ref } from "react";
import type { SessionView } from "../../../shared/session-contracts";
import { connectionStatusLabel } from "./connection-status";
import { ServerGlyph } from "./ServerGlyph";
import "./connections.css";
import { useRelayDropTarget } from "../transfers/RelayWorkspace";

export function ServerWorkspaces({
  sessions,
  selectedId,
  select,
}: {
  sessions: SessionView[];
  selectedId: string | null;
  select(id: string | null): void;
}) {
  const current = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);
  return (
    <section
      className="server-workspaces"
      aria-label="서버 작업 공간"
      data-selected-server={selectedId ?? ""}
    >
      <div className="server-workspaces-heading">
        <h2>작업 공간</h2>
        <button
          className="workspace-clear"
          aria-label="서버 선택 해제"
          title="서버 선택 해제 · 연결은 유지됩니다"
          disabled={!selectedId}
          onClick={() => select(null)}
        >
          ×
        </button>
      </div>
      {sessions.length === 0 ? (
        <p className="workspace-list-empty">
          서버에 연결하면 여기에 표시됩니다.
        </p>
      ) : (
        <div className="server-workspaces-list">
          {sessions.map((row) => (
            <WorkspaceButton
              key={row.serverId}
              row={row}
              selected={row.serverId === selectedId}
              buttonRef={row.serverId === selectedId ? current : null}
              select={select}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function WorkspaceButton({
  row,
  selected,
  buttonRef,
  select,
}: {
  row: SessionView;
  selected: boolean;
  buttonRef: Ref<HTMLButtonElement>;
  select(id: string): void;
}) {
  const endpoint = `${row.username}@${row.host}:${row.port}`;
  const target = useRelayDropTarget(row);
  return (
    <button
      ref={buttonRef}
      {...target}
      className="server-workspace"
      data-server-id={row.serverId}
      data-state={row.status}
      aria-pressed={selected}
      aria-label={`${row.serverName} · ${endpoint} 작업 공간`}
      title={`${row.serverName}\n${endpoint}\n${connectionStatusLabel(row.status)}`}
      onClick={() => select(row.serverId)}
    >
      <span className="workspace-server-icon">
        <ServerGlyph />
      </span>
      <span className="workspace-server-copy">
        <strong>{row.serverName}</strong>
        <small>
          <i className="connection-dot" />
          {target["data-relay-ready"]
            ? "여기에 복사"
            : connectionStatusLabel(row.status)}
        </small>
      </span>
    </button>
  );
}
