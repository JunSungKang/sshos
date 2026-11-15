# sshOS 개발 계획서

문서 판본은 v1이며 목표 제품 버전은 1.0.0이다. 구현 담당 모델은 GPT 6.1 sol의 extra high 설정을 사용하는 경우까지 포함한다. 이 문서의 계약과 수용 기준은 모델 설정에 관계없이 동일하게 적용한다. `01-product-plan.md`와 `spec-v1.json`을 먼저 읽고 작업한다.

## 1 개발 착수와 명세 관리

현재 요청의 산출물은 계획과 예상 이미지다. 소프트웨어 구현, 의존성 설치, Git 초기화와 commit·push·merge는 사용자의 후속 개발 착수 요청으로 시작한다. 시작 요청이 이 판본을 승인하면 실제 메시지, 날짜, `spec-v1.json`의 scope digest를 approval에 기록한다. 모델 이름을 언급한 사실을 하위 에이전트 실행 지시로 해석하지 않는다.

### 1.1 방법론 비교

| 방법 | 적합도 | 계획 비용과 산출물 | 검증 강도와 적용 판단 |
| --- | --- | --- | --- |
| Focused Fix | 낮음 | 좁은 결함·수정·회귀 기록 | 신규 제품 전체의 요구 추적에는 범위가 부족하다. |
| Sprint Delivery | 중간 | 단계별 2단계 작업 분해와 완료 기준 | 진행 관리에 적합하며 이 문서의 마일스톤 구조에 활용한다. |
| SDD | 가장 높음 | 명세, 상태표, 인터페이스, 요구사항과 검사 연결 | 사용자가 요구한 명시적 구현 기준을 먼저 고정하므로 추천한다. |
| TDD | 부분 적합 | 실패 검사와 최소 구현 | 전송 상태, 충돌, 파서 등 데이터 무결성이 중요한 단위에서 적용한다. |
| AI-DLC | 중간 | 모든 단계의 입력·산출물·사람 승인 기록 | 본 작업에서는 전체 명세 승인과 변경 승인으로 범위를 한정한다. |

추천 방법은 SDD다. 계획 v1의 승인과 개발 착수 지시는 이 선택의 승인도 포함한다. 계획 초안은 승인 근거가 될 수 없다. 시안 생성은 이번 요청에 포함된 계획 산출물 제작으로 수행한다.

### 1.2 구현 지시 규칙

1. 요구사항 R01–R30과 해당 T·C ID를 읽은 뒤 작업한다.
2. 정의된 값과 enum을 그대로 사용한다. UI 문자열도 제품 계획서의 문구를 따른다.
3. UI의 성공 표시는 실제 backend 결과와 후속 확인이 모두 충족된 뒤에 표시한다.
4. 테스트 전용 fixture와 실제 앱 모드를 실행 인자로 분리하고 실제 앱에서 fixture fallback을 금지한다.
5. 현재 범위를 변경하는 대안을 코드로 선반영하지 않는다. 충돌한 항목만 기록하고 영향을 받지 않는 작업을 계속한다.
6. 완료 보고에는 바뀐 R·T ID, 수행한 C ID, 실행 환경, 실패·미검사, commit SHA를 적는다.
7. 명세 변경은 새로운 판본에 변경 이유, 영향받는 요구·작업·검사 ID와 재검증 범위를 기록한다.
8. C03의 대상 OS 검증을 수행할 환경이 없으면 `untested`를 유지하고 해당 제품 버전 완료 판정을 보류한다.

### 1.3 파일시스템 경계

작업 루트는 `/Users/kkkk/Desktop/jskang/03.workspace/01.project/sshOS`다. 개발 중 소스, 도구 캐시, 앱 데이터, 브라우저 테스트 데이터, 임시 파일, 패키지 출력, 로그, 로컬 bare origin을 모두 이 루트 아래에 둔다. `.local/`은 로컬 전용으로 Git에서 제외한다. 명령 실행 전에 실제 경로를 resolve하고 루트 내부인지 검사한다. 기존 사용자 파일과 pre-existing 변경은 보존한다.

개발용 `SS HOS` 같은 변형 이름은 사용하지 않는다. 환경 변수 접두사는 `SSHOS_`로 고정한다. 개발 실행은 `SSHOS_DATA_DIR=<root>/.local/app-data`, 테스트는 `<root>/.local/test-runs/<runId>`를 사용한다. Electron `userData`, `sessionData`, `logs`, crash dump 경로를 `app.ready` 이전에 해당 루트 아래로 설정한다. cache와 임시 디렉토리는 `TMPDIR`, `TMP`, `TEMP`, `npm_config_cache`, `ELECTRON_CACHE`, `ELECTRON_BUILDER_CACHE`, `PLAYWRIGHT_BROWSERS_PATH`를 `.local/`의 하위 경로로 지정한다. 사용자의 HOME과 CODEX_HOME은 변경하지 않는다.

설치 배포된 앱은 운영체제의 앱 데이터 경로를 사용할 수 있다. 이 문서에 따른 현재 작업 환경의 개발·테스트는 위의 명시적 경로 설정을 사용한다. 패키지 검증에서도 테스트 데이터 경로를 넘긴다.

## 2 기술 구성과 버전

