# sshOS(시오스) 개발 계획서 v4

2026-11-14. 상태: 공통 계약 작성, 프레임워크 사용자 선택 대기, 구현 착수 불가. 이 문서는 [제품 계획 v4](01-product-plan.md), [기술 비교](05-framework-comparison.md), [공통 아키텍처](04-system-architecture.md)와 함께 읽는다. v3의 원격 Python·SQLite·전용 슬롯·배포 복구 코드는 구현 대상에서 철회한다. [이전 개발 명세](history/v3/02-development-plan.md)는 이력이다.

## 1. 작업 방법과 경계

SDD를 유지한다. 공통 제품 요구와 프레임워크별 구현 계약을 구분하며, 사용자 선택 전 어느 backend도 구현하지 않는다. 프레임워크 선택은 제품 개발 착수 승인을 자동으로 뜻하지 않는다. 최종 명세 판본·실제 승인 메시지·scope digest를 연결한 뒤 구현한다. 구조 검사 통과를 승인이나 제품 시험으로 표시하지 않는다.

허용 작업 루트는 `/Users/kkkk/Desktop/jskang/03.workspace/01.project/sshOS`다. 쓰기 전에 resolve하여 내부임을 확인한다. 캐시·임시파일·빌드 출력·앱 테스트 데이터는 `.local/` 내부, 영구 문서는 docs/, 그림은 design/에 둔다. HOME·CODEX_HOME은 바꾸지 않는다. 지금은 제품 코드·의존성 설치·Git 초기화를 수행하지 않는다.

## 2. 확정된 공통 구조

| 계층 | 책임 |
| --- | --- |
| GUI | 홈·연결·파일·작업·설정, 서버 귀속 탭, 우측 상단 연결·SSH 응답, 상시 전송 선반 |
| 제한된 IPC | 허용된 명령·schema·sender 검사. 임의 shell/SQL/파일 경로 전달 API 금지 |
| 로컬 core | 프로필·호스트 신뢰·OS 암호화·JSON 저장·앱 수명 |
| 비동기 I/O 엔진 | SSH/SFTP·stream·queue·기능 탐지·응답시간 probe·작업 결과 |
| 기존 서버 | OpenSSH/SFTP 및 계정에 허용된 기존 명령. 시오스 agent·DB·Python 준비 없음 |

계층은 논리 책임이다. Tauri 선택 시 반드시 Node utilityProcess가 있다고 해석하지 않는다. 원격에서 실행하는 probe는 `/bin/true`라는 고정 명령 요청이며 배포하는 Python/Node helper는 없다.

| 선택 | GUI↔core 경계 | backend 후보 | 필수 선행 검증 |
| --- | --- | --- | --- |
| Electron | isolated renderer + preload/IPC + main | TypeScript ssh2, utilityProcess | 3target portable 실행·safeStorage·stream 취소·host trust |
| Tauri 2 | WebView + invoke/capabilities + Rust core | russh+russh-sftp 우선 PoC, ssh2-rs 대안 | WebView2 정책·두 엔진 UI·native crypto bundle·async 취소 |

이 표는 두 대안을 동시에 구현하라는 지시가 아니다. 사용자 선택 후 한 경로만 고정한다. Node sidecar를 Tauri의 기본 우회로 채택하지 않는다. [비교 근거](05-framework-comparison.md)

## 3. DB 없는 로컬 저장

앱 기능 데이터는 versioned JSON 파일로 저장한다: profiles, host-trust, settings, 작업별 receipt. 비밀번호/passphrase는 OS 보호 기능으로 암호화하고 JSON에는 암호문만 둔다. private key는 원본 파일에서 읽고 서버에 전송하지 않는다. 로그에 비밀을 남기지 않는다.

저장은 단일 writer queue를 사용하고 같은 디렉터리의 임시 파일 작성→파일 flush/fsync→원자 교체→가능한 부모 디렉터리 flush로 처리한다. 정상본 backup과 schema 검증을 사용한다. 플랫폼별 atomic/flush 동작은 선택한 backend의 target 시험에서 검증한다. 저장 실패·두 사본 파손 시 기능을 잠그고 임의 reset하지 않는다. 원격 변경 뒤 기록 실패를 원격 실패/취소로 단정하지 않는다.

SQLite·DB 서버·ORM·IndexedDB·LevelDB를 기능 저장소로 사용하지 않는다. Chromium/WebView의 내부 cache 구현은 앱 데이터 저장 계약과 별개이며 전체 runtime의 파일 형식을 통제한다고 주장하지 않는다. 서버에는 시오스 state DB나 영구 manager journal을 두지 않는다.

## 4. 연결·기능 탐지·정체성

프로필 최대10개, 동시3서버. serverId는 프로필 UUID이며 host/port/user 변경은 새 정체성으로 처리한다. reconnect마다 sessionGeneration을 바꾼다. backend 재생성 시 backendEpoch도 바꾸고 snapshot+sequence로 UI 상태를 교체한다. 이전 epoch·session의 늦은 결과를 폐기한다. 작업의 serverId·경로는 시작 뒤 불변이다.

인증·호스트 신뢰 확인·SFTP 지원·exec 지원·OS 탐지 결과를 서로 다른 필드로 보관한다. host key 최초 확인 전 인증 보류, 변경 차단, control과 transfer 두 연결의 신뢰 검증은 필수다. 측정 기능의 실패가 인증 성공이나 SFTP 사용 가능 상태를 무효화하지 않는다. 탐지 결과가 없으면 unknown으로 표시한다.

