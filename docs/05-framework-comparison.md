# sshOS(시오스) Electron 선택 결정 기록 v6

조사 기준일: 2026-11-15. **사용자는 Tauri와 Electron 비교 후 Electron을 선택했다.** v6의 내부 데스크톱 창·파일 뷰어·원격 exec·PTY 요구에도 이 선택을 유지한다. Tauri 병행 구현이나 자동 전환 계획은 없다. 제품 구현과 동일 기능·동일 조건의 프레임워크 비교 실험은 아직 수행하지 않았다.

기능 범위는 [제품 계획서](01-product-plan.md), 실행 계약은 [개발 계획서](02-development-plan.md), 검사는 [품질·보안 체크리스트](06-quality-security-checklist.md)를 따른다. 이 기록은 선택 이유·비용·확인할 위험을 설명하며 별도 허용 기능·수치·release gate를 만들지 않는다.

## 1. 선택 이유와 새 요구의 의미

Electron을 선택한 이유는 Chromium을 함께 배포하여 UI 엔진 버전을 통제하고, React/TypeScript GUI와 Node의 ssh2를 직접 연결하기 위해서다. 서버에 별도 앱·관리 daemon·Python helper·DB를 설치하지 않는 구조는 클라이언트 설계의 결과이며 Electron만 가능한 특성은 아니다. [Electron 프로세스 모델](https://www.electronjs.org/docs/latest/tutorial/process-model)

내부 창·뷰어·원격 프로그램 실행은 기존 파일 전용 계획보다 많은 상태와 입력 경계를 요구한다. 이 변경은 Electron 선택을 무효화하지 않지만, 이전 파일 전용 테스트만 통과한 것으로 확대된 제품을 검증할 수는 없다. 창 focus·입력 대상·출력 처리·파일 열기·PTY 크기 변경을 포함하여 실제 패키지에서 검사해야 한다.

| 요구 | Electron에서의 구현 방향 | 구별할 사항 |
| --- | --- | --- |
| 도구 자체가 OS 같은 공간 | 하나의 로컬 앱에서 React로 내부 창·작업 공간을 렌더링 | 내부 창은 서버의 GUI 창이나 X11 화면이 아님 |
| 파일 탐색·비동기 전송 | ssh2 SFTP를 비동기 원격 엔진에서 처리하고 IPC로 상태 전달 | GUI가 원격 권한을 확대하지 않음 |
| 파일 보기 | 02의 지원 형식을 로컬 viewer로 표현 | 원격 파일의 HTML/스크립트를 앱 권한으로 실행하지 않음 |
| 원격 프로그램 실행 | SSH exec 또는 원격 PTY와 출력 스트림을 사용 | 프로그램이 서버에 이미 존재하고 계정에 실행 권한이 있어야 함 |
| 터미널 | @xterm/xterm이 화면을 렌더링하고 ssh2가 원격 shell/PTY 제공 | xterm은 셸·SSH 구현이 아니며 로컬 node-pty를 요구하지 않음 |
| 기능 데이터 DB 없음 | main의 JSON 저장과 OS 암호화 사용 | Chromium 내부 캐시까지 DB 파일 형식이 전혀 없다는 주장이 아님 |

## 2. Tauri와 비교한 실제 트레이드오프

| 기준 | Electron | Tauri 2 | 판단의 범위 |
| --- | --- | --- | --- |
| UI 엔진 | 앱에 Chromium 포함 | Windows WebView2·macOS WKWebView 사용 | Electron은 엔진 차이를 줄이나 글꼴·DPI·IME·OS 파일 대화상자 차이는 남음 |
| 배포 기본 크기 | Chromium·Node 번들 비용 | OS WebView 활용 시 작은 배포물에 유리 | DB를 제거해도 Electron 기본 크기가 사라지지 않음 |
| 사용자 런타임 준비 | Node·Chromium을 함께 배포 | Rust 설치 불필요; Windows는 WebView2 조건 충족 필요 | 설치 없는 실행은 선택한 패키지로 검증해야 함 |
| 로컬 backend | Node·TypeScript와 ssh2 | Rust core와 별도 SSH/SFTP 후보 | 현재 TypeScript 설계를 직접 연결하는 비용은 Electron이 적다는 설계 판단 |
| 내부 데스크톱 GUI | DOM·CSS·Pointer Events 등 사용 가능 | 같은 웹 UI 접근 사용 가능 | 내부 창 UI 자체로 Electron이 필수라는 결론은 아님 |
| 원격 exec/PTY | ssh2 채널과 xterm renderer 연계 | Rust SSH 채널과 xterm renderer 연계 가능 | 입력·출력·취소·원격 상태 의미는 어느 쪽에서도 구현해야 함 |
| 보안 업데이트 | 앱 배포자가 Electron·Chromium·Node 갱신을 책임짐 | OS WebView 영향; Fixed Version 동봉 시 직접 갱신 책임 증가 | 엔진 통제와 배포·갱신 비용의 교환 |
| 메모리·시작 시간 | bundled runtime과 여러 프로세스 비용 | 절감 가능성이 있으나 WebView와 구현에 좌우됨 | 동일 앱을 측정하지 않았으므로 배수·오류율·수치 우열을 선언하지 않음 |

Electron은 Chromium 다중 프로세스 모델을 사용한다. Tauri도 core와 WebView 프로세스를 사용하므로 Tauri를 무조건 단일 프로세스라고 설명하지 않는다. [Electron 구조](https://www.electronjs.org/docs/latest/tutorial/process-model), [Tauri 구조](https://v2.tauri.app/concept/process-model/)

Tauri는 Windows의 WebView2와 macOS의 OS WebKit을 사용한다. Windows 11에 WebView2가 기본 제공되지만 배포자는 런타임 존재·버전·실행 가능 조건을 확인해야 한다. Fixed Version을 동봉하는 경로는 크기·리소스·갱신 책임을 늘린다. 이 비교는 Tauri가 부적합하거나 실패 확률이 더 높다는 측정 결과가 아니다. [Tauri WebView](https://v2.tauri.app/reference/webview-versions/), [Microsoft 배포 지침](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution), [Tauri runtime 옵션](https://v2.tauri.app/distribute/windows-installer/#fixed-version)

## 3. 다운로드와 실행 계약

배포 목표는 Windows portable `.exe`와 macOS `.app`이다. macOS 전달용 ZIP, OS·CPU별 산출물, 실제 서명·공증·실행 절차는 01·02가 규정한다. 개발용 Node·Python·Rust·DB를 사용자에게 설치하게 하지 않는다.

| 표현 | 계획에서의 의미 | 동일하게 약속하지 않는 것 |
| --- | --- | --- |
| 다운로드 후 실행 | 사용자에게 개발 환경·중앙 관리 서버 준비를 요구하지 않음 | OS의 서명·권한·격리 정책을 우회함 |
| Windows portable.exe | 사용자가 실행하는 진입점 한 개 | 실행 중 리소스 해제·임시 파일·설정 파일이 전혀 없음 |
| macOS .app | Finder에서 하나의 앱으로 보이는 실행 bundle | 디스크 안의 물리 파일이 단 한 개임 |
| 사용자 추가 런타임 설치 없음 | 필요한 Electron runtime이 앱에 포함됨 | 포함된 runtime의 크기·보안 유지 비용이 없음 |

electron-builder의 portable 옵션은 임시 디렉터리 해제 동작을 설명한다. macOS bundle은 구조적으로 여러 파일과 리소스를 담는다. 실제 앱이 가볍다는 표현은 압축·해제 크기, 최초 실행, 전체 앱 프로세스의 메모리를 측정한 뒤 사용한다. [electron-builder portable](https://www.electron.build/v26/docs/api/app-builder-lib.interface.portableoptions/), [Apple bundle](https://developer.apple.com/library/archive/documentation/CoreFoundation/Conceptual/CFBundles/BundleTypes/BundleTypes.html)

## 4. 선택한 구현 경계

선택한 기반은 **Electron + React/TypeScript + 제한된 preload IPC + main 로컬 코어 + utilityProcess의 ssh2 엔진**이다. utilityProcess는 Node와 MessagePort를 사용할 수 있는 별도 프로세스다. 연결 수·채널 배치·입력·출력·취소·저장 상태의 정확한 계약은 02를 따른다. [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)

앱 내부 창은 React와 브라우저 Pointer Events로 직접 관리한다. react-rnd는 drag/resize 구성요소라는 대안을 조사했지만 v6 의존성에는 넣지 않는다. 직접 관리가 자동으로 더 안전하거나 더 작다는 측정은 없다. focus·z-order·최대화·복원·크기 제한·키보드 접근·화면 밖 복구는 별도 앱 책임이다. [react-rnd 공식 API](https://github.com/bokuweb/react-rnd)

원격 PTY는 ssh2의 shell·setWindow와 xterm 화면으로 연결할 수 있다. 이 경로에 로컬 shell용 node-pty나 HTTP/WebSocket 서버는 필수가 아니다. xterm의 fit addon은 화면에 맞는 terminal geometry를 돕는 구성요소이며 SSH로 크기 변경을 전달하거나 작업 수명을 관리하는 것은 시오스 책임이다. [ssh2 1.17.0 API](https://github.com/mscdex/ssh2/tree/v1.17.0), [xterm.js](https://github.com/xtermjs/xterm.js)

원격 프로그램은 이미 있는 계정 권한으로 실행한다. 창 닫기·신호 전송·SSH 연결 종료가 이미 발생한 원격 변경을 rollback하거나 모든 자식 프로세스를 종료했다는 뜻은 아니다. ssh2의 exit 이벤트는 프로토콜상 선택적이며 signal 요청을 무시하는 서버도 있을 수 있다. 결과를 확인할 수 없는 상황의 표시는 02가 규정한다.

## 5. 확대된 기능에서의 검증 위험

| 조건 | 확인해야 할 위험 | 프레임워크 선택만으로 해결되지 않는 이유 |
| --- | --- | --- |
| 여러 내부 창과 서버 | focus·단축키·입력·늦은 응답이 다른 창/서버에 적용됨 | 서버·창·세션 ID와 수명 관리는 앱의 상태 계약 |
| 파일 viewer와 터미널 병존 | 원격 내용·title·링크를 통해 스크립트 또는 특권 API에 접근 | renderer sandbox와 데이터 렌더링·IPC 검증이 함께 필요 |
| 빠른 PTY 출력 | UI·IPC가 소비하지 못한 출력의 무한 누적 | xterm write 흐름 제어와 채널 backpressure를 연결해야 함 |
| 창 크기·DPI·한글 입력 | PTY 행/열 오류, IME 조합 손실, 화면 밖 창 | 실제 두 OS와 한글 입력 시험 필요 |
| 서버 권한·정책 차이 | SFTP 가능/exec 거부, PTY 거부, 명령·파일 권한 부족 | SSH 연결 성공은 모든 기능 허가를 뜻하지 않음 |
| 전송·exec 중 단절 | 완료되지 않은 작업의 성공 오표시, 중복 실행 | 취소·재시도·결과 불명은 원격 작업 의미의 문제 |
| 배포 조합 | native optional 모듈·타입·fuses·패키지 서명 충돌 | exact 버전 메타데이터 확인은 실제 빌드 검사가 아님 |

xterm 공식 보안 문서는 터미널 출력과 title·링크 등의 데이터를 신뢰하지 말고, DOM·스크립팅 문맥을 보호하도록 안내한다. 외부 CDN·광고·동적 원격 코드 없이 앱 자산을 묶는 방향은 노출면을 줄이지만 안전성을 보증하지 않는다. 앱의 CSP 아래에서 xterm과 내부 창 동작을 실제 검사해야 한다. [xterm 보안](https://xtermjs.org/docs/guides/security/), [flow control](https://xtermjs.org/docs/guides/flowcontrol/), [Electron 보안](https://www.electronjs.org/docs/latest/tutorial/security)

온라인 오류 검색·AI 요약·모델 호출은 제외한다. 프레임워크 비교 또는 터미널 도입을 이유로 중앙 서버·원격 daemon·X11·RDP·VNC·앱 기능 DB를 재도입하지 않는다.

## 6. 의존성 확인과 아직 수행하지 않은 검증

[dependency-baseline-v6.json](dependency-baseline-v6.json)은 공식 npm registry의 exact 버전 URL과 integrity를 2026-11-15 재확인한 결과다. 기존 15개 버전은 모두 조회 가능하고 해시가 일치했다. 추가 runtime 의존성은 MIT의 @xterm/xterm 6.0.0과 @xterm/addon-fit 0.11.0이다. 개발 Node 24.22.3은 공식 배포 인덱스에서 확인했으며 Electron에 포함된 Node 버전과 같은 것으로 간주하지 않는다.

- ssh2 1.17.0은 optional nan·cpu-features를 선언한다. Node/SSH 경로를 사용한다고 모든 전이 의존성이 순수 JS라는 뜻은 아니다.
- @types/ssh2 1.15.6은 @types/node ^18.11.18을 의존한다. 최상위 Node 24 타입과 실제 해결 결과를 lockfile·strict typecheck에서 확인한다. 아직 조합 오류를 관찰한 것은 아니다.
- 레지스트리 license 필드는 배포물 전체의 라이선스·NOTICE·소스 제공·codec·자산 검토를 대신하지 않는다. 프로젝트 AGPL-3.0-only와 의존성의 원래 고지를 구분한다.
- 소스의 정확한 버전, 엔진 호환, 실행 시 SSH·SFTP·PTY·IME, 배포 크기·메모리·시작 시간은 설치와 패키징 후 검사한다. 현재 모두 미검증이다.

## 7. 검증 도구와 결정의 한계

Playwright의 Electron 자동화는 공식상 experimental이다. 검사 도구가 있다는 사실만으로 signed production package의 실행·권한·키보드·파일 대화상자가 검증되는 것은 아니다. 테스트 전용 빌드와 실제 배포물 검사는 구분한다. [Playwright Electron](https://playwright.dev/docs/api/class-electron)

Tauri도 공식 WebDriver 문서에 Windows·Linux·macOS를 위한 embedded 검사 경로를 설명한다. 과거 direct tauri-driver의 macOS 제한을 전체 테스트 불가능으로 일반화하지 않는다. 이 기록은 Tauri 검증 작업을 추가 배정하지 않는다. [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)

**동일한 시오스 제품을 두 프레임워크로 비교한 오류율·성능 자료는 없다.** Electron을 선택한 것은 실행 엔진 통제와 현재 TypeScript/SSH 구현 경계에 대한 판단이다. 안정성·가벼움·제품 채택은 완성된 배포물과 실제 과업에서 확인해야 한다. G0·G2·G3 수요 조사는 별도 권고 조사이며 기능·보안·배포 release gate를 대체하거나 추가 차단하지 않는다.
