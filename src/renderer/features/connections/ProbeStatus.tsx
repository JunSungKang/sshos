import type { ProbeView } from "../../../shared/probes";
export function ProbeStatus({
  value,
  serverId,
  generation,
}: {
  value: ProbeView | undefined;
  serverId: string;
  generation: number;
}) {
  const current =
    value?.serverId === serverId && value.generation === generation
      ? value
      : null;
  const state = current?.status ?? "waiting";
  let text = "측정 대기";
  if (
    state === "sample" &&
    current?.sample?.elapsedMs !== null &&
    current?.sample?.elapsedMs !== undefined
  )
    text =
      current.sample.elapsedMs < 1
        ? "SSH 응답 <1 ms"
        : `SSH 응답 ${Math.round(current.sample.elapsedMs)} ms`;
  else if (state === "measuring") text = "측정 중";
  else if (state === "delayed") text = "SSH 응답 지연";
  else if (state === "unavailable") text = "응답시간 측정 불가";
  else if (state === "paused") text = "측정 일시 중지";
  return (
    <span
      className={`probe-status ${state}`}
      data-testid="ssh-response"
      title={`현재 SSH 연결에서 짧은 명령의 완료 응답을 받는 시간입니다. 네트워크와 서버 처리 시간이 포함됩니다.${current?.sample?.transferActive ? " 전송 중 측정된 값입니다." : ""}`}
    >
      <span aria-hidden="true">●</span> {text}
    </span>
  );
}
