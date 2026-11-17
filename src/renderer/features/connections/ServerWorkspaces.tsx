import { useEffect, useRef } from "react";
import type { SessionView } from "../../../shared/session-contracts";
import { connectionStatusLabel } from "./connection-status";
import { ServerGlyph } from "./ServerGlyph";
import "./connections.css";

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
          {sessions.map((row) => {
            const selected = row.serverId === selectedId;
            const endpoint = `${row.username}@${row.host}:${row.port}`;
            return (
              <button
                key={row.serverId}
                ref={selected ? current : null}
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
                    {connectionStatusLabel(row.status)}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
