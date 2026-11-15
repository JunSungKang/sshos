# sshOS(시오스) 문서 전수 점검과 개정 기록 v6

2026-11-15. 사용자의 “문서 전수 점검하고 지금까지 대화한 세션을 토대로 계획서 및 개발 계획서등 모든 문서를 전면 수정해” 지시에 따른 문서 작업이다. 제품 코드 구현·서버 접속·패키지 설치·Git write는 수행하지 않았다.

## 1. 범위와 보존

작업 시작 당시 현행 README·docs·design의 파일48개를 전수 목록화하고 hash와 원본 byte를 [v5 보존본](history/v5-before-desktop-20261115/archive-manifest.json)에 저장했다. 이전 history는 수정하지 않았다. 과거 design29개는 같은 보존본으로 옮겨 현행 시안으로 오인되지 않게 했으며 4초 GIF와 그 source/검사/PNG는 개념자료로 유지했다. v5 JSON 정본/의존성은 보존본으로 이동하고 v6로 대체한다. 현재 문서별 hash·판정은 [상태](planning-status.json)와 [검사](planning-validation.json)가 관리한다.

| 문서군 | 개정 내용 |
| --- | --- |
| README | v6 진입점, 제품 역할, 신규 상세 명세, 제품 미구현 표시 |
| 01 제품 계획 | 데스크톱·보기·실행·PTY 포함, 지원/제외/설계상 축소 구분, 실용 목적과 tradeoff |
| 02 개발 계획 | 기존 연결/전송 보존, 내부 창·뷰어·exec/PTY의 API·상태·수치·보안·단계 추가 및 충돌 정정 |
| 03 자료조사 | 공식 프로젝트·논문 재확인, Termix/Cockpit 등 배포구조 정정, 차별성 가설·라이선스 한계 |
| 04 아키텍처 | DOM 내부창·뷰어·실행/PTY 연결·저장·stream 경계의 현행 구조도 |
| 05 프레임워크 | Electron 유지, Chromium GUI 역할, 측정되지 않은 오류율 우열 배제 |
| 06 체크리스트 | 기존112개 전수 재검토, 데스크톱·뷰어·exec/PTY·장애 검사 추가, 제품 검사는 전부 untested |
| 07 구현 인계 | v6/D01–D13 읽기·구현·검수·승인 경계, 과거 시안 오해 방지 |
| 08 추적표 | 기존R01–R32 의미 개정+R33–R38 추가, 새 단계/검사 양방향 연결 |
| 09 데스크톱 상세 | 좌표/포커스/창복원/서버귀속/키보드/닫기/수명 규범 |
| 10 대화 결정 | 사용자 발언과 새 설계 선택 분리, 이전 잘못된 해석 폐기 |
| JSON·검사기 | v6 정본·의존성·상태·추적·보존 hash·현행 링크 검증 |
| design 안내/장면/입력 | 구판 시안과 현행 규범 분리, GIF의 개념자료 지위, 다음 시안 범위 |

## 2. 발견한 충돌과 해결

| 발견 | 정정 |
| --- | --- |
| v5가 바탕화면·겹친창을 금지 | React WindowManager·taskbar·창상태 명세와 검수 추가 |
| 터미널/파일미리보기 제외와 GIF의 기능이 불일치 | UTF8/raster viewer, GUI exec, SSH PTY를 제품·개발·IPC·검사에 모두 반영 |
| exec 전역 /bin/true 제한 | probe 전용 제한으로 축소, 사용자 실행 별도 경로 |
| control SFTP+probe만 있는 채널 설계 | viewer 채널과 execution socket, 슬롯/세대/늦은채널 정리 추가 |
| 일반IPC 요청 한도가 터미널/이미지 stream과 충돌 | 제어 요청과 byte stream 분리, bounded buffer/backpressure/입력 순서 고정 |
| 파일 무진행 기한을 조용한 프로그램에도 적용할 위험 | 실행/PTY 전체·무출력 timeout 없음, 요청 시작 기한만 적용 |
| 창 닫기·중지 요청·채널 종료를 혼동 | 각각의 행위와 관측 결과/불명 결과 구분 |
| 고정 xterm6 DOM style과 엄격 style CSP 충돌 | CSS만 inline 허용, script/eval/외부자원 금지 유지 |
| ssh2 stdin EOF 이후 signal 미전송 | GUI stdin을 열어두고 입력UI는 미제공, TERM 공개 API 유지 |
| PTY replay가 과거 자동응답을 stdin에 전송할 위험 | snapshot sequence barrier 동안 onData/onBinary/사용자 입력 차단 |
| ImageBitmap+blob img의 중복decode와 EXIF치수 | Worker→transferable ImageBitmap→canvas 단일경로, 회전적용치수 비교 |
| 출력/결합문자/REP 메모리 과다 | 전역 ring 생략규칙·REP제한·renderer 표시중단·재생루프 차단 |
| window 복원에 이전 mode 정보 없음 | restoreMode/restoreBounds 정의 |
| 기존 자료조사의 중앙서버/독창성 단정 | 공식 배포옵션 재확인, 기능중복 인정, 사용성 가설로 정정 |
| 사용자 연구를 기술 출시와 혼합 | 연구 비차단/미실시 공개와 필수 기술 검사 분리 |

## 3. 검증의 의미와 남은 실행 단계

문서 검사는 파일 존재·로컬 링크·version·hash·R/D/검사 양방향 연결·기본 불변 계약·dependency exact 형식·보존본 무변경을 검사한다. 별도 검토자는 라이브러리 고정 버전 원문과 상태/자원 계약을 대조했다. 최종 문서 검사 결과는 planning-validation.json에 남긴다.

이는 제품 기능·성능·보안 검사 통과를 의미하지 않는다. 실제 설치 조합, CSP/xterm 렌더링, 이미지 decode, 실제 Ubuntu 계정 실행, 플랫폼 서명, 메모리·속도, 장애시험은 D01 이후 수행하며 현재 모두 untested다. 모든 경우의 오류 확률0·원격 프로세스 완전 제어·악성서버 완전 방어는 보장하지 않는다.

사용자 질문을 기다리는 미정 제품 선택은 없도록 이번 판본의 동작을 구체화했다. 제품 구현 착수, 실제 target/fixture, 배포서명, 원격 push 대상 등은 해당 작업 단계의 외부 자원이며 문서 작성의 완료와 구분한다. 구현 중 실제 API 조합이 명세를 만족하지 못하면 실패 근거와 영향 범위를 기록하고 새 판본에서 수정한다.
