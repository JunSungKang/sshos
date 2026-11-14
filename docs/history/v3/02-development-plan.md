# sshOS(시오스) 개발 계획서 — v3

작성일 2026-11-14. 목표 1.0.0. **SDD 구현 계약 초안, 코드 미착수, 승인 pending**. GPT 6.1 sol extra high를 포함한 모든 구현자는 같은 계약을 따른다. 먼저 [제품 계획서](01-product-plan.md), [조사 보고서](03-research-and-positioning.md), [spec-v3.json](spec-v3.json)을 읽는다. 영문 `sshOS`, 한글 `시오스`, 문서 표기 `sshOS(시오스)`를 사용한다.

## 1. 착수·변경·작업 경계

이번 산출물은 조사와 계획이다. 신규 단일 파일 서비스 전략은 계획자의 제안이다. 후속 개발 요청이 어느 판본을 승인하는지 실제 메시지와 scope digest로 기록한다. 승인 전 구현·설치·Git 초기화·서버 변경을 시작하지 않는다. 문서 구조 검사는 승인 인증이나 기능 시험이 아니다.

방법론은 SDD를 제안한다. Focused Fix는 신규 제품에 부족하고, Sprint Delivery는 마일스톤 진행에 활용하며, TDD는 journal·무결성·복구 상태의 실패 검사에 적용한다. AI-DLC 전체 도입 대신 명세 승인·변경 영향 추적을 적용한다. 파일·서버 변경의 결과를 명세와 연결하기 위해 SDD가 가장 적합하다.

구현 규칙: R3 ID→T3 ID→C3 ID를 연결한다. 정의된 enum·수치·문구를 따른다. 성공은 명령을 보냈다는 사실로 판정하지 않는다. fixture를 실제 접속 실패의 대체 데이터로 사용하지 않는다. 필요한 계약을 만족하지 못하면 해당 기능을 차단하고 오류를 표시한다. 범위 변경은 새 판본과 재검사 범위를 먼저 기록한다.

작업 루트는 `/Users/kkkk/Desktop/jskang/03.workspace/01.project/sshOS`다. 쓰기 전 resolve해 내부인지 확인한다. 개발·검사 중 캐시·임시·앱 데이터·로그·패키지 출력·bare origin은 `.local/` 아래만 사용한다. HOME·CODEX_HOME은 변경하지 않는다. Electron ready 이전에 userData/sessionData/logs/crashDumps 경로를 설정하고 `TMPDIR`, `TMP`, `TEMP`, `npm_config_cache`, `ELECTRON_CACHE`, `ELECTRON_BUILDER_CACHE`, `PLAYWRIGHT_BROWSERS_PATH`도 이 루트에 지정한다. 각 실행 도구의 기본 외부 출력을 확인하고 재지정 불가면 그 실행을 보류한다. 설치된 최종 제품의 정상 사용자 데이터 위치와 현재 개발 환경의 쓰기 경계를 혼동하지 않는다.

## 2. 기술 구성과 버전