서버별 control SSH 1개와 실제 전송용 SSH 최대1개를 사용한다. byte 전송은 전역2개·서버별1개 FIFO다. SFTP-only 계정은 파일 작업을 지원하며 exec probe는 unavailable이다. 로그인 성공 자체가 모든 파일 경로의 읽기/쓰기 권한을 보장하지 않는다.

## 5. SSH 응답시간 계약

측정값은 제품 계획 §7을 따른다. 기존 인증된 control 연결에서 고정 `/bin/true`를 PTY/X11/agent forwarding 없이 요청한다. 실제 exec 호출 직전에 monotonic clock을 시작하고 종료 코드0·signal 없음·error 없음·deadline 이내인 channel close에서 sample을 만든다. exit status가 없으면 성공으로 추정하지 않는다.

주기는 측정 종료 후5초, deadline5초, pending은서버별1개. stdout/stderr는 합계4KiB까지 소비하고 내용은 보관하지 않는다. 상한초과는 측정 실패다. timeout은 probe채널만닫고 control/transfer를끊지않는다. 채널생성callback이늦으면그pending이정리되기전새probe를만들지않고,늦게받은채널은닫아sample을폐기한다.

sample은 serverId/sessionGeneration/probeEpoch/probeId/elapsedMs/measuredAt/transferActive를 포함하며 메모리에만 둔다. foreground서버만 측정하고 background/minimize/suspend에서는새요청을멈춘다. resume은epoch와sample을무효화한다. 실제경과시간을callback에서도재확인해늦은timer때문에timeoutsample이성공이되지않게한다.

keepalive는연결생존확인용이며RTT수치의근거로쓰지않는다. private library API나debug문자열파싱으로ms를만들지않는다. 서버ForceCommand가요청을바꿀수있으므로원격부수효과의절대적부재까지보장하지않는다. 관련근거: [SSH exec](https://datatracker.ietf.org/doc/html/rfc4254#section-6.5), [ssh2 API](https://github.com/mscdex/ssh2), [true](https://manpages.ubuntu.com/manpages/noble/man1/true.1.html).

## 6. 파일과 전송의 공통 상태

파일 작업은 GUI에서 서버·절대경로·대상유형을 확인하고 SFTP를 통해 실행한다. 임의 shell 명령 입력창을 만들지 않는다. 같은 explorer의 tree/list가 경로를 공유한다. 파일 생성/rename/delete/충돌의 세부 계약은 원본 보존 원칙을 기준으로 최종 구현 명세에 고정한다. 재귀 삭제·폴더 배포·chmod/chown은 초기 제외다.

byte transfer 상태는 queued/running/verifying/completed/cancel_requested/cancelled/interrupted/failed/result_unknown을 구분한다. 완료 byte가 전체와 같아도 protocol close·결과 확인 전 완료로 표시하지 않는다. 상태 event는최대4Hz,변경은1초안에반영한다. 파일전체를메모리에올리지않고stream backpressure를사용한다.

전송취소는해당stream/channel에만영향을준다. remote변경ACK유실이나최종rename결과불명은result_unknown이다. 앱재실행이자동재전송/재삭제/재rename권한이아니다. 로컬receipt와재접속조회로확인하고확정할수없는결과는그대로남긴다. 서버DB를없앤상태에서v3배포복구의보장까지계승한다고주장하지않는다.

## 7. 최소 검증 목록

| ID | 검증 |
| --- | --- |
| V4-01 | 개발 도구·DB가 없는3client target에서 실행; 대상 서버 추가 설치0 |
| V4-02 | password, encrypted/unencrypted key, 잘못된 passphrase, hostkey 변경차단 |
| V4-03 | SFTP-only/exec거절/OS미확인에서기능별상태와접속보존 |
| V4-04 | 2전송+탐색+probe,취소·대기·완료확인과UI반응 |
| V4-05 | probe timeout·채널부족·exit없음·늦은callback·절전·재접속·타서버event |
| V4-06 | 전송중단·ACK유실·저장실패·프로세스종료에서원본보존·거짓완료0 |
| V4-07 | 한글/긴이름/특수파일/경로충돌·빈폴더와비재귀삭제 |
| V4-08 | JSON파손·secret복호화실패·기록export·DB미사용 |
| V4-09 | Windowsportable실행·macOS서명공증·처음실행·키파일접근 |
| V4-10 | 전체프로세스메모리·초기실행·압축/해제크기·유휴CPU·접근성 |

모든제품검사는현재untested다. 사용자조사G0–G3수치는제품9절만따른다. Tauri에는WebView2지원조건·두WebView UI검사를추가하고Electron에는runtime업데이트·portable해제검사를추가한다. 실제측정전상대오류율·메모리배수를기록하지않는다.

## 8. 후속 마감 순서

1. 사용자가Tauri/Electron을선택한다.
2. 선택한runtime·SSHlibrary·암호저장·IPC·배포·검사도구를고정한다.
3. 파일충돌·최종확정·기록복구계약과자원예산을닫고R–T–A–C기계명세를마감한다.
4. 제품/개발/조사/그림의동일조건과hash를검증하고최종계획을제시한다.
5. 후속개발착수지시가있을때만코드·Git작업을시작한다.

AGPL-3.0-only·MIT우선호환OSS·동일commit대응소스·기여정책은유지한다. GitHub origin이설정되면사용자AGENTS의guardedflow를따르며현재로컬문서작업을원격쓰기권한으로확대하지않는다. 이전v3의제품검사결과는없으며이번문서수정도제품검사통과가아니다.
