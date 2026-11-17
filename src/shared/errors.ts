/** Fixed messages from development specification13; no remote text interpolation. */
export const errorMessages = {
  COMMAND_UNAVAILABLE: "서버에서 필요한 SSH 명령을 실행할 수 없습니다.",
  COMMAND_FAILED: "서버의 파일 작업 명령이 실패했습니다.",
  COMMAND_OUTPUT_INVALID: "서버의 파일 정보 응답 형식이 올바르지 않습니다.",
  INPUT_INVALID: "입력 형식이 올바르지 않습니다.",
  HOST_TRUST_REQUIRED: "처음 연결하는 서버입니다. 호스트 지문을 확인하세요.",
  HOST_KEY_CHANGED: "저장한 서버 키와 현재 키가 다릅니다. 연결을 중단했습니다.",
  CONNECT_TIMEOUT: "제한 시간 안에 SSH 연결을 완료하지 못했습니다.",
  CONNECTION_LOST: "SSH 연결이 끊겼습니다.",
  AUTH_FAILED: "서버가 로그인을 허용하지 않았습니다.",
  KEY_INVALID: "이 개인키 형식 또는 인증 방식은 지원하지 않습니다.",
  AUTH_UNSUPPORTED: "이 개인키 형식 또는 인증 방식은 지원하지 않습니다.",
  SECRET_UNAVAILABLE: "저장한 인증 정보를 사용할 수 없습니다.",
  SFTP_UNAVAILABLE: "이 연결에서 파일 전송 기능을 사용할 수 없습니다.",
  OS_UNSUPPORTED: "현재 확인된 서버 OS는 지원 대상이 아닙니다.",
  OS_UNKNOWN: "서버 OS를 확인하지 못했습니다.",
  PATH_UNSUPPORTED: "이 이름 또는 파일 종류는 지원하지 않습니다.",
  PERMISSION_DENIED: "이 경로에서 요청한 작업을 수행할 권한이 없습니다.",
  NAME_CONFLICT: "같은 이름의 항목이 이미 있습니다.",
  NOREPLACE_UNSUPPORTED:
    "이 서버 환경에서는 덮어쓰기 없는 이름 변경을 확인할 수 없어 실행하지 않았습니다.",
  HARDLINK_UNSUPPORTED:
    "이 위치에서는 기존 파일을 보존하는 확정 방식을 사용할 수 없습니다.",
  SOURCE_CHANGED: "선택한 이후 원본 파일이 변경됐습니다.",
  VERIFY_READ_DENIED: "업로드한 내용을 다시 읽어 확인할 권한이 없습니다.",
  VERIFY_MISMATCH: "전송한 내용과 목적지 내용이 일치하지 않습니다.",
  IO_TIMEOUT: "작업 응답이 제한 시간 안에 도착하지 않았습니다.",
  CANCEL_TOO_LATE: "최종 파일을 만드는 단계여서 취소할 수 없습니다.",
  STORAGE_FAILED:
    "로컬 기록을 저장하지 못했습니다. 새 변경 작업을 중지했습니다.",
  RESULT_UNKNOWN:
    "요청 결과를 확인하지 못했습니다. 자동으로 다시 실행하지 않습니다.",
  PARTIAL_RENAME:
    "새 이름은 생성됐지만 이전 이름의 제거를 확인하지 못했습니다.",
  INTERNAL_ERROR: "앱 내부 오류로 작업을 중단했습니다.",
  ATOMIC_RENAME_UNSUPPORTED:
    "이 서버는 텍스트 파일의 안전한 교체 저장을 지원하지 않습니다.",
  TEXT_EDIT_UNSUPPORTED: "혼합 또는 단독 CR 줄바꿈 파일은 읽기 전용입니다.",
  TEXT_UNSAVED:
    "편집 중인 텍스트가 있습니다. 저장하거나 변경을 버린 뒤 닫으세요.",
  INPUT_LIMIT:
    "입력 전송 대기 한도를 초과했습니다. 초과 입력은 전송하지 않았습니다.",
  CLIPBOARD_FAILED: "클립보드 요청을 완료하지 못했습니다.",
  DIRECTORY_SYNC_UNAVAILABLE:
    "저장 폴더의 디스크 동기화를 수행할 수 없습니다. 정전 내구성이 제한될 수 있습니다.",
  ASSET_DENIED: "앱의 로컬 리소스 요청을 허용하지 않았습니다.",
  CLOSE_CONFIRM_REQUIRED: "실행 중인 작업의 창 닫기 확인이 필요합니다.",
  EXEC_CANCELLED_NOT_SENT: "원격 실행 요청을 보내기 전에 취소했습니다.",
  FILE_LIMIT: "지원하는 파일 전송 범위를 벗어났습니다.",
  IO_FAILED: "파일 입출력 응답을 확인하지 못했습니다.",
  KEY_UNAVAILABLE: "이 연결의 개인키를 사용할 수 없습니다.",
  RENDER_TIMEOUT: "파일 표시가 제한 시간 안에 완료되지 않았습니다.",
  RESTORE_FAILED: "터미널 표시 복구를 확인하지 못했습니다.",
  SIGNING_DENIED: "허용된 SSH 서명 요청이 아닙니다.",
  STORAGE_EXISTS: "초기화할 위치에 로컬 기록이 이미 있습니다.",
  STORAGE_FUTURE_SCHEMA:
    "더 새로운 버전의 로컬 기록입니다. 이 버전에서는 저장하지 않습니다.",
  STORAGE_INVALID: "로컬 기록의 형식 또는 무결성을 확인하지 못했습니다.",
  STORAGE_UNAVAILABLE: "로컬 기록을 사용할 수 없습니다.",
  TASK_LIMIT: "전송 대기열의 100개 한도를 초과했습니다.",
  UNRESOLVED_LIMIT: "결과를 확인해야 하는 작업 100개를 먼저 확인하세요.",
  EXEC_PERMISSION:
    "이 파일에 실행 비트가 없습니다. sh 또는 bash를 직접 선택할 수 있습니다.",
  WINDOW_LIMIT:
    "창 한도에 도달했습니다. 열린 창 목록에서 창을 선택하거나 닫으세요.",
  PROFILE_LIMIT: "서버는 최대10개 등록할 수 있습니다.",
  PROFILE_BUSY: "이 프로필의 연결과 작업을 먼저 종료하세요.",
  PROFILE_NOT_FOUND: "서버 프로필을 찾지 못했습니다.",
  SESSION_LIMIT: "연결 또는 실행 채널 한도에 도달했습니다.",
  SESSION_BUSY: "이 서버의 연결 처리가 진행 중입니다.",
  SESSION_UNAVAILABLE: "사용할 수 있는 서버 연결이 없습니다.",
  ENGINE_STOPPED: "연결 엔진이 종료됐습니다.",
  REQUEST_BUSY: "앞선 요청을 처리 중입니다. 잠시 후 다시 시도하세요.",
  TOKEN_EXPIRED: "요청 정보가 만료됐습니다. 대상과 상태를 다시 확인하세요.",
  VIEW_LIMIT: "파일 보기의 크기 또는 읽기 한도를 초과했습니다.",
  VIEW_FORMAT_UNSUPPORTED: "지원하는 텍스트 또는 이미지 형식이 아닙니다.",
  PATH_CHANGED: "조회 이후 경로가 변경됐습니다. 다시 조회하세요.",
  DISPLAY_LIMIT: "터미널 표시 메모리 한도 초과 · 새 표시 시작을 선택하세요.",
  RESTORE_REQUIRED: "터미널 표시 복구를 완료해야 입력할 수 있습니다.",
  INPUT_RESULT_UNKNOWN:
    "입력 전달 결과를 확인하지 못했습니다. 자동으로 다시 보내지 않습니다.",
  EXEC_RESULT_UNKNOWN:
    "실행 결과를 확인하지 못했습니다. 자동으로 다시 실행하지 않습니다.",
  EXEC_REJECTED: "서버가 프로그램 실행 요청을 허용하지 않았습니다.",
  PTY_UNAVAILABLE: "서버가 터미널 요청을 허용하지 않았습니다.",
  STOP_UNCONFIRMED: "중지 요청 뒤 원격 프로세스의 종료를 확인하지 못했습니다.",
  REQUEST_CANCELLED: "요청을 취소했습니다.",
  IPC_DENIED: "이 화면의 요청을 허용하지 않았습니다.",
} as const;
export type ErrorCode = keyof typeof errorMessages;
export function errorCodeOf(value: unknown): ErrorCode {
  const raw =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : "";
  const match = /(?:^|Error: )([A-Z_]{1,64})$/u.exec(raw),
    code = match?.[1];
  return code && Object.hasOwn(errorMessages, code)
    ? (code as ErrorCode)
    : "INTERNAL_ERROR";
}
export const userMessage = (value: unknown): string =>
  errorMessages[errorCodeOf(value)];
