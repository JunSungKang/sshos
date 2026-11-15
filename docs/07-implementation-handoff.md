# sshOS(시오스) 구현 인계서 v6

대상: GPT-6.1-sol High 또는 같은 명세를 수행하는 개발자. 문서 개정은 승인됐고 제품 구현은 아직 지시되지 않았다. ‘계획서 작성 완료’·‘GIF 생성’·‘문서 검사 통과’를 구현 착수/제품 검증 완료로 바꾸지 않는다.

## 1. 읽기 순서와 정본

1. 최신 사용자 지시와 적용 AGENTS, [대화 결정](10-session-decisions.md), [전수 점검](11-document-audit.md).
2. [제품 범위](01-product-plan.md), [개발 계약 전체](02-development-plan.md), [데스크톱 조작 전체](09-desktop-interaction-spec.md).
3. [체크리스트](06-quality-security-checklist.md), [기계 명세](spec-v6.json), [요구 추적](08-requirement-traceability.md).
4. [의존성 기준](dependency-baseline-v6.json), [아키텍처](04-system-architecture.md), [조사](03-research-and-positioning.md), [Electron 선택](05-framework-comparison.md).
5. [시안의 상태와 한계](../design/README.md). history의 요구/검사/이미지를 현행 요구와 합치지 않는다.

사용자 지시 > 현행 제품 범위 > 현행 세부 개발/데스크톱 계약 순으로 해석한다. 세부 문서끼리 충돌하면 구현자가 임의로 골라 구현하지 않고 관련 계약을 정정한다. 각 숫자는 설계 수용 기준이며 측정값이 아니다.

## 2. 실제 구현 착수 후 순서

- 실제 착수 메시지와 v6 scope_digest를 기록한다. 이미 명확한 승인 범위는 반복 질문하지 않는다.
- 기존 변경을 보존하고 허가 workspace 안에서만 파일·캐시·패키지 저장소·시험출력을 생성한다. 외부 temp/worktree를 만들지 않는다.
- D01에서 exact dependency와 lock, Electron API·CSP·xterm·ssh2·실제 지원OS를 검증한다. baseline은 설치/조합 통과 증거가 아니다.
- D01–D13의 선행 조건과 R ID/검사 ID를 연결한다. UI만 그린 것을 원격 기능 완료로 보고하지 않는다.
- 거부된 기능은 해당 이유를 보여주고 다른 독립 기능을 유지한다. 미지원 서버권한을 helper/관리자권한/자동설치로 우회하지 않는다.
- 테스트와 패키징이 끝나도 공개·원격 push·merge는 실제 지시와 적용 Git 절차를 따른다. 현재 origin 없는 폴더에서 가짜 원격을 만들지 않는다.

## 3. 구현 불변 조건

| 항목 | 반드시 지킬 계약 |
| --- | --- |
| 제품 형태 | Electron 기본 창1 + React 내부desktop/window. X11 대체 구현 없음 |
| 사용자 기능 | 파일 탐색/보기/비동기 전송/명시적 GUI exec/PTY. 터미널을 v5처럼 제외하지 않음 |
| 실행 제한 | probe만 /bin/true 고정. 사용자 원격 실행을 이 한 명령으로 제한하지 않음 |
| 서버/저장 | client-only, 기존 SSH/SFTP, 기능 JSON+OS 암호화. 서버helper·DB·관리웹서버 없음 |
| 로컬 권한 | sandbox renderer, 제한 IPC, 사용자 원격 명령으로 로컬 OS shell 열지 않음 |
| 창/작업 | 최소화는 유지, 파일창 닫아도 전송유지, 실행창/PTY닫기/중지는 서로다름 |
| 결과 | exit/close 관측 구분, 단절 후 자동재실행없음, 미확인 결과를 완료로 바꾸지 않음 |
| 보기 | UTF8 plain text 및 정적 PNG/JPEG/WebP만. HTML/SVG/원격스크립트 실행없음 |
| 터미널 | xterm+ssh2 PTY, bounded I/O, paste대상고정, OSC clipboard/link/title작용차단 |
| 전송 | read-back+배타hardlink, 기존파일 덮어쓰기없음. 한계를 숨기지 않음 |
| 비기능 | AI/온라인오류검색/자동동기화/자동업데이트/telemetry 추가없음 |

첫 버전 GUI 내용 편집·권한변경·폴더재귀작업이 제외되어 있어도 터미널의 vi/chmod 등 사용자 명령을 금지한다는 뜻은 아니다. 모든 Linux 명령을 개별 GUI로 매핑하지 않는다. 명령 이름을 알아내려 터미널 출력을 shell로 다시 실행하지 않는다.

## 4. 단계 기록과 검사

각 단계는 `D ID, v6 scope_digest, R IDs, 변경파일, 검사ID, 실제명령/수동절차, OS/CPU/서버/fixture, build hash, pass/fail/untested, 증거경로, 결함ID, 다음단계`를 남긴다. 미실행을 skip/pass로 대체하지 않는다. 환경 부재는 정확히 표시하고 독립적인 작업은 계속한다.

필수 기술 기능·보안·플랫폼 검사가 실패하면 해당 빌드를 완료/공개용으로 표시하지 않는다. 사용자 연구 G0/G2/G3는 수요 검증이며 참여자 미확보를 기술구현 불가로 오인하지 않는다. 결과가 없으면 미실시라고 기록한다. ‘완벽’, ‘보안 결함 없음’, ‘모든 OS 지원’ 같은 표현은 사용하지 않는다.

## 5. 시작용 프롬프트

다음 문구는 사용자가 제품 구현을 지시할 때만 실행할 지침이다.

> sshOS(시오스) v6를 구현한다. AGENTS와 README에서 현행 문서 목록을 확인하고 docs/01-product-plan.md, 02-development-plan.md, 09-desktop-interaction-spec.md, 06-quality-security-checklist.md, spec-v6.json, dependency-baseline-v6.json, 07-implementation-handoff.md를 전부 읽어라. Electron으로 클라이언트 데스크톱·파일 뷰어·비동기 전송·원격 exec/PTY를 구현한다. probe전용 /bin/true를 전역 명령 제한으로 해석하지 마라. 서버 전용 설치·DB·X11·AI·검색·외부 변경 자동동기화는 제외다. D01부터 계약과 검사에 따라 수행하고 현재 파일/사용자 변경을 보존하라. 시안은 실제 구현증거가 아니다. 실제 실행한 검사만 통과로 기록하고 미해결 조건은 구체적으로 남겨라.

## 6. 외부 자원과 Git

실제 target 시험에는 Windows11x64/macOS14arm64/x64와 Ubuntu24.04amd64/arm64의 허가된 격리환경이 필요하다. 공개패키지에는 코드서명·macOS공증 권한이 필요하다. 원격 push에는 실제 remote가 필요하다. 이들은 지금 문서 작성의 선행 승인이 아니다.

후속 Git작업은 사용자 지시 범위에서 로컬commit/branch/merge를 진행하고 push 대상이 없으면 그 사실만 보고한다. GitHub origin을 사용할 때는 AGENTS의 human write/App current-head review/guard/merge후 local·remote head삭제 절차와 해당 스킬을 따른다. 이번 문서개정은 Git초기화나 제품설치를 수행하지 않는다.