선택한 구성은 Electron과 TypeScript 기반의 단일 데스크톱 프로젝트다. React는 작업 공간과 앱 화면, ssh2는 SSH와 SFTP, Electron utility process는 원격 I/O를 담당한다. context isolation과 제한된 preload API를 적용한다. [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation/), [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process), [ssh2 공식 저장소](https://github.com/mscdex/ssh2)

2026년 11월 14일 공식 배포 메타데이터에서 확인한 초기 고정 버전은 아래와 같다. package.json 직접 의존성은 `^`와 `~` 없이 기록하고 npm의 `package-lock.json`을 커밋한다. 아래 버전의 조합은 설치·빌드 검증 전이므로 T01에서 검증한다. 설치 실패 시 오류와 충돌한 패키지를 기록하고 해당 값만 새 명세 판본으로 수정한다.

| 구성 | 고정 버전 | 용도 |
| --- | --- | --- |
| Node.js | 26.13.1 | 개발 런타임 |
| npm | 11.20.0 | 의존성 관리 |
| electron | 45.3.2 | 데스크톱 런타임 |
| react / react-dom | 19.3.1 | UI |
| typescript | 7.0.2 | 정적 타입 검사 |
| vite | 8.3.8 | renderer 빌드 |
| electron-vite | 6.0.0 | main·preload·renderer 개발·빌드 |
| @vitejs/plugin-react | 6.3.0 | React 변환 |
| ssh2 | 1.17.0 | SSH/SFTP |
| @types/ssh2 | 1.15.6 | SSH 타입 |
| zod | 4.6.7 | IPC·저장 데이터 런타임 검사 |
| zustand | 5.1.0 | renderer 상태 |
| lucide-react | 1.72.0 | 공통 UI 아이콘 |
| vitest | 5.1.0 | 단위·통합 검사 |
| @playwright/test | 1.65.1 | Electron 사용자 흐름 검사 |
| electron-builder | 26.18.0 | macOS·Windows 패키징 |

Node 버전은 공식 배포 목록으로 확인했으며 패키지 값은 npm 공식 레지스트리의 각 패키지 `/latest` 응답에서 읽었다. 개발 시작 시 최신 버전이라는 이유만으로 다른 버전으로 바꾸지 않는다. 보안 또는 호환성 수정이 필요한 경우 변경 영향과 재검증을 기록한다. [Node 공식 배포 목록](https://nodejs.org/dist/index.json), [npm 공식 레지스트리](https://registry.npmjs.org/)

TypeScript는 strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes를 켠다. 외부 경계의 unknown을 Zod 검증 후 사용한다. 임의 any, 비밀 값의 JSON logging, renderer에서 Node 직접 호출은 허용하지 않는다.

## 3 코드 구조

다음은 구현 시 생성할 경로다. 이번 계획 작성 단계에서는 문서와 시안 파일만 생성한다.

```text
sshOS/
  docs/
    01-product-plan.md
    02-development-plan.md
    spec-v1.json
    implementation-state.json
  design/
    sshOS-v1-preview.png
    preview-prompt.txt
  src/
    main/
      index.ts
      windows.ts
      ipc.ts
      storage.ts
      credentials.ts
      host-trust.ts
      worker-supervisor.ts
    preload/
      index.ts
    worker/
      index.ts
      sessions.ts
      sftp.ts
      transfers.ts
      operations.ts
      ubuntu-24.ts
      commands.ts
    shared/
      contracts.ts
      schemas.ts
      errors.ts
    renderer/
      shell/
      apps/home/
      apps/connections/
      apps/files/
      apps/system/
      apps/services/
      apps/processes/
      apps/logs/
      apps/transfers/
      apps/settings/
      components/
      styles/
  tests/
    unit/
    integration/
    e2e/
    fixtures/
  scripts/
    verify.mjs
    run-dev.mjs
    run-tests.mjs
  evidence/
  .local/
    git-origin.git/
    app-data/
    cache/
    tmp/
    test-runs/
    dist/
```

`implementation-state.json`은 M0에서 만들며 현재 명세 판본, 진행 중 T ID, 완료 T ID, C ID별 결과·실행 환경·증거 경로·대상 commit SHA, 미해결 결함, 다음 작업을 저장한다. 임시 runtime 데이터는 `.local/`, 개인정보를 제거한 검증 결과는 `evidence/`에 둔다.

## 4 프로세스 책임과 데이터 흐름

| 경계 | 소유 책임 |
| --- | --- |
| renderer | 창 배치·선택·필터·표시. 전송·접속 상태의 원본은 backend에서 받는다. |
| preload | 명시된 API 메서드와 unsubscribe 가능한 이벤트 구독만 노출한다. |
| main | 네이티브 창·파일 선택기·safeStorage·저장·호스트 확인·IPC sender 검증·worker 수명 |
| utility worker | SSH 소켓·SFTP·전송 queue·허용된 원격 명령·원격 결과 파싱 |
| Ubuntu adapter | OS 탐지·시스템 값·서비스·프로세스·로그의 명령과 파싱 |

utility worker는 앱당 하나다. 서버마다 control SSH 연결 1개와 transfer SSH 연결 최대 1개를 사용한다. 전송 연결은 해당 서버의 첫 실제 전송 때 생성한다. control 연결은 파일 목록 조회와 원격 명령, transfer 연결은 파일 byte stream에 사용한다. 최대 연결 수는 서버당 2개, 전체 20개다. 두 연결은 동일한 host trust와 인증 재료를 사용하며 연결 역할별 상태를 별도로 기록한다. control 연결의 끊김은 서버 세션 전체의 끊김으로 처리한다. transfer 연결만 끊기면 해당 전송들만 중단 처리하고 control 연결을 유지한다.

원격 명령 채널은 서버당 최대 4개다. control SFTP 채널 1개와 실행 중인 명령 채널을 합해 5개 이내다. 파일 전송은 서버당 최대 2개 SFTP 채널을 사용한다. channel-open 실패는 해당 작업 실패로 표시한다. 제한을 늘리기 위해 서버 설정을 자동 변경하지 않는다.

control SFTP의 미완료 요청은 서버당 최대 16개로 제한한다. 시스템·프로세스·서비스 polling은 이전 표본 수집이 끝난 뒤 다음 예정 시각에 실행하며 같은 구독의 조회를 겹치지 않는다. 6초 이상 새 표본이 없으면 `업데이트 지연`을 표시한다. 여러 창이 같은 서버·종류를 구독하면 수집기는 하나를 공유한다. 마지막 구독이 닫히면 수집을 중단한다.

worker 비정상 종료 시 main은 세션들을 disconnected, 활성 transfer를 interrupted로 저장하고 1회 새 worker를 실행한다. 이후 자동 원격 재접속은 수행하지 않는다. renderer 재시작 시 main의 최신 snapshot을 받아 열린 작업을 복원한다. utility worker가 살아 있으면 전송은 계속된다.

## 5 데이터 계약과 IPC

### 5.1 공통 규칙

ID는 UUID v4 문자열이다. 시각 저장은 UTC ISO 8601, 화면 시각은 클라이언트 지역 시간과 시간대다. 파일 바이트와 원격 inode·시각의 고정밀 원값은 10진수 문자열로 전달하고 계산은 bigint로 한다. UI 퍼센트와 속도 계산 직전에 안전한 비율로 변환한다. 파일 최대 크기는 2^53−1 byte이며 초과 항목은 `FILE_TOO_LARGE`다.

원격 파일 경로는 POSIX 절대 경로다. `/`로만 구분하고 로컬 OS의 path.normalize를 적용하지 않는다. 파일명은 정상 UTF-8이며 NUL을 금지한다. 제어 문자와 줄바꿈은 UI에서 이스케이프해 표시하고 원격 작업에는 원래 문자열을 보존한다. 디코딩 불가능한 byte 이름은 `지원하지 않는 파일명`으로 표시하며 변경·전송을 막는다. renderer가 받은 표시용 이스케이프 문자열을 원격 경로로 재사용하지 않는다.

### 5.2 핵심 자료형

| 자료형 | 필드와 제약 |
| --- | --- |
| ServerProfile | id, alias, host, port, username, authKind=password\|keyFile, keyPath?, saveCredential, createdAt, updatedAt |
| ServerSession | id, serverId, state, generation, osId, osVersion, architecture, uid, homePath, capabilities, lastError? |
| AppWindow | id, appId, serverId?, rect, previousRect?, mode=normal\|minimized\|maximized, zIndex, lastPath? |
| FileEntry | path, name, kind=file\|directory\|symlink\|socket\|fifo\|device\|unknown, sizeBytes, mtimeSeconds, mode, uid, gid, linkTarget? |
| Transfer | id, groupId?, retryOf?, serverId, sessionGeneration, direction=upload\|download, source, destination, state, totalBytes?, acknowledgedBytes, tempPath?, createdAt, updatedAt, error?, cleanupState=none\|pending\|done\|failed |
| TransferGroup | id, serverId, direction, state, discoveredFiles, completedFiles, failedFiles, skippedFiles, totalBytes?, transferredBytes |
| Operation | id, requestId, serverId, generation, kind, target, state=pending\|running\|succeeded\|failed\|unknown, startedAt, endedAt?, error? |
| BackendError | code, messageKey, serverId?, operationId?, retryable, details. details는 허용된 문자열 키만 가진다. |

값이 없는 optional 필드는 생략한다. null과 빈 문자열로 같은 상태를 중복 표현하지 않는다. 구현 및 UI 문서는 한국어로 유지하며 자료형의 필드 이름은 위 영어 식별자를 따른다.

### 5.3 응답과 이벤트

모든 요청은 `{ requestId, payload }`, 응답은 `{ requestId, ok: true, data }` 또는 `{ requestId, ok: false, error }`다. 모든 이벤트는 `{ eventId, sequence, sessionGeneration, serverId?, entityId, type, payload }`다. sequence는 worker 수명 동안 증가하는 정수다. renderer는 이미 적용한 sequence 이하의 이벤트를 버린다. snapshot에는 현재 sequence를 포함한다. 연결 generation이 다른 이벤트는 해당 서버의 최신 화면 상태에 적용하지 않는다. 전송 이력의 기존 작업은 작업 ID로 별도 유지한다.

| API | 입력 | 결과 |
| --- | --- | --- |
| profiles.list | 없음 | 비밀을 제외한 프로필 목록 |
| profiles.save | 프로필 입력 | 저장한 프로필 |
| profiles.remove | serverId | disconnected이며 비최종 작업이 없으면 제거, 그 외 ACTIVE_WORK |
| sessions.connect | serverId, 일회용 credential? | sessionId, 이후 상태 이벤트 |
| sessions.confirmHost | challengeId, accept | 신뢰 기록 반영 또는 취소 |
| sessions.disconnect | serverId, cancelActive | 종료 또는 확인 필요 오류 |
| files.list | serverId, absolutePath | FileEntry 목록과 canonicalPath |
| files.mkdir | serverId, parentPath, name | 생성된 경로 |
| files.rename | serverId, path, newName | 변경된 경로 |
| files.remove | serverId, paths, confirmed | operationId |
| files.preview | serverId, path | UTF-8 text와 truncated=false 또는 타입·크기 오류 |
| local.chooseUpload | file\|directory | main이 보관한 로컬 경로를 가리키는 일회용 selectionToken |
| local.chooseDownload | 없음 | destinationToken |
| transfers.enqueue | serverId, direction, remotePaths, selectionToken 또는 destinationToken | groupId, transferIds |
| transfers.resolveConflict | transferId, replace\|rename\|skip, newName? | 대기 또는 건너뜀 상태 |
| transfers.cancel | transferId 또는 groupId | 취소 요청 접수 |
| transfers.retry | transferId 또는 groupId | 새 작업 ID |
| system.subscribe | serverId | 구독 ID |
| services.list | serverId | 서비스 목록 |
| services.act | serverId, unit, start\|stop\|restart, privilege=user\|sudo, sudoSecret? | operationId |
| processes.subscribe | serverId | 구독 ID |
| processes.terminate | serverId, pid, startTimeTicks, confirmed | operationId |
| logs.open | serverId, unit?, timeRange, maxPriority, follow | 구독 ID와 최초 항목 |
| subscriptions.close | subscriptionId | 구독 종료 |
| settings.update | 허용된 설정 필드 | 갱신된 설정 |
| state.snapshot | 없음 | 비밀 제외 현재 상태 |

renderer의 파일 드롭은 preload에서 Electron의 File 경로 추출 API로 전달하고 main이 로컬 경로를 보관한다. 로컬 토큰은 임의 경로 접근권을 renderer에 주지 않도록 하며 생성 후 5분 또는 1회 사용 시 만료한다. 선택된 폴더의 하위 경로는 main이 realpath 검사를 수행한다.

오류 코드는 VALIDATION_ERROR, ACTIVE_WORK, HOST_KEY_UNKNOWN, HOST_KEY_CHANGED, AUTH_FAILED, KEY_FORMAT_UNSUPPORTED, KEY_PASSPHRASE_REQUIRED, KEY_PASSPHRASE_INVALID, CONNECTION_TIMEOUT, CONNECTION_LOST, OS_UNSUPPORTED, CAPABILITY_UNAVAILABLE, PERMISSION_DENIED, PATH_NOT_FOUND, NAME_CONFLICT, PATH_UNREPRESENTABLE, FILE_TOO_LARGE, SOURCE_CHANGED, TARGET_CHANGED, DISK_FULL, TRANSFER_FAILED, FINALIZE_FAILED, CLEANUP_REQUIRED, OPERATION_RESULT_UNKNOWN, PROCESS_CHANGED, SECRET_STORAGE_UNAVAILABLE, STORAGE_CORRUPT, LIMIT_REACHED, INTERNAL_ERROR로 고정한다.

## 6 SSH와 인증 구현

ssh2 Client를 사용하고 hostVerifier를 항상 설정한다. 서버 호스트 키 원본으로 SHA256 지문을 만들고 endpoint의 host·port와 키 byte를 함께 비교한다. IPv6 표기와 DNS 대소문자를 연결 키로 정규화하되 사용자 입력 표시값은 보존한다. 호스트 키 교체는 확인된 기존 기록과 신규 키가 모두 있어야 처리한다. ssh2는 hostVerifier와 다양한 인증 수단을 제공하므로 adapter가 검증 흐름을 명시적으로 소유한다. [ssh2 Client API](https://github.com/mscdex/ssh2#client-methods)

keepalive는 15초, 응답 없는 keepalive 3회면 연결 끊김이다. 사용자의 새 connect 요청 전에는 인증 재시도와 호스트 키 자동 수락을 수행하지 않는다. 같은 serverId의 중복 connect 요청은 진행 중 sessionId를 반환한다.

비밀번호와 키 암호의 저장에는 main의 safeStorage 비동기 API를 사용한다. isAsyncEncryptionAvailable이 false거나 복호화가 실패하면 저장 기능 오류를 표시하고 세션 한정 입력으로 연결할 수 있게 한다. 저장 파일에는 암호화된 데이터만 들어간다. 키 파일은 매 연결 전에 읽고 파일을 찾지 못하면 다시 선택받는다. 비밀번호 저장 여부와 키 파일 경로 저장 여부는 독립적이다. [Electron 45.3.2 safeStorage](https://raw.githubusercontent.com/electron/electron/v45.3.2/docs/api/safe-storage.md)

인증에 사용한 값은 renderer store에 넣지 않는다. password 입력 상태는 폼 닫기·전송 완료 즉시 비운다. main과 worker에서는 세션 재연결용 평문을 디스크에 저장하지 않는다. 최초 control 연결의 인증 재료는 transfer 연결 준비에만 메모리로 유지하고 서버 disconnect 때 참조를 해제한다. JavaScript 메모리의 물리적 완전 삭제를 보장한다고 문서에 쓰지 않는다.

## 7 SFTP와 전송 구현

### 7.1 탐색과 변경

read directory, lstat, realpath, readlink, mkdir, rename, unlink, rmdir로 파일 기능을 구현한다. 파일명에서 명령 문자열을 구성해 파일 작업을 수행하지 않는다. 디렉토리 삭제는 후위 순회하고 lstat 기준 symlink는 링크 자체만 unlink한다. 순회 중 접근 실패가 나면 해당 경로를 오류로 기록하고 나머지 선택 항목은 계속 처리한다. 전체 완료는 성공·실패 항목 수를 함께 반환한다.

디렉토리 조회 응답은 경로별 requestId를 가지며 늦게 도착한 이전 경로의 응답으로 현재 목록을 덮어쓰지 않는다. 캐시는 창당 마지막 20개 경로, 유효시간 5초다. 파일 변경 완료·전송 완료는 해당 부모 캐시를 무효화하고 갱신한다. 이전 목록을 표시하는 동안 `갱신 중`을 표시한다.

### 7.2 스케줄과 상태 소유

전송 queue와 상태 전이는 worker 하나가 소유한다. 전체 running+finalizing 개수 3, 같은 serverId의 개수 2를 동시에 만족해야 실행한다. 큐는 createdAt, id 순서이며 서버별 제한으로 막힌 항목을 건너뛰고 실행 가능한 가장 앞의 항목을 선택한다. 최종 상태가 된 작업의 점유를 반납한다. 같은 목적지 lock은 정규화된 부모 경로와 최종 basename으로 만들고 conflict부터 finalizing 종료까지 유지한다.

상태 전이는 제품 계획서 표를 따른다. 폴더 group 상태는 discovering, queued, running, completed, completed_with_skips, partial_failed, cancelling, cancelled, interrupted 중 하나다. discovered 중 실패가 나면 group은 partial_failed이며 원인을 표시하고 전송을 시작하지 않는다. children의 중단이 발생하면 group은 interrupted다. 재시도는 실패·중단된 children만 새로운 group 아래에 복사하고 원본을 다시 검사한다.

실패·중단된 파일만 재시도 버튼을 제공한다. completed·cancelled·skipped는 기록 상세만 제공한다. 취소된 그룹의 재생성은 새 전송 요청으로 처리한다. 취소 후 임시 파일 정리 실패는 최종 state=cancelled, cleanupState=failed로 함께 기록한다. 사용자 취소 중 연결이 끊겨 상태를 확인할 수 없으면 state=interrupted다. group 상태의 우선순위는 사용자 취소, 연결 중단, 실패, 건너뜀, 전체 성공 순서다.

전송 이벤트는 250 ms throttle과 마지막 상태 강제 flush를 사용한다. 취소·완료·오류 이벤트는 throttle을 기다리지 않는다. renderer는 backend의 acknowledgedBytes로 진행률을 계산한다. 화면 위치와 앱 창 수명은 queue에 영향을 주지 않는다.

### 7.3 데이터 쓰기와 확정 순서

1. 원본 lstat·크기·mtime을 기록하고 일반 파일 여부를 확인한다.
2. 목적지·충돌 선택·내부 목적지 lock을 확인한다.
3. 목적지와 같은 부모에 임시 파일을 배타 생성한다. 업로드 임시 파일 권한은 0600이다.
4. 64 KiB chunk를 최대 8개까지 in-flight로 보내며 backpressure를 적용한다. 다운로드도 동일한 메모리 상한을 적용한다.
5. 확인된 byte 수를 누적한다. 원본 EOF와 초기 size가 다르면 SOURCE_CHANGED다.
6. 전송 후 원본 size·mtime을 다시 확인한다. 변경되었으면 실패 처리한다.
7. 임시 파일 size를 확인한다. 업로드 신규 파일은 mode 0644, 덮어쓰기는 기존 mode를 임시 파일에 적용하고 원본 mtime을 설정한다. 업로드는 OpenSSH fsync 확장이 있으면 호출한 뒤 close한다. 다운로드는 원본 mtime을 설정하고 로컬 fsync 후 close한다. 속성 설정에 실패하면 목적지 확정 전에 실패 처리한다.
8. 완료 확정 전에 목적지 메타데이터가 충돌 확인 당시와 일치하는지 재검사한다. 변경 감지 시 TARGET_CHANGED와 conflict 재확인 요청을 기록한다. 이때 기존 transfer는 failed이며 재확인 후 새 작업을 만든다.
9. finalizing으로 전환한다. 신규 원격 목적지는 표준 SFTP rename, 기존 원격 파일의 명시적 덮어쓰기는 OpenSSH POSIX rename 확장을 사용한다. 확장이 없으면 FINALIZE_FAILED다. 기존 목적지를 먼저 삭제하는 대체 절차는 금지한다.
10. 로컬 목적지는 같은 파일시스템의 rename을 사용한다. OS가 대체 rename을 거부하면 FINALIZE_FAILED를 표시하고 기존 목적지를 보존한다.
11. 확정된 목적지의 size와 존재를 확인한 뒤 completed로 기록한다. 업로드 신규 폴더는 생성 시 0755를 설정한다. 폴더 mtime은 모든 하위 작업이 끝난 뒤 적용하며 실패하면 group의 속성 적용 오류로 기록한다.

원격 SFTP는 POSIX rename과 fsync를 확장 API로 제공한다. 확장 지원을 실제 서버 연결에서 확인하고 확장 실패를 무시하지 않는다. [ssh2 SFTP API](https://github.com/mscdex/ssh2/blob/master/SFTP.md)

mtime 보존은 원본의 초 단위 시각으로 수행한다. 기존 목적지의 소유자는 서버가 허용하는 결과를 따르며 다른 사용자 소유 파일의 덮어쓰기는 소유권 변경 가능성을 충돌 창에 표시한다. ACL·extended attribute 보존은 1.0의 전송 보존 속성에 포함하지 않는다. 전송 성공 의미는 byte 수·EOF·close·rename·목적지 stat 확인이며 테스트에서는 별도로 SHA256을 비교한다.

### 7.4 재귀 전송과 안전한 경로

폴더 발견은 너비 우선으로 수행하며 최대 파일·폴더 합계 100,000개, 최대 깊이 128이다. 제한을 초과하면 LIMIT_REACHED로 group을 종료한다. 원격·로컬 symlink를 따라가지 않고 건너뜀으로 기록한다. 폴더별 상대 경로는 split된 실제 이름 배열로 보관한다. `.`, `..`, 절대 경로 조각과 드라이브 접두사를 자식 이름으로 재해석하지 않는다. 다운로드 대상은 선택한 로컬 루트의 실제 경로 내부인지 파일을 열기 전 재검사한다.

Windows는 대소문자 구분 없는 목적지 키를 사용하고 마지막 점·공백, 예약 장치명, 잘못된 문자를 충돌 처리한다. macOS도 대상 볼륨의 case sensitivity를 probe 파일로 확인한 결과를 목적지 비교에 사용한다. probe는 선택된 다운로드 폴더 안에 UUID 이름으로 생성 후 즉시 제거한다. 파일명 최대 길이와 경로 길이 오류는 OS 결과로 PATH_UNREPRESENTABLE에 매핑한다.

### 7.5 저장과 복구

프로필·신뢰·설정·작업 공간·전송 기록은 main이 단일 쓰기 queue로 JSON 파일에 기록한다. 저장 schemaVersion=1이다. 파일마다 같은 디렉토리의 UUID 임시 파일 → fsync → rename 순서를 사용하고 직전 유효본 `.bak` 하나를 보관한다. 잘못된 JSON은 `.corrupt-<UTC>`로 보존하고 유효 backup을 읽는다. 둘 다 유효하지 않으면 해당 저장소를 빈 상태로 열고 STORAGE_CORRUPT를 사용자에게 표시한다.

전송 상태 변경은 즉시, byte progress는 1초마다 기록한다. finalizing 직전 destination·temp·expected size·원본 metadata를 durable 저장한다. 앱이 finalizing 도중 종료된 기록은 결과 확인 필요로 복구한다. 재접속 후 temp 존재와 destination metadata를 조회해 사용자에게 표시하며 크기가 같다는 이유만으로 완료를 소급 판정하지 않는다. retry는 충돌 정책을 다시 적용한다.

## 8 Ubuntu 어댑터와 원격 명령

### 8.1 명령 실행 규칙

renderer는 command 문자열을 보낼 수 없다. worker의 CommandId와 검사된 인자만 원격 명령 생성기로 전달한다. `LC_ALL=C`, `LANG=C`, `SYSTEMD_PAGER=cat`, `SYSTEMD_COLORS=0`, `SYSTEMD_ASK_PASSWORD=0`을 고정한다. 기본 명령 timeout은 15초, 서비스 변경은 30초다. stdout 최대 16 MiB, stderr 최대 64 KiB이며 넘으면 출력을 잘랐다는 오류를 반환한다. journal follow는 별도 스트리밍 제한을 사용한다.

동적 인자는 POSIX single-quote 인용 함수를 통과한다. 함수는 원문 `'`를 안전한 quote break sequence로 변환하고 NUL을 거부한다. 테스트는 공백, 따옴표, 백틱, `$()`, 세미콜론, 줄바꿈, 선행 `-`, 한글을 포함한다. `--`는 해당 프로그램이 지원하는 위치에만 넣는다. 명령 결과 문자열을 다음 명령으로 실행하지 않는다.

### 8.2 명령 계약

| CommandId | 데이터 획득과 처리 |
| --- | --- |
| probe | SFTP로 `/etc/os-release` 읽기. shell source 없이 key=value 파싱. `id -u`, `uname -m`, `uname -r`, `hostname`, 검증된 HOME 출력, `/proc/1/comm` 확인 |
| system.sample | SFTP로 `/proc/stat`, `/proc/meminfo`, `/proc/uptime` 읽기. `df -B1 --output=size,used,avail,target /`의 고정 열 파싱 |
| services.list | `systemctl list-units --type=service --all --output=json --no-pager`와 `systemctl list-unit-files --type=service --output=json --no-pager`의 합집합 |
| services.inspect | `systemctl show <quoted-unit> --no-pager`에서 Id, Description, ActiveState, SubState, UnitFileState, Type, Result, ExecMainStatus를 key=value로 읽기 |
| services.act | `systemctl --no-ask-password start/stop/restart <quoted-unit>`와 후속 inspect |
| processes.sample | `/proc`의 숫자 PID 디렉토리에서 stat·status·comm 읽기. 읽는 동안 사라진 PID는 현재 표본에서 제외 |
| processes.terminate | 즉시 stat starttime 재확인 후 고정 셸 스크립트에서 소유 UID 확인과 `kill -TERM <pid>` 실행 |
| logs.query | `journalctl --no-pager --output=json --since <fixed-range> -n 500`에 unit·priority 옵션 적용 |
| logs.follow | 같은 필터에 `--follow`를 추가하고 cursor로 중복 제거 |

systemctl JSON 출력 필드와 show의 속성은 대상 Ubuntu에서 실제 fixture로 검증한다. unit 이름은 adapter가 받은 목록에 존재하는 정확한 문자열만 사용하고 길이는 UTF-8 255 byte 이하로 제한한다. shell injection을 막기 위한 문자 삭제로 다른 unit 이름을 만들지 않는다. [Ubuntu 24.04 systemctl](https://manpages.ubuntu.com/manpages/noble/man1/systemctl.1.html)

OS 검사는 os-release의 ID가 `ubuntu`, VERSION_ID가 `24.04`일 때 통과한다. `uname -m`의 `x86_64`는 amd64, `aarch64`는 arm64로 매핑한다. 그 외 값은 OS_UNSUPPORTED다. HOME은 고정 스크립트 `printf '%s\0' "$HOME"`의 NUL로 끝난 단일 필드로 받아 절대 경로인지 검사하고 SFTP realpath로 확인한다. 서버 프로필 사용자 이름으로 HOME 경로를 조합하지 않는다.

list-units JSON에서 unit, load, active, sub, description을 읽는다. list-unit-files에서는 unit_file, state, preset을 읽는다. 서비스 unit에 이름을 key로 사용하고 JSON의 추가 필드는 무시한다. 필수 필드의 타입이 잘못되면 해당 응답을 CAPABILITY_UNAVAILABLE로 처리하고 raw 결과를 자동 실행하지 않는다. 상세 show는 첫 `=`만 분리하며 빈 속성도 받도록 `--all`을 사용한다. Ubuntu의 systemd 255 소스에서 JSON 테이블 출력 경로를 확인할 수 있다. [systemd 255 출력 코드](https://github.com/systemd/systemd/blob/v255/src/systemctl/systemctl-util.c), [서비스 파일 테이블](https://github.com/systemd/systemd/blob/v255/src/systemctl/systemctl-list-unit-files.c)

sudo는 사용자가 선택한 작업에만 적용한다. `sudo -S -k -p '' -- /usr/bin/systemctl ...` 형태로 고정하고 비밀번호는 SSH channel stdin으로 한 번 전달한다. argv, 로그, 저장 파일에 넣지 않는다. PTY는 생성하지 않는다. sudo 비밀번호를 받은 renderer는 전달 후 입력을 지운다. timestamp 캐시에 의존한 자동 승격은 하지 않는다. 일반 권한 실패 뒤 sudo를 자동 실행하지 않는다.

`/proc/<pid>/stat` 파서는 comm의 마지막 `)` 뒤의 필드 위치를 사용해 공백·괄호가 포함된 프로세스명을 처리한다. 프로세스 stat의 starttime과 UID는 읽기 실패·변경 시 종료 작업을 거절한다. 원격 별도 helper를 설치하지 않는 SIGTERM 재검사에는 검사와 signal 사이의 커널 원자성이 보장되지 않는다. 이 제약을 C20 증거에 명시하고 동일 사용자 프로세스로 기능 범위를 제한한다.

journal JSON은 줄 단위 streaming decoder로 읽는다. MESSAGE가 문자열이면 그대로 표시하고 숫자 배열이면 UTF-8 대체 문자 모드로 decode한다. 문자열 배열이면 줄바꿈으로 연결한다. null이면 `로그 메시지 크기 제한으로 내용이 생략되었습니다`를 표시한다. 단일 JSON 행 한도는 1 MiB이며 초과 행을 건너뛰고 건너뜀 수를 표시한다. cursor는 중복 제거용으로 사용하고 5,000개 화면 보관 제한과 별도로 최대 10,000개 최근 cursor를 유지한다. [Ubuntu 24.04 journalctl](https://manpages.ubuntu.com/manpages/noble/man1/journalctl.1.html)

### 8.3 계산식

CPU 총사용률은 `100 × (Δtotal − Δidle − Δiowait) / Δtotal`이다. total은 user+nice+system+idle+iowait+irq+softirq+steal이며 guest는 중복 가산하지 않는다. delta가 0 또는 음수이면 해당 표본은 측정 중이다. 메모리 사용률은 `(MemTotal−MemAvailable)/MemTotal×100`이다. 디스크 사용률은 `used/size×100`이다.

프로세스 CPU는 `100 × Δ(utime+stime) / ΔaggregateCpuTicks`로 계산한다. aggregateCpuTicks는 `/proc/stat` 첫 cpu 행의 total이다. 이 식은 전체 논리 CPU를 합한 0–100% 기준을 구현한다. RSS는 `/proc/<pid>/status`의 VmRSS KiB를 byte로 변환한다. 표본 간 PID starttime이 달라지면 새 프로세스의 첫 표본으로 처리한다.

## 9 UI 구현 계약

공통 shell은 TopBar, AppRail, Workspace, WindowManager, TransferShelf, ConfirmationDialog로 구성한다. 앱 화면은 shell의 슬롯에 들어간다. top-level 브라우저 route는 `/` 하나이며 앱 창의 상태는 WindowManager가 관리한다. 창마다 독립 browser window를 생성하지 않는다. OS 전체 화면 토글은 네이티브 메뉴에서만 제공한다.

창 제목 막대의 왼쪽에는 앱 아이콘과 제목, 오른쪽에는 최소화·최대화/복원·닫기 순서의 동일 크기 버튼을 둔다. 기능 버튼에는 title과 aria-label을 부여한다. zIndex는 클릭한 창이 마지막이 되도록 순서 배열로 관리하고 저장 시 순서를 저장한다. resize 이벤트 때 창 좌표를 작업 영역 안으로 보정한다.

서버 변경 이벤트는 serverId별 store를 갱신한다. 서버를 전역 하나의 currentServer로 저장해 모든 창에 적용하는 구현은 금지한다. 앱 실행 시에만 lastSelectedServerId를 기본 선택값으로 사용한다. operation, transfer, subscription은 창 ID와 분리한다. 창 닫기는 구독과 화면 상태를 해제하며 전송 queue와 실행 중인 원격 변경을 취소하지 않는다.

필수 화면 상태는 loading, empty, ready, error, disconnected다. 목록은 마지막 성공 데이터를 disconnected 상태에서 흐리게 표시하고 `연결이 끊어졌습니다`와 재연결 버튼을 함께 표시한다. 실행 버튼은 연결이 복구되기 전까지 비활성화한다. 오류 상태에 임의 예시 데이터를 채우지 않는다.

접근성, 키보드, 색상, 치수는 제품 계획서 2장을 따른다. 글꼴 Inter 파일은 프로젝트에 번들하고 OFL 고지를 포함한다. Korean glyph fallback은 명시된 시스템 글꼴 순서로 사용한다. 아이콘은 lucide-react로 통일한다. 스크린샷 테스트에는 OS별 글꼴 렌더 차이를 허용하되 영역 위치 허용차는 4 px다.

## 10 구현 작업 분해

각 행은 결과 중심 1단계 작업이며 하위 작업 두 개는 독립적인 완료 증거를 남긴다. 순서는 표의 의존 관계를 따른다. 모든 변경은 작업 루트 내부 경로에 한정한다.

| 작업 | 선행 | 하위 작업 | 예상 경로 | 완료 기준과 검사 |
| --- | --- | --- | --- | --- |
| T01 환경·명세·Git | 승인 | T01.1 버전·캐시·로컬 Git 설정 / T01.2 명세 추적·검사 runner | package 파일, scripts, docs, .local | 반복 빌드, 로컬 push·merge 증거. R27·R28, C27·C28 |
| T02 공통 OS 작업 공간 | T01 | T02.1 shell·홈·창 관리자 / T02.2 키보드·반응형·전송 하단 틀 | renderer/shell, home, styles | 창과 홈 수명 검사. R01·R02·R29, C01·C02·C29 |
| T03 연결·신뢰·저장 | T01 | T03.1 프로필·키·호스트 신뢰 / T03.2 worker 세션·권한 경계·복구 | main, worker/sessions, shared, connections | 실제 인증·장애 검사. R04–R08·R24, C04–C08·C24 |
| T04 파일 탐색·변경 | T02·T03 | T04.1 트리·목록·경로 / T04.2 생성·이름·삭제·미리보기 | worker/sftp, renderer/apps/files | 실제 파일 fixture 검사. R09–R11, C09–C11 |
| T05 비동기 전송 | T03·T04 | T05.1 queue·stream·progress / T05.2 폴더·충돌·취소·복구 | worker/transfers, main/storage, transfers | 바이트 동일성·장애 검사. R12–R17, C12–C17 |
| T06 시스템·프로세스 | T03 | T06.1 샘플 수집·계산 / T06.2 조회 UI·프로세스 종료 | worker/ubuntu-24, system, processes | 계산·소유권 검사. R18·R20, C18·C20 |
| T07 서비스·로그 | T03·T06 | T07.1 서비스 조회·변경 / T07.2 journal·앱 연계 | worker/commands, services, logs | sudo·상태 확인·실시간 검사. R19·R21·R22, C19·C21·C22 |
| T08 설정·품질 | T02–T07 | T08.1 저장·기록·초기화 / T08.2 접근성·부하·시안 대조 | settings, main/storage, tests | 설정·반응성 검사. R23·R25·R29, C23·C25·C29 |
| T09 대상 검증·배포 | T08 | T09.1 대상 조합 검증 / T09.2 패키지·소스·완성 시나리오 | tests/e2e, evidence, docs, package config | 대상 전체 PASS. R03·R26·R30, C03·C26·C30 |

T02와 T03처럼 논리적으로 독립된 작업도 같은 파일을 변경할 때는 순차 실행한다. 하위 에이전트 병렬 실행은 사용자의 별도 지시가 있는 경우에만 사용한다. 개발 소요 기간은 검증 환경과 구현 속도를 측정한 뒤 산정하며 이 계획의 일정 기준은 달력 날짜보다 위 완료 조건이다.

## 11 검증 계획

### 11.1 실행 명령 계약

T01에서 아래 npm script를 구현한다. 작업 시작 전에는 이 명령이 존재한다고 주장하지 않는다.

| 명령 | 실행 범위 |
| --- | --- |
| npm run typecheck | main·preload·worker·renderer TypeScript 검사 |
| npm run test:unit | 상태 전이·파서·계산·경로·스키마 검사 |
| npm run test:integration | 로컬 SSH fixture로 인증·SFTP·장애·IPC 검사 |
| npm run test:e2e | Electron UI의 실제 entry point로 사용자 흐름 검사 |
| npm run test:target | 승인된 Ubuntu VM의 실제 OpenSSH·systemd·sudo 검사 |
| npm run build | 코드 빌드와 번들 결과 확인 |
| npm run package | 실행 중인 대상 OS·아키텍처 패키지 생성 |
| npm run verify | typecheck → unit → integration → e2e → build 순서 실행 |

VM 접속 정보는 `.local/target-config.json`에 두고 비밀번호는 검사 프로세스 환경 또는 대화형 입력으로 전달한다. 실제 운영 서버는 테스트 fixture로 사용하지 않는다. 테스트용 서버 설치·설정은 대상 서버가 사용자에게 시험용으로 지정된 후 수행한다. 대상이 없으면 로컬 SSH fixture와 UI 검사를 진행하고 target 검사만 미검사로 남긴다.

### 11.2 대상 환경

클라이언트는 macOS arm64, macOS x64, Windows 11 x64 세 종류다. 서버는 Ubuntu Server 24.04 LTS amd64와 arm64 두 종류다. 6개 조합에서 C05·C06·C12·C19·C21·C30을 수행한다. 나머지 알고리즘 검사는 최소 한 클라이언트에서 수행하고 네이티브 암호화·파일 경로·패키징 검사는 클라이언트 세 종류 각각 수행한다.

성능 기준 장비는 클라이언트 4 논리 CPU·8 GiB RAM 이상, 서버 2 vCPU·4 GiB RAM 이상, 테스트 네트워크 RTT 20 ms 이하·100 Mbit/s 이상이다. 10,000개 파일 목록과 1 GiB 전송 3개를 동시에 실행하고 100회 파일 선택·창 전환의 p95 입력 반응 100 ms 이하를 확인한다. 전송 이벤트가 worker에서 만들어진 뒤 화면 반영까지 p95 500 ms 이하, cold start 후 홈 표시 3초 이하, 1 GiB 3개 전송 중 앱 총 RSS 600 MiB 이하를 검사한다. 장비·OS·RTT·실제 처리량을 증거에 기록한다.

### 11.3 검사 목록

| 검사 | 방법 | 반드시 포함할 사례 |
| --- | --- | --- |
| C01 | E2E·시각 | 빈 홈, 서버 2대, 앱 전환, 모든 화면에서 전송 영역 |
| C02 | E2E | 서로 다른 서버의 파일 창 2개, 위치·크기·최대화·재실행·12개 한도 |
| C03 | 대상 | 지정한 6개 조합과 지원 OS 거절 |
| C04 | 단위·E2E | 포트 경계, IPv6, 입력 공백, 프로필 수정·삭제, 10대 한도 |
| C05 | 통합·대상 | 비밀번호, Ed25519·RSA·ECDSA, 각 암호화 키, 잘못된 비밀과 포맷 |
| C06 | 통합 | 최초 수락·거절, 일치, 키 교체, transfer 연결의 다른 키 차단 |
| C07 | 통합·E2E | DNS 실패, timeout, 취소, keepalive, 두 서버 중 한 서버 끊김 |
| C08 | 네이티브·단위 | 저장 꺼짐·켜짐, restart, 삭제, encryption unavailable, 복호화 실패 |
| C09 | E2E | 트리·경로 이력, 숨김, 정렬, 10,000개 목록, 응답 역전 |
| C10 | 통합 | 빈 폴더, 재귀 폴더, 권한 없는 파일, symlink cycle, 이름 충돌 |
| C11 | 단위·대상 | 1 MiB 경계, binary·invalid UTF-8, Windows 예약명, 대소문자 충돌 |
| C12 | 통합·대상 | 0 byte, 1 byte, 1 GiB, 5 GiB, 중첩 폴더, Unicode·공백·quote·개행 이름, 양방향 SHA256 |
| C13 | E2E·계측 | 업로드 중 앱 전환, 파일 창 닫기, finalizing 지연, 99→100, 준비 중 퍼센트 없음 |
| C14 | 단위·통합 | 전체·서버 동시 한도, 같은 목적지 2개, 서버별 대기 공정성 |
| C15 | 통합 | 덮어쓰기 원본 보존, destination change, rename 실패, fsync 실패, 디스크 부족 |
| C16 | 통합·E2E | queued·discovering·running 취소, cleanup 실패, 신규 retry ID, source change |
| C17 | 통합·E2E | 네트워크 절단, worker kill, renderer reload, 앱 종료, finalizing crash |
| C18 | 단위·대상 | 고정 proc fixture, CPU guest 중복 배제, MemAvailable, df parsing, 읽기 실패 |
| C19 | 대상 | inactive·active·oneshot·failed 서비스, 일반 권한, sudo 성공·실패, timeout 후 실제 상태 |
| C20 | 단위·대상 | PID 재사용 fixture, UID 불일치, 자신의 helper 종료, SIGTERM 무시 helper, 보호 PID |
| C21 | 통합·대상 | JSON string·array·null, Unicode chunk split, cursor 중복, follow, 필터·한도·권한 오류 |
| C22 | E2E | 서비스에서 로그 열기, 서버 A 이벤트가 서버 B 창에 표시되지 않음 |
| C23 | 단위·E2E | 7일·1,000개 보존 경계, corrupt primary와 backup, 초기화, credential 삭제 |
| C24 | 단위·통합 | IPC unknown method·잘못된 sender·input 거부, shell 인용, secret logging 검사 |
| C25 | E2E·수동 | 성능 표본 100개, 최소 크기, 키보드만 조작, 대비, reduced-motion |
| C26 | 대상·수동 | 각 OS 설치·실행·제거, 다른 경로 소스 npm ci/build, LICENSE·고지·지원 환경 문구 |
| C27 | 로컬 검사 | main·기능 브랜치·bare origin SHA·병합 commit·브랜치 제거 |
| C28 | 구조·수동 | 모든 R에 T와 C 연결, 실제 승인 근거, 증거 commit와 상태 일치 |
| C29 | 시각 | 1600×1000와 1100×720, 영역 치수 4 px 이내, 시안의 파일·서비스·전송 동시 표시 |
| C30 | 대상 E2E | 아래 완성 시나리오의 처음부터 끝까지 |

### 11.4 완성 시나리오

1. 새 로컬 데이터 경로에서 sshOS를 실행한다.
2. Ubuntu 서버 A를 비밀번호로 추가하고 호스트 지문을 확인한다.
3. Ubuntu 서버 B를 암호화된 SSH 키로 추가한다.
4. A의 파일 앱에서 새 폴더를 만들고 로컬 중첩 폴더와 1 GiB 파일을 업로드한다.
5. 전송 중 B의 시스템·서비스 창을 열고 지정된 테스트 서비스를 재시작한다.
6. 서비스에서 로그 창을 열어 실제 테스트 로그를 확인한다.
7. A의 파일 창을 닫아도 전송이 계속되고 하단에서 완료를 확인한다.
8. 파일 창을 다시 열고 업로드 결과를 새 로컬 폴더에 다운로드한다.
9. 원본·업로드된 원격·다운로드 결과의 SHA256을 비교한다.
10. 새 전송을 시작한 뒤 A의 네트워크를 끊고 A의 중단 상태와 B의 지속 동작을 확인한다.
11. A 재연결 후 재시도해 완료한다.
12. 앱을 재실행해 프로필·창·기록을 복원하고 서버는 연결 대기 상태임을 확인한다.

## 12 로컬 Git 작업 흐름

M0에서 기존 Git 상태와 origin을 확인한다. 신규 로컬 저장소의 기본 브랜치는 main이다. bare 저장소는 `<root>/.local/git-origin.git`, canonical origin은 이 절대 경로다. 현재 Git 사용자 이름·이메일이 없으면 그 두 값만 사용자에게 요청한다. 사용자 identity를 추측해 만들지 않는다. bare 저장소는 push와 merge 검증용으로 사용하며 같은 디스크의 이 저장소를 외부 백업으로 표현하지 않는다. [git init](https://git-scm.com/docs/git-init)

초기 `.gitignore`에는 `.local/`, node_modules/, out/, dist/, coverage/, playwright-report/, test-results/를 포함한다. 문서와 승인 기록, 소스, lockfile, 비밀 제거된 evidence는 tracked 대상으로 한다. 실제 키, 인증 파일, 시험 서버 접속 정보는 staging 대상에서 제외한다.

초기 main commit 메시지는 `docs: define sshOS v1 implementation contract`다. 이후 작업 브랜치는 `feat/t01-foundation`, `feat/t02-workspace`처럼 작업 ID와 기능명을 사용한다. 하나의 작업을 여러 commit으로 나눌 수 있으며 각 commit은 독립적으로 설명 가능한 변경을 가진다.

각 작업의 순서는 다음으로 고정한다.

1. main의 clean 상태와 `origin/main` SHA 일치를 확인한다.
2. 해당 작업 브랜치를 생성한다.
3. 구현과 관련 검사를 완료한다.
4. `git diff --check`와 변경 목록·비밀 포함 여부를 확인한 뒤 명시한 경로만 stage한다.
5. 사용자 identity로 commit하고 기능 브랜치를 로컬 origin에 push한다.
6. diff와 요구사항 검사를 검토하고 결과를 evidence에 기록한다.
7. main으로 전환하고 `--no-ff --no-commit`으로 병합한다.
8. 병합 결과에서 관련 검사와 build를 수행한다. 통과하면 병합 commit을 만든다.
9. main을 로컬 origin에 push하고 두 main SHA의 일치를 확인한다.
10. 병합된 정확한 기능 브랜치만 remote에서 삭제하고 local branch를 `-d`로 삭제한다. remote ref·tracking ref·local ref가 모두 없는지 확인한다.

병합 충돌이 있으면 현재 작업 범위 안에서 해결하고 해당 검사를 다시 수행한다. 검증 실패 때는 수정하거나 이번 병합만 abort한다. 다른 사용자의 변경을 reset·clean으로 제거하지 않는다. main, default, 보호된 브랜치, 현재 작업과 무관한 브랜치는 정리 대상이 아니다. 모든 작업 종료 시 원래 존재하던 파일과 이번에 생성한 임시 파일을 구분해 이번 임시 파일만 정리한다. [git merge](https://git-scm.com/docs/git-merge)

사용자가 후속으로 GitHub origin을 지정하면 그 origin을 기준으로 `github-app-governance`와 `github-ops`를 읽고 해당 guarded flow를 적용한다. 로컬 origin용 절차를 GitHub write에 전용하지 않는다. GitHub 전환 시 필요한 App 확인·계획 guard·사람 write·현재 head App review·사람 merge·브랜치 정리는 해당 시점의 전역·저장소 지침을 따른다.

## 13 공개 가능한 산출물과 완료 판정

1.0.0 산출물은 macOS arm64 DMG, macOS x64 DMG, Windows x64 NSIS installer, 소스와 lockfile, MIT LICENSE, THIRD_PARTY_NOTICES, 설치·연결·전송·서비스 권한 안내, 실제 검사 결과다. 소스 공개 또는 원격 게시 시점은 후속 사용자 지시에 따른다. 로컬 개발 완료 판정에는 패키지 실제 실행이 포함된다. 코드 서명과 notarization은 공개 배포 단계의 별도 자격 증명을 사용하며 unsigned 내부 시험 결과를 signed 공개 배포 완료로 기록하지 않는다.

완료 조건은 R01–R30의 모든 검사 통과, 지원 조합 실제 검증, 미해결 필수 결함 0개, 계획 범위의 기능이 실제 정상 진입점에서 동작, 사용자 데이터 보존, 검증 증거와 현재 SHA 일치, 로컬 push·merge·브랜치 정리 완료다. 명세 구조 검사만 통과한 상태는 개발 완료 판정에 사용할 수 없다.

## 14 검토용 예상 화면

이미지 파일은 `design/sshOS-v1-preview.png`다. 기준 장면은 1600 × 1000 비율의 sshOS 전체 콘텐츠이며 홈의 연결 상태를 배경으로 파일 창과 서비스 창이 열려 있고 하단에는 서로 다른 서버의 실제 형식 전송 2개가 보인다. 예시 데이터는 구현 검증용 fixture에서도 동일하게 사용할 수 있다.

| 항목 | 고정 예시 |
| --- | --- |
| 서버 A | 별칭 Ubuntu Lab, ubuntu@192.0.2.10:22, Ubuntu Server 24.04 LTS |
| 서버 B | 별칭 Web Server, deploy@192.0.2.20:22, Ubuntu Server 24.04 LTS |
| 파일 경로 | `/home/ubuntu/projects` |
| 폴더 | website, backups, reports |
| 파일 | README.md, server-notes.txt |
| 서비스 창 | Web Server의 nginx.service, 상태 실행 중, 시작·중지·재시작·로그 보기 |
| 전송 1 | release.zip, Ubuntu Lab으로 업로드, 620 MiB / 1000 MiB, 62%, 12.4 MiB/s |
| 전송 2 | logs.tar.gz, Web Server에서 다운로드, 120 MiB / 400 MiB, 30%, 8.0 MiB/s |

이미지는 생성형 도구로 만든 계획 시안이며 실행 화면의 증거는 C29에서 구현 후 캡처한 이미지로 남긴다. 생성 프롬프트는 `design/preview-prompt.txt`에 보관한다. 문구와 픽셀에 오차가 생기면 제품 계획서의 수치와 동작을 구현 기준으로 사용한다.
