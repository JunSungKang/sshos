import type { SessionView } from "../../../shared/session-contracts";

const labels: Record<SessionView["status"], string> = {
  idle: "연결 안 됨",
  connecting: "연결 중",
  authenticating: "인증 중",
  connected: "연결됨",
  awaiting_host_trust: "지문 확인 대기",
  disconnecting: "연결 해제 중",
  disconnected: "연결 끊김",
  failed: "연결 실패",
};

export const connectionStatusLabel = (status?: SessionView["status"]) =>
  labels[status ?? "idle"];

export const hasLiveConnection = (status?: SessionView["status"]) =>
  Boolean(status && !["idle", "failed", "disconnected"].includes(status));
