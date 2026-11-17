import { errorCodeOf, errorMessages, type ErrorCode } from "./errors";
const actions: Partial<Record<ErrorCode, readonly string[]>> = {
  INPUT_LIMIT: [
    "대기 입력이 처리될 때까지 기다리세요. 거절된 입력은 자동으로 다시 보내지 않습니다.",
  ],
  CLIPBOARD_FAILED: [
    "OS 복사 단축키를 사용하거나 붙여넣기를 직접 다시 선택하세요.",
  ],
  RESTORE_REQUIRED: ["표시 다시 연결을 선택한 뒤 입력 가능 상태를 확인하세요."],
  DISPLAY_LIMIT: [
    "새 표시 시작을 선택하면 기존 표시 history를 지운 뒤 입력과 출력을 재개합니다.",
  ],
  INPUT_INVALID: ["입력한 이름·주소·인수를 확인하세요."],
  HOST_TRUST_REQUIRED: [
    "연결 화면에서 지문을 확인한 뒤 승인하거나 취소하세요.",
  ],
  HOST_KEY_CHANGED: ["연결 설정과 저장 지문을 확인하세요."],
  CONNECT_TIMEOUT: ["주소·포트를 확인한 뒤 새 연결을 요청하세요."],
  CONNECTION_LOST: ["작업 결과를 확인한 뒤 새 연결을 요청하세요."],
  AUTH_FAILED: ["계정·인증 설정을 수정하세요."],
  KEY_INVALID: ["다른 키를 선택하거나 지원 형식을 확인하세요."],
  AUTH_UNSUPPORTED: ["다른 인증 방식이나 지원하는 키를 선택하세요."],
  SECRET_UNAVAILABLE: ["인증정보를 다시 입력하거나 저장을 끄세요."],
  SFTP_UNAVAILABLE: ["연결 정보를 확인하세요."],
  OS_UNSUPPORTED: ["연결 화면의 확인된 OS를 확인하세요."],
  OS_UNKNOWN: [
    "연결 화면에서 Ubuntu24.04 여부를 세션별로 확인하거나 조회만 유지하세요.",
  ],
  PATH_UNSUPPORTED: ["다른 이름을 선택하거나 이 항목을 건너뛰세요."],
  PERMISSION_DENIED: ["대상 경로를 확인하거나 요청을 취소하세요."],
  NAME_CONFLICT: ["다른 이름을 선택하거나 이 항목을 건너뛰거나 취소하세요."],
  HARDLINK_UNSUPPORTED: ["다른 위치를 선택하세요."],
  SOURCE_CHANGED: ["원본을 다시 선택하세요."],
  VERIFY_READ_DENIED: ["작업 상세에서 결과와 임시 경로를 확인하세요."],
  VERIFY_MISMATCH: ["작업 결과를 확인하세요."],
  IO_TIMEOUT: ["작업 상세에서 마지막 확인 단계를 확인하세요."],
  CANCEL_TOO_LATE: ["최종 파일 생성 결과를 기다리세요."],
  STORAGE_FAILED: ["저장 위치를 확인하고 저장소 다시 확인을 선택하세요."],
  RESULT_UNKNOWN: [
    "작업 상세의 실제 위치를 확인한 뒤 확인 후 기록 닫기를 선택하세요.",
  ],
  PARTIAL_RENAME: ["작업 상세에서 원본과 새 경로를 모두 확인하세요."],
  INPUT_RESULT_UNKNOWN: [
    "터미널 화면과 원격 상태를 직접 확인하세요. 입력을 다시 보내지 않습니다.",
  ],
  EXEC_RESULT_UNKNOWN: [
    "전체 작업에서 실행 관측 상태를 확인하세요. 자동으로 다시 실행하지 않습니다.",
  ],
  EXEC_PERMISSION: ["실행 방식에서 sh 또는 bash를 직접 선택하거나 취소하세요."],
  STOP_UNCONFIRMED: ["실행 출력과 작업 상세에서 종료 관측 여부를 확인하세요."],
};
export type ErrorPresentation = {
  code: ErrorCode;
  userMessage: string;
  confirmedPhase: string | null;
  affectedTarget: string | null;
  actions: readonly string[];
  technicalDetails: { code: ErrorCode; rawDebugIncluded: false };
};
export function presentError(
  value: unknown,
  context: {
    confirmedPhase?: string | null;
    affectedTarget?: string | null;
    outcome?: "unknown" | "partial_rename";
  } = {},
): ErrorPresentation {
  const code =
    context.outcome === "unknown"
      ? "RESULT_UNKNOWN"
      : context.outcome === "partial_rename"
        ? "PARTIAL_RENAME"
        : errorCodeOf(value);
  return {
    code,
    userMessage: errorMessages[code],
    confirmedPhase: context.confirmedPhase ?? null,
    affectedTarget: context.affectedTarget ?? null,
    actions: actions[code] ?? ["고정 오류 코드와 작업 상태를 확인하세요."],
    technicalDetails: { code, rawDebugIncluded: false },
  };
}