선택한 구성은 Electron과 TypeScript 기반의 단일 데스크톱 프로젝트다. React는 작업 공간과 앱 화면, ssh2는 SSH와 SFTP, Electron utility process는 원격 I/O를 담당한다. context isolation과 제한된 preload API를 적용한다. [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation/), [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process), [ssh2 공식 저장소](https://github.com/mscdex/ssh2)

2026년 11월 14일 공식 배포 메타데이터에서 확인한 초기 고정 버전은 아래와 같다. package.json 직접 의존성은 `^`와 `~` 없이 기록하고 npm의 `package-lock.json`을 커밋한다. 아래 버전의 조합은 설치·빌드 검증 전이므로 T3-02에서 검증한다. 설치 실패 시 오류와 충돌한 패키지를 기록하고 해당 값만 새 명세 판본으로 수정한다.

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

### 2.1 기존 기술 선택의 라이선스 점검

사용자가 선택한 Electron은 macOS·Windows 공통 코드 기반의 실행 기술로 유지한다. Electron의 최상위 코드 라이선스는 MIT이며 포함된 Chromium·Node.js 및 하위 구성요소의 고지는 실제 배포 번들에서 별도로 수집한다. [Electron 소개](https://www.electronjs.org/docs/latest), [Electron LICENSE](https://github.com/electron/electron/blob/main/LICENSE)

| 구성요소 | 이번 확인 범위 | 개발 시 처리 |
| --- | --- | --- |
| Electron, React, React DOM, Vite, electron-vite, React 플러그인, @types/ssh2, Zod, Zustand, Vitest, electron-builder | 계획의 고정 버전에 대해 npm 메타데이터가 MIT를 선언함 | 설치본 원문·copyright·전이 의존성을 C3-28에서 확인 |
| ssh2 1.17.0 | npm 최상위 license 값은 비어 있으나 v1.17.0 태그의 LICENSE는 MIT 원문 | 태그와 실제 npm archive의 LICENSE 일치를 확인 |
| TypeScript 7.0.2, @playwright/test 1.65.1 | npm 메타데이터가 Apache-2.0을 선언함 | build-only와 test-only로 기록하고 원문·NOTICE·배포 포함 여부 확인 |
| lucide-react 1.72.0 | npm 메타데이터가 ISC를 선언함 | runtime-bundled로 기록하고 아이콘별 출처·추가 고지 확인 |
| 글꼴 | v3에서는 OS 시스템 글꼴 사용 | 외부 글꼴 번들 없음 |

이 표는 직접 의존성의 선언값 조사 결과다. 실제 lockfile과 설치 archive, 아이콘·글꼴, Electron 배포 bundle의 라이선스 검사는 C3-28의 완료 조건으로 남는다. TypeScript와 Playwright는 정한 언어·시험 체계의 개발 도구, lucide-react는 기존 UI 아이콘 체계의 OSS 대안으로 채택한다. 신규 구성요소는 14절의 MIT 우선 선택 규칙을 따른다. [npm 공식 레지스트리](https://registry.npmjs.org/), [ssh2 1.17.0 LICENSE](https://raw.githubusercontent.com/mscdex/ssh2/v1.17.0/LICENSE)

## 3. 구조와 책임

다음 경로는 예정 산출물이다. 이번 계획 단계에서 코드 파일을 만들지 않는다.

```text
src/main/{index,ipc,storage,credentials,host-trust,worker-supervisor,source-archive}.ts
src/preload/index.ts
src/shared/{contracts,schemas,errors}.ts
src/worker/{index,sessions,sftp,transfers,slots,operations,reconcile,ubuntu-24}.ts
src/remote/helper.py
src/renderer/shell/Workspace.tsx
src/renderer/apps/{home,connections,files,tasks,settings}/
tests/{unit,integration,e2e,fixtures}/
scripts/{verify,run-dev,run-tests,check-licenses,package-source}.mjs
docs/{implementation-state.json,server-prerequisites.md,dependency-licenses.json,upstream-contributions.md}
evidence/{technical,usability,release}/
.local/{git-origin.git,app-data,cache,tmp,test-runs,dist}/
```

| 경계 | 소유 책임 |
| --- | --- |
| renderer | UI·입력·표시. 원격 작업 상태 원본, 파일시스템, SSH 소켓을 소유하지 않음 |
| preload | 고정된 typed API와 unsubscribe 가능한 이벤트 구독 |
| main | IPC sender 검증·파일 선택·secret·local journal·worker supervision·source export |
| utility worker | SSH/SFTP·queue·hash stream·명령 구성·remote receipt 검증 |
| helper | 단일 명령의 사전 검사·lock·remote journal·backup/replace·systemctl 호출·관측 |

utility worker는 하나다. 서버마다 control SSH 1개, 실제 byte 전송 때 transfer SSH 최대 1개다. 전체 3서버/6연결 이하, control SFTP 1채널과 exec 최대 2채널, transfer SFTP 1채널이다. 예약된 읽기 polling보다 현재 작업 확인을 먼저 처리하며 변경 명령을 겹쳐 실행하지 않는 unit 단위 mutex를 둔다. 진행 표시용 task-status 읽기는 이 mutex의 예외다. transfer 연결의 host key도 같은 trust record로 검사한다. control 단절이면 해당 서버 전체를 disconnected로 바꾸고 transfer를 닫는다. transfer만 단절이면 다른 서버와 control은 유지한다.

helper는 앱에 포함된 고정 Python3.12 소스를 SSH exec의 `/usr/bin/python3 -I -B -c '<고정 소스>'`로 실행한다. 소스의 POSIX shell 인용은 중앙 함수 하나로 처리하며 사용자 문자열을 그 소스에 합성하지 않는다. 입력은 UTF-8 JSON 한 줄로 stdin에 주고 EOF로 닫는다. 실행 코드는 서버에 설치하지 않는다. `.sshos`의 manifest·journal·stage·backup은 의도적으로 남는다. 원격 상주 프로세스·systemd agent·nohup·daemonization은 만들지 않는다. helper 생존을 연결 복구의 전제로 삼지 않는다.

## 4. 데이터 계약과 이벤트

모든 JSON은 Zod 또는 helper의 대응 schema로 검사한다. 알 수 없는 필드는 거절한다. 날짜는 UTC ISO8601, byte·offset은 0 이상 안전한 정수, hash는 소문자 SHA-256 64자리다. UUID는 v4다. 실제 artifact/service 변경 입력은 `requestId`, `taskId`, `operationId`, `serverId`, `sessionGeneration`, `slotId`, `expectedRevision`을 포함한다. 조회·등록·예약·취소는 §8의 command별 schema를 사용한다. UUID의 의미를 서로 대체하지 않는다.

| 식별자 | 의미·수명 |
| --- | --- |
| serverId | 로컬 프로필 UUID. host/port/user 수정은 새 serverId 생성. 활성 작업 프로필 삭제 금지 |
| remote identity | 확인한 host key fingerprint + remote machine-id + 로그인 UID. machine-id 변경 시 재등록 필요; 이를 암호학적 장치 증명으로 홍보하지 않음 |
| slotId | remote manifest UUID. canonical path와 st_dev/st_ino를 함께 기록, directory identity 변경 시 차단 |
| taskId | 한 파일 준비에서 적용·관측·복원 기록을 묶는 작업 UUID |
| operationId | 실제 변경 시도 UUID. apply/restore/restart 각각 새 값, 같은 ID로 명령 자동 재실행 금지 |
| requestId | IPC/프로토콜 호출 상관관계. 같은 호출의 중복 접수는 기존 결과 조회로 처리 |
| revision | 실제 변경 operation을 접수하는 DB transaction마다 증가. 실행 실패해도 되돌리지 않음. lock 안에서 expectedRevision 일치 검사 |
| workerEpoch | main이 worker를 만들 때 발급하는 UUID. 재생성마다 변경 |
| sessionGeneration | 동일 serverId의 재접속마다 증가. 이전 세션 이벤트 무효화 |
| sequence | workerEpoch 내 단조 증가 정수. snapshot은 해당 epoch의 마지막 sequence 포함 |

구독 시작은 main이 delta를 잠시 버퍼링하고 일관된 snapshot을 보낸 다음 snapshot 이후 sequence만 전달한다. epoch 변경 시 renderer는 이전 버퍼·sequence를 폐기하고 새 snapshot을 원자적으로 교체한다. sequence gap은 snapshot 요청, 낮거나 같은 sequence는 무시한다. serverId/sessionGeneration 불일치는 무시한다. reconnect snapshot이 곧 원격 성공 확인을 뜻하지 않는다.

연결 profile 필드: name(1–40자), host(DNS 또는 IPv4, 최대253 ASCII, scheme/path/공백 금지), port(1–65535, 기본22), username(1–32 ASCII `[a-z_][a-z0-9_-]*`), auth(password/key), keyPath, rememberSecret(default false). IPv6·SSH config import는 제외한다. 저장 최대10개, 동시3개. 동일 host+port+username 중복 등록 금지. host alias가 같은 슬롯을 가리키는 경우 remote lock이 최종 직렬화한다.

## 5. 접속·신뢰·secret

연결 상태는 `idle → connecting → awaiting_host_trust → authenticating → inspecting → ready`이며 각 단계에서 `cancelled/failed/disconnected`로 종료할 수 있다. ssh2 readyTimeout=0으로 두고 앱 자체 phase deadline을 사용한다. TCP+handshake는 hostVerifier 대기 시간을 제외한 15초, trust 확인은 별도 120초, trust 승인 후 인증은 30초다. 일반 조회는 10초이며 command별 우선순위는 §8을 따른다. keepalive 10초/응답 누락3회. host trust 사용자 확인 대기는 120초 후 취소한다. ready를 표시하려면 OS·Python·SFTP 조회가 끝나야 한다. 슬롯 미등록 상태는 ready와 별개다.

최초 fingerprint는 알고리즘과 SHA256을 표시하고 확인 전 인증을 진행하지 않는다. 미리 저장된 키 변경은 연결 실패다. 설정에서 대상 host:port와 구·신 fingerprint를 모두 표시하는 별도 신뢰 교체 절차를 거친다. 진행 중 작업이 있으면 교체를 막는다. 키 변경은 기존 세션/작업을 새 서버에서 자동 이어갈 권한이 아니다.

키 형식은 OpenSSH Ed25519/RSA 개인 키, PEM RSA, encrypted/unencrypted를 지원한다. RSA 최소2048, DSA/인증서/보안키/PuTTY PPK/keyboard-interactive는 제외한다. 암호화 키 passphrase는 비밀번호와 구별한다. RSA 사용자 인증은 고정된 ssh2의 협상 동작을 사용한다. 지원 Ubuntu 서버의 기본 SHA2 인증을 실제 fixture에서 확인한다. serverHostKey 설정과 사용자 인증 서명 협상은 별개이며, 이 앱이 사용자 인증의 SHA1 fallback까지 독립적으로 차단한다고 주장하지 않는다. v3는 이를 위한 ssh2 비공개 API 사용이나 fork를 추가하지 않는다. [ssh2 v1.17.0 구현](https://raw.githubusercontent.com/mscdex/ssh2/v1.17.0/lib/client.js) 키 자체는 원본 파일에서 main이 읽어 worker에 일시 전달하고 복사본을 영구 저장하지 않는다.

rememberSecret=true일 때만 Electron safeStorage의 async API로 암호화해 로컬에 저장한다. key passphrase·SSH password를 renderer 상태·작업 receipt·로그·명령 인자에 남기지 않는다. 암호화 불가면 저장을 실패시키고 세션만 사용하도록 선택할 수 있다. plaintext fallback은 없다. 프로필 삭제/저장 해제 시 암호문 삭제. sudo password는 지원하지 않는다.

자동 재접속은 하지 않는다. `다시 연결`은 사용자 동작이며 연결 후 미완료 작업을 자동 **조회**할 수 있지만 변경 명령을 자동 재전송하지 않는다.

## 6. 슬롯 등록·지원 검사

등록 입력: slotPath(절대 POSIX UTF-8, 최대1024byte), artifactName(단일 component, 1–128byte, `.`/`..`/slash/NUL/control 금지), unit(`[A-Za-z0-9][A-Za-z0-9_.-]{0,126}\.service`, template/alias 금지), healthPort(1–65535), healthPath(`/`로 시작, ASCII 최대256, query/fragment/control/percent-encoded traversal 금지). health는 localhost 고정이며 원격 응답 URL을 따라가지 않는다.

`inspect`는 변경 없이 다음을 검사한다. `/etc/os-release`의 ID=ubuntu/VERSION_ID=24.04, uname x86_64/aarch64, PID1 systemd, python3 3.12, 표준 sqlite3 import와 SQLite 3.45 이상 4 미만, `/usr/bin/systemctl`·`/usr/bin/journalctl`·`/usr/bin/sudo` 존재, SFTP 초기화, 로그인 UID≠0. 경로를 `/`에서 dirfd/O_DIRECTORY/O_NOFOLLOW로 한 component씩 연다. symlink·부모 identity 변경·group/other writable ancestor를 거절한다. 로그인 UID 아닌 ancestor는 root 소유만 허용한다.

등록 시 filesystem은 `/proc/self/mountinfo`를 파싱해 슬롯에 적용되는 가장 긴 mountpoint의 ext4 여부를 확인한다. 기존 slot의 st_dev, 파일 nlink=1, 소유 UID/기본GID, xattr/ACL 없음, mode 특수bit없음, slot group/other write없음을 검사한다. `os.listxattr` 실패도 지원 확인 실패다. unit show의 Id/LoadState/Type/Restart/FragmentPath, ActiveState=active, SubState=running, Job=0, InvocationID 유효를 확인한다. alias는 입력unit≠Id면 차단한다. 읽기권한을 확인하고 journalctl permission 오류/경고는 registration 실패로 처리한다.

restart 권한은 `/usr/bin/sudo -n -l -- /usr/bin/systemctl restart -- <unit>`의 종료 성공을 검사한다. 실제 변경 직전도 재검사한다. 이 검사는 명령 실행 성공이나 모든 정책 부작용을 보장하지 않는다. 실제 restart 실패는 별도로 기록한다. sudoers의 정확한 허용 명령 예제와 journal 읽기 준비는 `server-prerequisites.md`에 기재하고 앱에서 직접 편집하지 않는다.

사용자가 준비 전제 2개(외부 writer 없음, 데이터 migration 없음)를 확인한 다음 `register` 명령만 `.sshos`를 만든다. mode0700, manifest와 lock0600. 기존 `.sshos`가 유효 manifest를 갖지 않으면 차단한다. lock 파일은 한번 만든 inode를 계속 사용하며 삭제·replace하지 않는다. manifest에는 schemaVersion=1, slotId, helperProtocol=1, 원격 identity, 경로 identity, slot 설정을 기록한다. state.sqlite3를 초기화하고 생성한 내부 디렉터리·DB의 st_dev가 slot과 같은지 확인한다. stage/backup은 실제 생성 직후에도 st_dev를 검사한다. 다른 클라이언트가 유효 manifest를 발견하면 동일 조건으로 가져오며 새 slotId를 만들지 않는다.

## 7. 파일·전송 계약

탐색은 slot root 아래에서만 가능하다. component는 경로 schema와 helper safe walk로 확인한다. symlink와 특수파일은 따라가지 않으며 경계가 바뀌면 실패한다. 목록은 최대10,000개. 변경·재귀 복사·텍스트 편집 UI는 없다. 비UTF-8 이름은 escaped 표시하고 다운로드 비활성화한다. SFTP 경로 검사만으로 악의적인 동시 writer에 대한 방어를 보장하지 않는다. 등록의 전용 경로 전제가 적용된다.

### 7.1 업로드 준비

1. native picker에서 단일 일반 파일을 고른다. symlink/reparse point, 0byte, >2GiB는 거절한다. 큐 전체 한도20개, 슬롯당 미완료 upload task 1개다.
2. 파일을 연 handle로 읽어 main이 정한 appData/snapshots 아래 작업 사본(mode0600; 개발 시 루트 내부 .local/app-data)을 만든다. 사본 바이트로 SHA256을 계산하고 fsync한다. source handle의 전후 size/mtime/file identity가 달라지면 취소한다. 같은 metadata를 유지한 외부 변경까지 탐지한다는 보장은 하지 않는다. 실제 전송 대상은 이 사본의 hash이며 원본 전체의 어느 한 순간 snapshot이라고 주장하지 않는다.
3. local journal 저장 성공 후 원격 reserve를 요청한다. lock 안에서 unresolved operation 없음과 remote free space ≥newSize+oldSize+16MiB를 확인하고 task manifest·stage 이름을 생성한다. 공간 검사는 경쟁하는 디스크 사용을 예약하지 않으므로 모든 write 오류도 처리한다.
4. SFTP로 `.sshos/tasks/<taskId>/upload.part`를 O_EXCL 새 파일0600으로 생성한다. 전역2/서버별1 transfer, FIFO다. stream backpressure를 사용하며 파일 전체를 메모리에 적재하지 않는다.
5. SFTP close 후 helper `verify-stage`가 안전하게 연 파일을 fsync·hash하고 manifest의 size/hash와 비교한다. 일치하면 같은 dir의 `artifact.ready`로 rename 후 dir fsync한다. ready 파일은 apply 전 다시 hash한다. 검증 실패면 live에 접근하지 않는다.
6. `staged`로 표시한다. 업로드 자체가 서비스 변경을 수행하지 않는다. old/newhash가 같으면 apply preflight에서 `NO_CHANGE`로 종료하고 backup·replace·restart를 생략한다.

### 7.2 다운로드

일반 파일 1개를 선택하고 main의 native save picker로 아직 존재하지 않는 목적지를 고른다. worker가 remote 시작 hash/size를 helper로 얻고, SFTP 열린 handle의 fstat를 확인해 `.sshos-download-<uuid>.part`에 쓴다. 전송 바이트 hash와 종료 remote hash/metadata가 모두 시작 값과 일치해야 완료다. 일치하지 않으면 “원격 파일 변경 감지” 실패다. 외부 writer 없음 전제에서도 검사를 생략하지 않는다.

로컬 임시 파일 fsync 후 **기존 목적지를 절대 덮어쓰지 않는** 확정 연산을 사용한다. 같은 디렉터리의 hardlink로 temp inode를 목적지에 배타 생성한 뒤 temp를 unlink한다. 목적지 존재/파일시스템 미지원/권한 오류 시 실패시키고 다른 경로 선택을 안내한다. NTFS·APFS의 local 일반 디렉터리에서 검증한다. network/cloud-sync/FAT/exFAT 목적지는 공식 지원하지 않는다. 부모 symlink/reparse를 거절하고 실행 도중 부모 identity 변경 시 실패한다. local 경로 역시 동시 악의적 writer와의 무손실 보장을 하지 않는다. hardlink 성공 시 destinationCreated=true를 local receipt에 기록한다. 이후 temp unlink 실패는 다운로드 성공·정리 필요이며 목적지를 삭제하거나 자동 재다운로드하지 않는다. link 직후 crash로 receipt가 없으면 재실행 시 task의 temp/destination inode와 hash를 대조해 일치한 경우에만 생성 사실을 복구한다. 증거가 부족하면 결과 확인 필요로 남긴다. 파일의 기본 접근 권한은 macOS0600, Windows 선택한 목적지 부모 디렉터리의 상속 ACL이며 원격 owner/ACL을 복사하지 않는다.

0byte 일반 파일 다운로드는 지원한다. 전체0byte는 byte phase를 건너뛰어 검증→완료로 처리한다. 파일명은 native picker 사용자가 정하며 Windows 예약 이름·Unicode/case 충돌은 파일시스템의 배타 생성 결과로 판단한다. OS 이름만으로 case sensitivity를 단정하지 않는다.

### 7.3 표시·취소·재시도

transfer state는 `queued → snapshotting/uploading/downloading → verifying → completed`, 오류 종료는 `cancelled/interrupted/failed`다. upload의 completed는 “파일 준비 완료”이며 remote task의 staged와 대응한다. apply 성공과 구분한다. queued/snapshotting/uploading/downloading/verifying/staged에서는 취소 요청을 허용한다. apply 시작 후에는 취소 UI를 제공하지 않는다.

취소 시 byte 채널을 닫고 5초 안에 local UI를 `취소 요청됨`으로 바꾼다. 원격 cancel-task가 durable하게 commit돼야 `취소됨`이다. 연결 불가·lock busy면 `전송 중지 · 원격 취소 확인 필요`를 유지한다. cancel-task와 늦은 verify-stage는 같은 lock/DB에서 직렬화되고 cancelled tombstone 이후 verify/apply는 거절한다. 취소된 stage 삭제 실패는 cleanupPending이며 task 예약은 해제할 수 있다. tombstone은 삭제하지 않는다.

재시도는 새 taskId로 0 byte부터 실행한다. 이전 task의 cancel/close가 commit되고 activeTask가 해제된 뒤에만 reserve한다. reconcile만으로 예약을 해제하지 않는다. 기존 변경 operation을 새 transfer retry로 이어가지 않는다. background transfer와 foreground control 오류는 각각 귀속한다.

속도는 3초 sliding window, 진행 event는 최대4회/초, 변경 표시는1초이내다. byte progress의100%는 바이트 전달이 끝났다는 뜻으로 표시하고 verifying은 별도 spinner다. hash/fsync/backup/restart에는 가짜 퍼센트를 계산하지 않는다.

## 8. helper 프로토콜·잠금·영속 기록

### 8.1 command와 시간 제한

공통 입력은 `{protocol:1, command, requestId, payload}`다. `inspect/register`는 등록 설정을 payload로 받고 아직 없는 task/slot/operation ID를 요구하지 않는다. `list/stat/hash/logs`는 slotId와 범위 내 경로/unit을 받는다. `reserve/verify-stage/cancel-task/close-task/task-status`는 slotId와 taskId를 받는다. `apply/restart/restore`만 operationId·expectedRevision·expectedLatestFileOperationId·confirmationToken을 추가로 요구한다. `preflight/reconcile/observe/cleanup`은 slotId와 대상 task/operation 또는 정리 대상 ID를 명시한다. 각 command는 별도 discriminated schema로 허용 필드를 고정하며 알 수 없는 command/필드는 거절한다.

stdout은 최대 1MiB의 JSON 한 줄인 최종 응답, stderr는 비밀 제거 후 최대 64KiB다. 명령 소스 hash와 protocol을 receipt에 기록한다. byte는 SFTP로만 전송한다. 진행 단계는 별도 `task-status`로 1초마다 읽는다. 이 읽기는 mutation flock과 unit mutex를 요구하지 않고 SQLite read-only snapshot으로 phase를 조회한다. DB busy면 `업데이트 지연`, 3초간 새 snapshot이 없으면 마지막 시각을 표시한다. task-status는 상태를 승격하거나 artifact를 검사·변경하지 않는다. hot journal로 read-only 접근이 불가하면 recoveryRequired를 반환하고 reconnect/reconcile 경로를 안내한다.

| command/phase | deadline |
| --- | --- |
| task-status | 원격 DB busy_timeout 250ms, 전체 2초 |
| inspect/list/stat/logs 및 일반 조회 | 전체 10초 |
| register/reserve/cancel-task/close-task/cleanup | 전체 30초 |
| hash/verify-stage/preflight/reconcile | 전체 300초, 진행 중 표시 |
| apply/restart/restore | 전체 300초, 각 substep도 이 deadline을 넘지 않음 |
| systemctl restart subprocess | 30초; timeout은 systemd job 취소를 뜻하지 않음 |
| observe | 전체 60초 |
| HTTP GET 1회 | 연결부터 body 종료/상한 도달까지 monotonic 2초, 단계별 socket timeout만으로 대체 금지 |

상위 deadline과 하위 deadline 중 먼저 도달하는 것을 적용한다. hashing/backup은 1MiB chunk마다 deadline을 확인한다. SIGTERM/SIGHUP는 중지 flag를 설정하며 이미 수행한 동작을 undo하지 않는다. 강제 종료는 journal 복구 대상이다.

### 8.2 잠금과 SQLite

remote layout은 다음과 같다.

```text
<slot>/.sshos/manifest.json
<slot>/.sshos/lock
<slot>/.sshos/state.sqlite3
<slot>/.sshos/tasks/<taskId>/upload.part
<slot>/.sshos/tasks/<taskId>/artifact.ready
<slot>/.sshos/operations/<operationId>/backup.bin
<slot>/.sshos/operations/<operationId>/restore.part
```

remote 상태와 journal의 단일 권위는 state.sqlite3다. 독립 state.json/journal.json의 두 파일 commit을 구현하지 않는다. Python 표준 sqlite3, journal_mode=DELETE, synchronous=EXTRA(3), foreign_keys=ON, 변경 connection busy_timeout 1000ms를 적용하고 실제 PRAGMA 값을 조회해 일치하지 않으면 차단한다. 초기 DB·디렉터리 fsync를 수행한다. DB commit 예외는 성공/실패를 추정하지 않고 연결을 닫은 뒤 재조회한다. [Python sqlite3](https://docs.python.org/3.12/library/sqlite3.html), [SQLite EXTRA](https://www.sqlite.org/pragma.html#pragma_synchronous)

mutation은 항상 고정 lock inode에 `flock(LOCK_EX|LOCK_NB)`를 얻는다. O_CLOEXEC, 자식 close_fds=True. lock을 지우거나 replace하지 않는다. 획득 실패는 BUSY이며 강제 takeover·만료 lease는 없다. long operation은 flock을 유지하지만 DB transaction은 각 단계 저장 동안만 짧게 연다. task-status 읽기만 flock 예외다. flock은 협조하는 클라이언트만 직렬화한다. [Linux flock](https://man7.org/linux/man-pages/man2/flock.2.html)

필수 tables/columns는 다음과 같다. id는 TEXT PK, timestamp/hash는 TEXT, revision/byte는 INTEGER, bool은 0/1이다. payload는 versioned JSON TEXT이며 schema 검사 후 저장한다.

| table | 필수 필드 |
| --- | --- |
| slot (한 행) | id, revision, activeTaskId nullable, activeOperationId nullable, latestFileOperationId nullable, lastTaskId nullable |
| tasks | id, state, result nullable, cancelled, createdBootId, sourceHash, sourceSize, artifactPath, originApplyOperationId nullable, lastRevision, createdAt, updatedAt |
| operations | id, requestId UNIQUE, taskId, action(apply/restart/restore), assignedRevision, createdBootId, expectedLatestFileOperationId nullable, originApplyOperationId, backupSourceOperationId nullable, fromHash, toHash, phase, terminal, result nullable, restartEvidence, supersededBy nullable, payload |
| events | seq AUTOINCREMENT, operationId/taskId, phase, timestamp, payload |

operationId/requestId의 중복 접수는 저장된 record 조회만 반환하며 다음 단계를 재실행하지 않는다. requestId→operationId 대응은 operations의 UNIQUE requestId로 보존한다. 실제 mutation operation 외 command의 중복은 해당 task/slot의 이미 저장된 결과를 반환한다. tasks와 operations의 ID tombstone은 자동 삭제하지 않는다. event 상세만 export 후 정리할 수 있으며 동작 dedup record를 없애지 않는다.

`slot` 포인터·revision·operation phase·task state·event는 같은 `BEGIN IMMEDIATE` transaction에서 갱신한다. 실제 backup/replace/systemctl은 DB transaction 밖이다. 파일과 DB가 함께 원자적이라고 주장하지 않는다. live artifact 교체 전 REPLACE_INTENT commit, 교체 후 file/dir fsync, REPLACED commit을 따른다. systemctl 호출 전에는 RESTART_INTENT를 commit한다. upload·backup 임시 파일 생성은 task/CREATED 기록에 귀속되며 live 교체 intent로 취급하지 않는다. DB commit 실패 후 같은 mutation을 반복하지 않는다. filesystem이나 DB가 fsync를 성공으로 보고하면서 실제 보존하지 않는 하드웨어 오류까지 보장하지 않는다.

manifest와 export JSON은 같은 dir의 임시 파일→fsync(file)→os.replace→fsync(parent)로 저장한다. backup/stage/restore 파일도 fsync 및 부모 dir fsync를 확인한다. `.sshos` 내 SQL journal 파일을 수동 삭제하지 않는다. SQLite의 hot journal crash recovery는 재조회 시 저장소 내부 쓰기를 할 수 있다. 이 동작만 허용하며 artifact 교체·systemctl·업무상 완료 상태의 자동 승격과 구분한다. [SQLite recovery](https://www.sqlite.org/lockingv3.html)

### 8.3 task·operation 수명

remote task state는 `reserved/uploading/staged/applying/needs_attention/completed/cancelled/closed`다. local transfer state는 §7.3대로 별도다. tasks.result는 NO_CHANGE 등 task 수준 결과를 저장한다. operations.terminal은 완료된 실행 시도를 뜻하며 성공 여부는 result와 근거로 별도 판단한다. 아직 결과가 없는 result는 NULL, restartEvidence의 초기값은 UNCONFIRMED다. tasks.originApplyOperationId는 첫 apply 접수 시 정하고 이후 바꾸지 않는다.

| 동작 | 같은 DB transaction으로 갱신할 상태 |
| --- | --- |
| reserve | activeTaskId가 null일 때 새 task=reserved, createdBootId=현재 boot, lastRevision=slot.revision, activeTaskId=task. 기존 같은 ID는 조회만 |
| verify-stage 성공 | cancelled=0 확인 후 staged. activeTask 유지 |
| cancel-task | 아직 어떤 apply operation도 시작하지 않은 task만 cancelled=1, state=cancelled, activeTask=null. 뒤늦은 verify/apply 거절 |
| NO_CHANGE | preflight에서 from=to이면 task=completed, result=NO_CHANGE, activeTask=null. operation/backup/restart 없음 |
| apply/restart/restore 접수 | revision+1, activeTask=task, activeOperation=newId, lastTaskId=task, task=applying, lastRevision=새 revision, operation.createdBootId=현재 boot. 이전 unknown을 대체할 때 아래 조건 적용 |
| 정상 최종 OBSERVED | §9.3 원격 성공 조건 충족 시 terminal=1, task=completed, task.result=OBSERVED_AVAILABLE, activeOperation=null, activeTask=null. latestFileOperation은 아래 교체 규칙대로 유지 |
| 확정된 단계 실패 또는 HTTP 관측 실패 | terminal=1, operation/result와 task.result에 해당 판정 저장, activeOperation=null, task=needs_attention, activeTask 유지. OBSERVED phase가 있어도 성공 조건 미달이면 completed가 아님 |
| ACK 유실/저장 불명/중단 | 로컬은 결과 불명. remote 행을 추정 변경하지 않고 active 참조를 유지 |
| close-task | 새 reconcile로 확정한 old/toHash·같은 boot·Job=0·저장 정상 상태와 사용자 종료 확인. task=closed, activeOperation=null, activeTask=null. 과거 phase를 성공으로 바꾸지 않음 |

최신성 판단은 activeOperation과 latestFileOperation을 구별한다. 파일 교체와 dir fsync를 확인해 REPLACED를 commit할 때만 latestFileOperationId를 해당 apply/restore ID로 바꾼다. restart는 이 포인터를 바꾸지 않는다. revision은 operation 접수 시 이미 증가하므로 REPLACED 전 단절도 새 시도로 식별된다.

결과 불명 작업에서 새 restart/restore를 시작할 때는 사용자의 새 확인이 필요하다. lock을 얻고 같은 boot/slot/task의 lastRevision=slot.revision, current hash·backup·Job=0·DB 정상을 재검증한다. activeTask는 null 또는 같은 task여야 한다. 이전 activeOperation이 남아 있으면 그 phase를 유지하고 supersededBy=newId와 관측 근거를 기록한 뒤 새 operation을 같은 transaction에 접수한다. 과거 명령을 완료로 승격하지 않는다. REPLACE_INTENT 뒤 new hash가 관측됐지만 REPLACED가 없어도 이 조건이면 해당 apply의 backup을 참조해 복원할 수 있다. 다른 task가 operation을 시작해 revision이 바뀌면 과거 task의 변경은 차단한다.

## 9. apply·restart·observe

### 9.1 적용 전 확인과 hash 의미

preflight는 remote identity·slot·revision·current hash/metadata·stage hash·unit·Job·공간·backup 개수·권한을 확인한다. confirmationToken은 30초 동안 유효하며 대상과 관측값에 결합한다. `파일 교체 후 재시작` 확인을 받고 helper가 lock 안에서 동일 조건을 다시 검사한다. 만료/불일치면 변경 없이 새 preflight를 요구한다.

operation마다 `fromHash/toHash`를 저장한다. apply는 현재 파일/new stage, restore는 현재 파일/원래 apply의 backup, restart는 현재 파일/현재 파일이다. originApplyOperationId와 backupSourceOperationId는 원래 apply ID를 유지한다. restore/restart의 검증은 각 operation의 toHash를 사용한다. stage의 new hash를 복원 성공 조건에 재사용하지 않는다.

apply는 unit active/running을 요구한다. 복구용 restart/restore는 failed/inactive여도 Job=0이고 identity·권한·지원 Type/Restart 조건을 만족하면 허용한다. BUSY/activating/deactivating이면 대기한다. 일반 서비스 시작/중지 버튼으로 확장하지 않는다.

### 9.2 durable 단계

| phase | 수행·commit 조건 |
| --- | --- |
| CREATED | operation ID·from/toHash·createdBootId·expectedLatestFileOperationId·revision·대상을 접수. §8.3 transaction. 이 commit 직후 중단도 boot 비교가 가능해야 함 |
| PREPARED | apply: current를 backup.bin 0600으로 복사/hash 확인/fsync. restore: 검증된 backup을 restore.part에 복사. 교체 파일 mode를 원래 지원 mode로 설정, UID/GID 검사/fsync. restart는 파일 작업 생략. createdBootId와 현재 boot 일치 확인, InvocationID 기록. boot 변경이면 REVIEW_REQUIRED |
| REPLACE_INTENT | apply/restore만. 이 phase commit 성공 후 os.replace 호출 |
| REPLACED | 동일 fs replace·slot dir fsync·toHash/metadata 확인 후 phase와 latestFileOperationId를 같은 transaction에 commit |
| RESTART_INTENT | 바로 직전 boot/InvocationID/Job=0 재확인·commit. restart는 PREPARED에서 이 단계로 감 |
| RESTART_RESULT | shell 없이 argv `/usr/bin/sudo -n -- /usr/bin/systemctl restart -- <unit>` 실행 결과 exit/timeout 저장 |
| OBSERVED | 아래 관측 결과와 task/active 참조를 같은 transaction에 commit. 그 후 응답 |

local main도 원격 변경 명령 전에 operation intent를 atomic 저장한다. 실패하면 원격 명령을 보내지 않는다. remote receipt 후 local 저장 실패는 `결과 기록 저장 실패 · 다시 확인 필요`이며 이후 새 변경을 막는다. 이미 성공한 원격 변경을 실패/취소됐다고 단정하지 않는다.

### 9.3 관측과 문구

최대 60초 동안 unit은 1초 간격, HTTP는 2초 간격으로 관측한다. HTTP 전체 2초 deadline, body 64KiB 상한, redirect 미추적이다. 정상 전체 완료는 다음 모두 필요하다.

1. current live hash가 이 operation의 toHash와 일치.
2. durable RESTART_RESULT exit=0, 같은 boot, 비어 있지 않은 InvocationID가 intent 전과 다름, active/running·Job=0.
3. 동일 InvocationID에서 HTTP 200을 3회 연속 관측. 각 GET 전후 identity 확인, 실패 또는 identity 변화면 count=0.
4. OBSERVED와 task 포인터 DB commit 및 local receipt 저장 성공.

apply의 완료 문구는 `파일 교체·재시작·응답 확인 완료`, restore는 `이전 파일 복원·재시작·응답 확인 완료`, restart는 `재시작·응답 확인 완료`다. 상세 화면은 각 근거를 항상 분리한다. PID는 진단값이다. HTTP 200은 새 코드의 업무 정상성 증거가 아니다. durable 명령 결과 없이 InvocationID만 바뀌면 `다른 실행 주기 관측 · 요청 결과 불명`이다.

## 10. 파일 복원과 단절 복구

복원은 원래 apply의 backup이 검증되고 현재 파일 hash가 원래 apply의 toHash이며 다른 task의 operation이 없는 경우에만 가능하다. 이미 현재 hash가 backup hash와 같으면 복원 버튼은 비활성화하고 `이전 파일과 동일`을 표시한다. 이때 서비스 확인이 끝나지 않았다면 조건을 다시 검사한 명시적 restart는 허용한다. 조건은 §8.3과 같다. backup.bin을 소비하지 않고 새 restore.part를 만들어 검증·mode·fsync·replace한다. 복원 후 관측은 restore.toHash를 사용한다. DB·외부 효과는 복원하지 않는다.

reconcile은 lock을 비차단 획득하고 DB·boot·current hash·unit Job·InvocationID를 조회한다. SQLite 자체 crash recovery 이외에 artifact·systemctl·업무상 phase·예약 해제를 자동 변경하지 않는다. 근거를 local receipt에 추가 기록한다. 다음 변경 허용을 위한 관측 token은 30초이며 사용자 확인과 helper 재검사가 필요하다.

| 증거 | 결과 / 허용 UI |
| --- | --- |
| flock 실패 또는 Job≠0/activating/deactivating | BUSY / 상태·기록 조회. lock 획득만으로 systemd job 종료 판정 금지 |
| CREATED/PREPARED/REPLACE_INTENT, fromHash·metadata 일치, 지원 전제·journal 순서 충족 | NOT_APPLIED / 조회, 명시적 close-task 후 새 파일 준비 |
| REPLACE_INTENT 이상, toHash, from≠to, 원래 backup 검증, 같은 boot/revision | APPLIED_UNVERIFIED / 관측, 새 restart, 이전 파일 복원. 불명 active 행 처리는 §8.3 |
| RESTART_INTENT 이후 명령 결과 없음 | restartEvidence=UNCONFIRMED 또는 CHANGED_UNATTRIBUTED / 조회, 조건 충족 시 새 restart·복원 |
| durable RESTART_RESULT exit=0, 같은 boot, 새 InvocationID | restartEvidence=CONFIRMED. 현재 HTTP는 별도. 누락 OBSERVED를 소급 생성하지 않음 |
| boot 변경 | REVIEW_REQUIRED+BOOT_CHANGED / 읽기·로그·내보내기. 이 작업 변경 차단 |
| current가 from/to 모두 아님·없음·symlink·metadata 불일치 | CONFLICT / 읽기·내보내기. 자동 덮어쓰기 없음 |
| DB 손상·저장 오류·identity 변경 | REVIEW_REQUIRED / 읽기 가능분·내보내기. 관리자 확인 전 변경 불가 |
| 다른 task의 새 revision | CONFLICT+superseded / 최신 기록. 과거 복원 차단 |
| apply preflight from=to | NO_CHANGE / 예약 해제·기록 종료. 변경 호출 0회 |

result enum은 `BUSY/NO_CHANGE/NOT_APPLIED/APPLIED_UNVERIFIED/OBSERVED_AVAILABLE/OBSERVED_UNAVAILABLE/REVIEW_REQUIRED/CONFLICT`, restartEvidence는 `CONFIRMED/CHANGED_UNATTRIBUTED/UNCONFIRMED/BOOT_CHANGED`다. byte 상태·task 상태·phase·result·restartEvidence는 별도 필드다. OBSERVED_AVAILABLE은 현재 응답 사실이며 과거 작업 완료의 동의어가 아니다. 현재 hash가 from이라는 사실만으로 과거에 어떠한 교체도 없었다고 주장하지 않는다.

앱/worker/기기 재실행 뒤 미완료 변경은 결과 불명이다. 사용자 재접속 후 조회만 한다. 관리자 확인 상태에 강제 완료·잠금 삭제 버튼은 없다. 지원 밖 상태의 해제는 관리자가 기록·백업을 보존하고 준비 문서 절차로 슬롯을 재구성한 뒤 새 등록한다. 앱 자동 수리는 1.0에 없다.

## 11. 저장·보안·UI 품질

로컬 app-data는 profiles.json, host-trust.json, encrypted-secrets.json, settings.json, tasks/<taskId>.json과 snapshot으로 분리한다. schemaVersion=1. atomic file 저장과 마지막 정상본 backup을 사용한다. 파손이면 정상본을 검사하고 복구 사실을 표시한다. 둘 다 파손이면 그 파일의 변경 기능을 잠그며 임의 초기화하지 않는다. 일반 완료 작업 기록 100건 또는 30일을 넘으면 오래된 것부터 local receipt만 만료한다. remote backup과 unresolved 기록은 자동 삭제하지 않는다.

remote apply backup 개수 5개에 도달하면 새로운 apply를 막는다. 설정 cleanup은 완료·비최신·비 unresolved operation을 목록에서 사용자가 고르고 백업 hash·복원 불가 경고 확인 후 helper로 삭제한다. 현재 최신 성공 작업의 backup은 다음 정상 작업이 끝나기 전 삭제하지 않는다. temp cleanup은 task 소유 manifest 기준이며 recursive 임의 경로 삭제가 아니다. local snapshot은 terminal 전송/작업 처리 후 삭제하고 삭제 실패는 다음 실행 cleanup 목록에 남긴다.

설정은 secret 저장 관리, host trust, 백업 정리, 작업 기록 JSON 내보내기, 앱 정보/라이선스/이 버전 소스 저장, UI 작업 공간 초기화만 제공한다. 작업 기록 내보내기 전 hostname/path/log 포함 여부를 표시하고 기본은 log 제외다. telemetry와 외부 분석 전송은 없다.

BrowserWindow는 nodeIntegration=false, contextIsolation=true, sandbox=true, webSecurity=true. CSP는 로컬 앱 자원만, eval/원격 HTML 금지. URL navigation·popup은 막고 문서 URL을 열 때 https allowlist와 사용자 클릭을 요구한다. preload API는 profile/connection/files/task/settings 범주의 고정 메서드만 노출하고 arbitrary IPC·shell·path를 전달하지 않는다. renderer가 서버를 바꾸어도 request의 serverId/slotId는 main·worker에서 다시 검사한다.

정확한 IPC method는 `profiles.list/save/remove`, `connection.connect/disconnect`, `trust.respond`, `slots.inspect/register`, `files.list/download`, `tasks.prepare/cancel/close/preflight/apply/restart/restore/reconcile/observe/logs/export`, `settings.get/update/cleanup`, `source.export`, `state.snapshot/subscribe`다. `settings.update`는 선언된 key만. file picker는 main에서 열고 opaque handle ID를 renderer에 전달한다. 서버·로그·파일이 제공한 문자열은 text로만 렌더링한다.

반응성 측정은 지원 target 최소 8GiB RAM/SSD에서 3서버 연결·2개 1GiB 전송·1,000행 목록·10Mbps/RTT 100ms 조건으로 수행한다. 버튼 클릭→시각 반응 p95≤100ms, 탭 전환 p95≤200ms, 100ms 이상 renderer long task는 60초 관측당 1개 이하. 스트리밍 경로는 전체 파일 크기 비례 메모리 증가를 허용하지 않고 2GiB 전송 시 앱 총 RSS≤1GiB. 기록은 tool/version/부하/샘플 수≥100을 포함한다. 이 숫자는 설계 목표이며 측정 결과가 아니다. 기준 기기는 macOS arm64 M1/8GiB, macOS x64 Intel i5-8259U/8GiB, Windows x64 Intel i5-8250U/8GiB 또는 동일 기기의 명시된 시험 장비다. 최초 30초 warm-up 후 고정 Playwright 입력 100회를 실행한다. 입력 event timestamp부터 해당 상태가 반영된 두 번째 requestAnimationFrame까지를 시각 반응으로 측정하며 원격 요청 완료 시간과 분리한다. p95는 정렬한 100개 중 95번째 값이다. PerformanceObserver의 longtask와 OS process별 RSS 합의 최대값을 동일 구간에 수집한다. 기준 장비가 없으면 대체 장비 결과를 별도 기록하고 해당 기준 검사를 untested로 둔다.

모든 버튼 keyboard/visible focus/접근성 name, 결과는 색+문자, WCAG AA 기준 일반 본문 대비 4.5:1, 200% 확대 시 주요 버튼 접근 가능. 민감 표시·disabled 이유·진행 상태는 screen reader용 문구를 제공한다. OS형 시각은 제품 계획의 영역과 수치를 따르고 임의 앱 추가는 하지 않는다.

## 12. 검증 설계와 예외 fixture

테스트는 구현을 복제하는 snapshot 나열이 아니라 데이터 손실·거짓 성공·중복 변경·오대상 위험을 확인한다. unit에서 state reducer/identity/schema/path 인용, integration에서 disposable 실제 Ubuntu 24.04/systemd/SSH/SFTP/ext4, E2E에서 패키지 UI를 사용한다. 일반 Docker의 가짜 systemd 결과만으로 target 검사를 통과시키지 않는다. 실제 client 3종×server 2종=6조합에서 연결·키/비밀번호·업다운로드·apply·restore·앱 재실행을 실행한다.

| fixture ID | 주입과 반드시 확인할 결과 |
| --- | --- |
| F01 | host key 최초/일치/변경, 전송 연결 키 불일치: 신뢰 전 인증 없음, 변경 차단 |
| F02 | SFTP 없음/Python 없음/다른 OS/root/권한 부족: 조건별 차단, 자동 설치 없음 |
| F03 | 0byte 다운로드, 1byte/2GiB 업로드, 초과 파일, 한글/quote/개행/경로 탈출: 정의된 성공 또는 입력 거절 |
| F04 | snapshot 중 원본 변경, stage hash 손상, 다운로드 중 원격 변경: 완료 금지/live 불변 |
| F05 | local/remote ENOSPC, read-only, 권한 오류, fsync 실패: 다음 변경 금지·결과 불명 분리 |
| F06 | reserve/backup/REPLACE_INTENT/rename/dir fsync/RESTART_INTENT/command exit/OBSERVED/SQLite phase/포인터 commit 전후 각각 helper 종료·SSH ACK 유실: 10절 판정, 자동 재실행 0회 |
| F07 | worker 재시작 epoch 변경, sequence gap, 오래된 session event: 새 snapshot 복구·상태 오염 없음 |
| F08 | 다른 클라이언트 동일 slot 작업, 중복 profile alias, 잠금 파일 존재하지만 unlocked: 같은 inode 직렬화·과거 복원 차단 |
| F09 | symlink/hardlink/ACL/xattr/다른 fs/경로 identity 교체: 차단, 보존 가능 속성과 불가 속성 정확 표시 |
| F10 | systemctl 30초 초과·job 진행·helper 종료 후 job 완료·PID 재사용: busy/unknown, PID로 성공 판정 금지 |
| F11 | HTTP 500/timeout/redirect/큰 body/InvocationID 변화/새 boot: 관측과 요청 결과 분리 |
| F12 | backup 손상/현재 hash 충돌/더 최신 task/복원 후 HTTP 실패: 위험한 복원 차단 또는 파일 복원만 성공 |
| F13 | local journal 파손/remote journal 파손/secret decrypt 불가: 임의 reset·plaintext fallback 금지 |
| F14 | UI 대상 전환 중 확인/탭 닫기/앱 종료/재실행: serverId 고정·하단 표시·확인 필요 복구 |
| F15 | NTFS/APFS 목적지 존재·case/Unicode 충돌·비지원 fs: 기존 local 파일 보존 |
| F16 | backup 5개·cleanup 대상 변경·취소 정리 실패: unknown 삭제 없음·한도와 잔여물 표시 |
| F17 | 악성 파일명·log HTML/ANSI·IPC 위조·shell 메타 문자: 실행되지 않음·정보 노출 없음 |
| F18 | old hash=new hash: NO_CHANGE, backup/replace/restart 호출 0회·예약 해제 후 새 task 성공 |

추가 경계 검사: F01은 host trust를 30초 늦게 확인해도 인증 전 timeout이 잘못 적용되지 않는지 확인한다. F06은 SQLite commit 전후 kill/hot journal 복구, apply→별도 restart→restore, 첫 apply의 REPLACE_INTENT 이후 응답 유실 복원을 포함한다. F12는 restore 이후 failed unit의 명시 재시작을 포함한다. F15는 hardlink 직후 crash와 temp unlink 실패를 포함한다. F16은 reserve/staged 취소, verify-stage/cancel 경쟁, 늦은 apply 거절, 취소·NO_CHANGE 후 새 예약을 포함한다.

F06은 `CREATED commit 직후 종료 → NOT_APPLIED 확인 → close-task → 새 reserve 성공`을 반드시 포함한다. PREPARED와 RESTART_INTENT는 createdBootId가 달라지면 변경을 멈춘다. F12는 복원 완료 뒤 반복 복원 차단과 실패 서비스의 명시적 restart를 확인한다.

실제 fault 주입 로그에는 client/server 버전·request/task/operation ID·단계·실행 횟수·old/new/current/backup hash·journal 증거를 남긴다. 명령 호출 횟수 관측으로 “자동 중복 없음”을 검증한다. F06의 각 경계는 독립 case로 실행한다. 원격 전원 차단 시험과 process kill 시험을 구분하고 전원 차단을 안 했으면 그 항목을 untested로 남긴다.

## 13. 개발 순서·요구 추적

시간 견적은 인터뷰·기술 PoC 전 확정하지 않는다. 완료 조건으로 단계를 나눈다. G0 미달이면 실제 제품 구현을 진행하지 않고 전략 명세를 재검토한다. G1 실패면 해당 복구 계약을 충족하기 전 pilot을 막는다.

| task | 두 단계 작업과 종료 산출물 | 선행 |
| --- | --- | --- |
| T3-01 | 인터뷰 계획/모집 → 6명 사례·적합성 기록, G0 판정 | v3 개발 착수 요청 |
| T3-02 | 로컬 Git·빌드·라이선스 기초 → lockfile/verify·추적 파일·정책 검사 | T3-01 G0 통과 |
| T3-03 | 5앱 shell·immutable target → 전송 선반/확인/오류 fixture UI 검사 | T3-02 |
| T3-04 | SSH/auth/trust/secret → 실제 두 아키텍처 연결·slot inspect/register | T3-02 |
| T3-05 | Python helper/lock/journal PoC → F05/F06/F08/F10으로 G1 판정 | T3-04 |
| T3-06 | 파일 탐색·snapshot/SFTP → hash·queue·download 배타 확정 검사 | T3-03, T3-04 |
| T3-07 | apply/restart/observe/restore → 정상/오류/동일 파일 흐름 검사 | T3-05, T3-06 |
| T3-08 | worker 복구·reconcile·정리 → 전체 F01–F18·반응성/접근성 | T3-07 |
| T3-09 | OSS 고지·소스 archive/내보내기 → 정확 commit 재빌드/라이선스 검사 | T3-08 |
| T3-10 | 3서명 패키지 → 6환경 조합·설치/업데이트 제외/소스 일치 검증 | T3-09 |
| T3-11 | 12명 비교 G2 → 4주 pilot G3와 출시 판정 | T3-10 |

정량 연구 gate의 수치·모집·판정은 제품 계획 9절이 유일한 규범이다. 연구 보고서의 제안 문구가 충돌하면 그 절을 따르고 보고서를 정정한다. T3-01의 인터뷰 통과가 G2/G3 통과를 대신하지 않는다. 미서명 alpha에서 개발 검사를 할 수 있지만 T3-11 실사용은 서명 패키지 완료 후다.

요구 ID별 수용 기준·artifact·check·task 연결은 spec-v3.json에 있다. 수용 검사 모두 현재 untested다. 이후 implementation-state에는 각 C의 하위 fixture별 pass/fail/untested, 환경, 증거 경로, commit, artifact hash를 기록한다. 최종 complete는 모든 required C 통과와 실제 승인 digest 일치가 필요하다.

### v2 → v3 변경 대응

| v2 요구 | v3 처리 |
| --- | --- |
| R01, R02, R29 | R3-02. OS형 공통 공간 유지, 12개 자유 창은 폐기하고 6개 탭으로 변경 |
| R03 | R3-03. 클라이언트/서버 축 유지, slot/runtime/fs 지원 계약 추가 |
| R04–R08 | R3-04–R3-07. profile/auth/trust/secret/접속, 동시 10대→3대 |
| R09, R11 | R3-09. 단일 탐색기 유지, slot 범위 읽기로 축소 |
| R10 | 임의 파일 생성/rename/delete 폐기. 작업 전용 변경은 R3-15/R3-17 |
| R12–R17 | R3-10–R3-13, R3-18. 단일 파일 stage/download, recursive 전송 제외 |
| R18, R20 | 일반 시스템·프로세스 앱 제외, 대체 요구 없음 |
| R19, R21, R22 | R3-16, R3-21. 등록 unit의 작업 문맥과 로그만 유지 |
| R23, R24, R25 | R3-22–R3-24. 저장/경계/접근성 계약 강화 |
| R26, R30 | R3-25, R3-29, R3-30. 핵심 작업과 signed 지원 환경 검사로 변경 |
| R27, R28 | R3-31, R3-32. 로컬 Git/SDD 추적 유지 |
| R31–R34 | R3-27–R3-29. AGPL·의존성·소스·기여 방향 유지 |
| 신규 | R3-01, R3-08, R3-14–R3-20, R3-26. 역할·slot·명시적 변경·결과 불명·복구·시장 검증 |

## 14. 라이선스·패키징·소스 제공

LICENSE 원문/SPDX/package.json/앱 정보는 AGPL-3.0-only로 일치시킨다. AGPL은 모든 서버 코드의 자동 공개 의무가 아니며 독립 업로드 파일에는 적용하지 않는다. 의존성 목록은 name/version/license/source/license-file/integration/distribution/notice/compatibility-rationale/MIT-alternative 필드를 기록한다. MIT 후보가 기능·품질 조건을 충족하면 우선 선택, 없으면 OSI 승인 라이선스 중 실제 통합 방식과 호환되는 후보를 채택한다. license 정보가 없으면 오픈소스로 추정하지 않고 채택 보류다.

runtime 직접/전이, Electron/Chromium/Node bundle, 아이콘, 빌드·시험 도구를 구별한다. LICENSE/NOTICE 원문과 copyright를 정확 버전에 매핑한다. C3-28은 자동 inventory와 사람 검토를 둘 다 기록하며 자동 스캐너만으로 법적 호환성을 확정했다고 쓰지 않는다. CONTRIBUTING은 권리·출처·라이선스 동의, upstream 기여 문서는 상류 라이선스와 최소 재현·실제 검증 명령·외부 PR 승인 범위를 명시한다.

최종 산출물은 arm64.dmg/x64.dmg/x64.exe, source.tar.gz, source-manifest.json, release-manifest.json이다. source archive는 같은 commit의 소스·lockfile·빌드/패키지 스크립트·고지·helper를 포함하고 secret/node_modules/.local/Git credential을 제외한다. manifest에 commit/파일 hash/도구 버전/재현 명령을 포함한다. binary에 같은 archive를 포함하고 설정에서 내보내기 후 hash 검증한다. 별도 깨끗한 승인 workspace 경로에서 해당 source로 빌드 가능함을 검사한다. 임의 /tmp 또는 worktree 사용은 하지 않는다.

내부 alpha 미서명은 최종 서명 완료가 아니다. macOS 서명·공증/staple 검증, Windows 서명 chain/timestamp 검증, 실제 첫 실행/secret 재실행을 각 target에서 검사한다. 인증서가 없는 환경은 패키징 C를 untested로 남긴다. 자동 업데이트는 제외하며 설치 문서에 지원 OS와 수동 업데이트·데이터 보존 범위를 명시한다.

## 15. 로컬 Git 운영과 종료 조건

향후 착수 시 sshOS 내 Git과 `.local/git-origin.git` bare 원격을 만든다. 사전 확인된 user.name/email이 없으면 실제 작성자를 질문하고 임의 신원을 설정하지 않는다. main 기본 브랜치와 `plan/v3`, 이후 `feat/<task-id>` 형식 단계 브랜치를 사용한다. 검사 통과→commit→로컬 bare push→main 병합→bare main push→정확한 병합 head 브랜치 remote/local 삭제 검증을 같은 단계에서 수행한다. 사용자 변경을 reset하거나 임의 worktree를 만들지 않는다.

지금은 Git repo가 아니며 이 문서가 commit/push/merge 실행의 증거는 아니다. GitHub origin을 후에 설정하면 로컬 절차를 그대로 원격에 적용하지 않는다. current origin App 검증과 사용자 AGENTS의 sprint-planner→human commit/push/PR→App current-head review→human merge/branch cleanup guarded 흐름 및 당시 적용 skills를 읽고 따른다. 필요한 skill/권한이 없으면 해당 write 전에 정확한 전제만 요청한다.

최종 보고는 구현된 R3/T3, 실행 C3와 F ID, 지원 환경별 결과, 미검사/실패, 제품 가설 G0–G3 결과, commit/패키지/source hash를 포함한다. 초기 v3 문서의 approval pending과 모든 product check untested를 실제 승인·시험 없이 변경하지 않는다.
