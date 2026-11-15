# sshOS(시오스) Electron 선택 결정 기록

문서 판본 v5, 결정·조사 기준일 2026-11-14. 사용자는 Tauri와 Electron 비교 후 **Electron을 최종 선택했다**. Windows 11 x64와 macOS 14 이상 arm64/x64에서 실행할 GUI SSH/SFTP 도구를 기준으로 비교한 결과와 선택 비용을 보존한다. Tauri는 검토한 대안이며 향후 도입·전환·개발 일정은 배정하지 않는다. 제품 구현과 동일 기능의 비교 벤치마크는 아직 수행하지 않았다.

기능·사용자 동작은 [제품 계획서](01-product-plan.md), 구현 계약은 [개발 계획서](02-development-plan.md), 품질·보안 검사는 [품질·보안 체크리스트](06-quality-security-checklist.md)를 따른다. 이 기록의 비교 예시는 별도 구현 요구나 통과 수치를 만들지 않는다. 온라인 오류 검색과 AI 오류 요약은 이번 계획에서 완전히 제외한다.

## 1. 선택과 감수하는 비용

선택한 Electron은 실행 엔진 통제, 기존 TypeScript SSH 구현과의 연결, 첫 버전의 검증 변수 축소에 우선순위를 둔다. Chromium·Node.js를 포함하는 배포 크기와 메모리 비용, runtime 보안 업데이트 책임을 감수한다. Tauri의 OS WebView 활용과 작은 앱 배포물 가능성은 비교 장점으로 남기며 향후 전환 계획으로 해석하지 않는다. 선택 근거는 구조와 설계 변경량에 관한 판단이며 측정된 오류율·성능 순위가 아니다.

DB 없음, 대상 Linux에 전용 앱·Python·관리 서버 설치 없음, 비밀번호/키 SSH, 비동기 SFTP, 상시 진행률, 상단 SSH 응답시간, OS형 GUI는 두 프레임워크 모두 구현할 수 있다. 이 요구만으로 어느 한쪽이 필수는 아니다. 프레임워크는 클라이언트 실행 구조의 선택이며 원격 서버 구조와 구별한다.

## 2. 실행 구조

| 구분 | Electron | Tauri 2 |
| --- | --- | --- |
| UI | 앱에 포함한 Chromium에서 HTML/CSS/React/TypeScript 실행 | Windows WebView2, macOS WKWebView에서 HTML/CSS/React/TypeScript 실행 |
| 로컬 backend | Node.js, 주로 TypeScript/JavaScript. SSH 처리는 utility process로 분리 가능 | Rust core. SSH/SFTP 라이브러리와 async task를 연결 |
| 사용자 런타임 설치 | Node·Chromium을 앱에 함께 배포하므로 별도 설치 불필요 | Rust 설치 불필요. Windows는 WebView2 필요; macOS는 OS WebKit 사용 |
| 앱 기능 데이터 | 로컬 JSON과 OS 암호화 저장 가능. DB 필수 아님 | 로컬 JSON과 OS 암호화 연계 가능. SQL/DB plugin 필수 아님 |
| 원격 서버 | 기존 SSH/SFTP와 필요한 기존 명령 사용 | 동일 |

Tauri는 OS의 WebView를 사용하고 Electron은 Chromium·Node.js를 제품과 함께 배포한다. 따라서 전자는 배포물 중복을 줄이고 후자는 앱이 사용할 엔진 버전을 묶어서 통제한다. [Tauri WebView](https://v2.tauri.app/reference/webview-versions/), [Electron 구조](https://www.electronjs.org/docs/latest/tutorial/process-model)

두 방식 모두 WebView/renderer 등 여러 프로세스를 사용할 수 있다. Tauri를 무조건 단일 프로세스 앱이라고 설명하지 않는다. [Tauri 프로세스](https://v2.tauri.app/concept/process-model/)

## 3. 시오스에서의 장단점과 감수할 비용

| 선택 기준 | Electron | Tauri 2 | 시오스의 판단 |
| --- | --- | --- | --- |
| 다운로드 크기 | Chromium·Node 묶음이 기본 비용 | OS WebView 사용 시 앱 자체 배포물을 줄이기 유리 | 경량 배포 우선이면 Tauri |
| 전체 메모리·시작 시간 | 여러 runtime 프로세스와 portable 해제 비용 | 낮아질 여지가 있지만 WebView 프로세스·기능에 좌우됨 | 동일 기능으로 실측 전 수치·배수 약속 금지 |
| Windows의 실행 전제 | 앱에 묶인 엔진 사용 | WebView2 존재·지원 버전에 의존 | 환경 독립성을 우선하면 Electron |
| 화면의 OS 간 일관성 | 동일 Chromium 계열 버전을 고정 | Windows Chromium계열과 macOS WebKit 차이 | Electron이 CSS·Web API 차이의 변수를 줄임. 글꼴·DPI·IME 등 OS 차이는 양쪽 모두 검사 |
| SSH/SFTP 구현 | JS ssh2와 stream·현재 TypeScript 설계를 직접 연결 | Rust SSH/SFTP 후보를 선정하고 UI↔Rust 경계 구현 | 현 계획의 변경량은 Electron이 적음 |
| 인증·전송·취소 오류 | 상태기계·host trust·backpressure를 직접 정확히 구현해야 함 | 동일. Rust 소유권이 원격 작업 의미까지 보장하지 않음 | 프레임워크만으로 데이터 손실률 우열을 판정할 수 없음 |
| 개발·빌드 | JS/TS 중심. native 모듈 채택 시 별도 빌드 점검 | JS/TS+Rust, SSH 후보에 따라 C·암호 라이브러리 빌드도 포함 | Tauri에서 늘어날 기술 경계와 CI 점검 비용 수용 필요 |
| 엔진 보안 업데이트 | Electron·Chromium·Node 업데이트를 앱 배포자가 추적 | OS WebView 업데이트 영향을 받음. 고정 WebView2 동봉 시 직접 갱신 | 통제 가능한 버전과 업데이트 책임의 교환 |
| 자동 UI 검사 | Playwright Electron 경로가 있으나 공식상 experimental | WebdriverIO embedded 방식으로 Windows/macOS 검사 가능 | 둘 다 실제 패키지 검사 필요. Tauri의 macOS 테스트가 불가능하다는 주장은 현재 문서와 다름 |
| 설치 없는 배포 | Windows portable.exe는 내부 임시 해제, macOS .app bundle | Windows raw exe는 runtime·resource 조건 확인, macOS .app bundle | 단일 다운로드와 실행 중 파일 0개를 구분 |

Electron의 최소 압축 앱도 해당 Electron runtime 배포물 크기에 가깝다고 공식 Packager가 설명한다. DB를 제거해도 이 기본 크기는 사라지지 않는다. Tauri의 작은 예제 수치를 시오스 완성본의 확정 크기로 인용하지 않는다. [Electron 패키징](https://electron.github.io/packager/main/index.html), [Tauri 앱 크기](https://v2.tauri.app/concept/size/)

## 4. Windows WebView2가 만드는 선택

Windows 11에는 WebView2가 기본 제공되지만 Microsoft는 배포 시 runtime 존재를 확인하도록 안내한다. 시스템 구성·정책·손상·버전 조건에 대한 실패 처리가 필요하다. [Tauri 지원 WebView](https://v2.tauri.app/reference/webview-versions/), [Microsoft 배포 지침](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

| Tauri 배포 정책 | 얻는 것 | 감수하는 것 |
| --- | --- | --- |
| OS의 WebView2 사용 | 작은 앱 배포물, OS/관리 정책에 의한 runtime 갱신 | runtime이 없거나 조건이 맞지 않으면 그대로 실행 불가. 기존 runtime을 지원 전제로 명시 |
| runtime 설치 프로그램 포함/다운로드 | 없는 PC에도 준비할 수 있음 | 추가 runtime 설치가 발생하므로 사용자의 ‘설치 과정 없이 실행’ 목표와 충돌 |
| Fixed Version runtime 동봉 | 해당 runtime을 시스템에 따로 설치하지 않고 사용할 수 있는 구성 | 배포 크기·해제 파일·자체 보안 갱신 책임 증가. 단일 portable 패키지 통합은 별도 검증 |

Tauri 공식 문서는 고정 WebView2 동봉 시 Windows installer 크기가 약180MB 늘어나는 예를 제시한다. 이는 현재 시오스 빌드 측정값이 아니며 실제 선택 버전에 따라 달라진다. installer 설정이 곧 단일 portable.exe의 완성된 배포 절차라는 뜻도 아니다. [Tauri runtime 옵션](https://v2.tauri.app/distribute/windows-installer/#fixed-version)

Electron portable도 실행 중 리소스를 TEMP에 해제할 수 있으며 macOS .app은 내부적으로 여러 파일이다. ‘사용자가 실행하는 아이콘 하나’와 ‘물리 파일 하나·생성 파일 없음’을 동일하게 약속하지 않는다. [electron-builder v26 portable](https://www.electron.build/v26/docs/api/app-builder-lib.interface.portableoptions/), [Apple bundle](https://developer.apple.com/library/archive/documentation/CoreFoundation/Conceptual/CFBundles/BundleTypes/BundleTypes.html)

## 5. 오류가 생기는 조건과 줄이는 방법

동일한 시오스 구현을 두 기술로 시험한 자료가 없으므로 ‘Tauri 오류 확률 X%, Electron Y%’라는 수치는 제시하지 않는다. 아래는 실제 실패 조건의 차이와 설계 판단이다.

| 오류 종류 | 상대적으로 관리하기 쉬운 선택과 이유 | 어느 선택에서도 필요한 조치 |
| --- | --- | --- |
| GUI 엔진 차이·재현 환경 차이 | Electron이 엔진을 함께 묶어 변수를 줄이기 쉬움 | macOS/Windows의 DPI·한글 입력·파일 대화상자·드롭·접근성 실기기 검사 |
| WebView2 누락·버전 조건 | Electron은 WebView2를 사용하지 않음 | Tauri는 presence/version 처리 또는 동봉 정책 확정 |
| 다운로드·업데이트의 크기 부담 | OS runtime 사용형 Tauri가 유리 | 압축/해제 크기·최초 실행 시간을 각각 측정 |
| 메모리 압박으로 인한 문제 | Tauri에 절감 가능성이 있으나 결과 미확인 | 전체 프로세스 메모리·전송 스트리밍·누수·절전 복귀 검사 |
| SSH 키·암호 알고리즘·SFTP 호환 | framework로 우열 확정 불가; 실제 선택 library 영향이 큼 | 정확한 key 형식과 암호화 passphrase, host key 변경, server 제한 matrix |
| 취소·재접속·파일 충돌·거짓 완료 | 양쪽 모두 앱의 동시성·상태 모델 문제 | late event 폐기, immutable serverId, 응답 유실을 결과 불명으로 처리, 재실행 제한 |
| 로컬 명령·파일 권한 노출 | 양쪽 모두 명시적 경계가 필요 | Electron preload/IPC 또는 Tauri capabilities/command 검증, secret을 UI에 보관하지 않음 |
| 특정 OS 배포에서만 발생하는 오류 | native SSH dependency가 적은 구성은 빌드 변수를 줄임 | 개발 도구 없는 clean target에서 signed package를 실행 |

Rust 메모리 안전성은 장점이지만 잘못된 서버 선택, 중복 명령, 파일 덮어쓰기, 프로토콜 의미상의 실패를 자동 방지하지 않는다. Electron도 JS/TS로 작성했다는 이유로 SSH 신뢰가 자동 보장되지는 않는다. [Tauri core 책임](https://v2.tauri.app/concept/process-model/), [Electron 보안 지침](https://www.electronjs.org/docs/latest/tutorial/security), [Tauri capabilities](https://v2.tauri.app/security/capabilities/)

JS ssh2는 hostVerifier를 지정하지 않으면 기본적으로 호스트 키를 자동 수락하므로 시오스의 신뢰 정책을 반드시 구현해야 한다. Tauri 후보의 russh도 UI 기반 신뢰 승인과 지문 변경 처리가 필요하다. [ssh2 API](https://github.com/mscdex/ssh2), [russh host key handler](https://docs.rs/russh/latest/russh/client/trait.Handler.html)

## 6. SSH backend와 기술 경계

선택한 Electron의 backend 계획은 `TypeScript + ssh2 + utilityProcess`다. 구체적인 책임·IPC·상태 계약은 개발 계획서가 정한다. 비교 당시 Tauri의 대안으로 검토한 구성은 `Rust + russh + russh-sftp`와 `ssh2-rs`다. 이 Rust 구성은 v5 구현·검증 일정에 넣지 않으며 아래 설명은 비교 근거를 보존한 것이다. Electron 선택도 성능·호환성 검증 완료를 뜻하지 않는다. [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process), [russh](https://docs.rs/russh/latest/russh/), [russh-sftp](https://docs.rs/russh-sftp/latest/russh_sftp/client/struct.SftpSession.html)

ssh2-rs의 같은 Session에서 blocking read는 다른 호출을 막을 수 있다. 단순히 별도 thread에 넣는 것만으로 탐색·전송·지연 측정의 독립성을 보장하지 못한다. 이미 실행된 blocking 작업은 abort만으로 중단되지 않을 수 있다. [ssh2-rs Session](https://docs.rs/ssh2/latest/ssh2/struct.Session.html), [Tokio blocking task](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html)

Rust SSH 후보에도 native 암호 구성요소가 포함될 수 있으므로 ‘Rust 선택=모든 dependency가 순수 Rust’로 설명하지 않는다. 해당 후보를 채택한다면 target별 실제 feature·link·bundle 확인이 필요한 비교 비용이다. [ssh2-rs build](https://raw.githubusercontent.com/rust-lang/ssh2-rs/master/libssh2-sys/build.rs), [russh 구성](https://raw.githubusercontent.com/Eugeny/russh/main/russh/Cargo.toml)

Tauri+Node sidecar도 가능하지만 별도 binary·프로세스 수명·IPC·서명·배포를 관리해야 한다. 초기 시오스에서 경량성과 단순성을 동시에 얻는 기본안으로 추천하지 않는다. Node 설치를 사용자에게 요구하지 않게 패키징할 수 있어도 포함된 runtime 비용은 남는다. [Tauri sidecar](https://v2.tauri.app/develop/sidecar/), [Node sidecar 안내](https://v2.tauri.app/learn/sidecar-nodejs/)

## 7. 테스트 지원의 현재 상태

Tauri 공식 WebDriver 문서는 WebdriverIO의 `@wdio/tauri-service`와 embedded test plugin을 사용해 Windows·Linux·macOS를 검사하는 경로를 설명한다. direct tauri-driver의 macOS 제한과 전체 테스트 가능성을 혼동하지 않는다. test plugin과 embedded server는 production build에서 제외하고 실제 native 연동 검사를 별도로 수행한다. [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)

Playwright의 Electron 자동화는 공식상 experimental이다. 해당 조합의 고정 버전에서 실행·창 탐색·파일 대화상자·진행 이벤트를 검증해야 한다. 어느 쪽도 테스트 도구가 있다는 사실만으로 안정성을 입증하지 않는다. [Playwright Electron](https://playwright.dev/docs/api/class-electron)

## 8. Electron 구현 착수 후의 검증 범위

아래는 선택한 Electron의 검증 범주다. 지원 환경·동시 전송 수·시간·파일 크기·통과 기준은 제품 계획서, 개발 계획서와 품질·보안 체크리스트를 따른다. 이번 결정 기록에서 검증을 실행했거나 별도의 수치 기준을 확정한 것은 아니다.

1. 개발 도구가 없는 지원 클라이언트에서 실제 portable `.exe`와 `.app`를 실행하고 연결·파일 탐색·전송·상단 SSH 응답 표시를 검사한다.
2. 명세의 비밀번호·키 형식·passphrase, 최초 host trust·키 변경 차단과 각 SSH 연결의 신뢰 검증을 확인한다.
3. 비동기 전송·탐색·SSH 응답 측정을 함께 수행하고 취소·단절·늦은 응답·sleep/resume을 검사한다. exec 측정 제한과 가능한 SFTP 기능을 구분한다.
4. 다운로드 크기·해제 디스크·실행 가능 시점·전체 프로세스 메모리·유휴 CPU를 실제 배포물에서 측정한다. Windows portable 해제와 종료 뒤 정리도 포함한다.
5. Electron runtime 갱신, preload·IPC 경계, OS 암호화 재실행, JSON 저장·복구, 서명·공증을 정본 명세의 검사에 연결한다. 온라인 오류 검색·AI 요약용 UI·호출·데이터 전송은 포함하지 않는다.

Tauri 비교 구현이나 별도 PoC는 현재 작업 범위가 아니다. Electron의 핵심 계약을 충족하지 못하면 결함과 요구 충돌을 기록해 명세 변경 절차를 따르며 프레임워크를 자동 전환하지 않는다. 검증 통과를 장기 오류 확률이나 시장성의 증명으로 표현하지 않는다.

## 9. 최종 결정

**사용자 결정은 Electron이다.** agentless SSH/SFTP GUI, DB 없는 JSON 파일과 OS 암호화 저장, Ubuntu Server 24.04 LTS 지원, 상시 비동기 전송 진행률, 활성 서버의 SSH 응답시간, Windows portable `.exe`와 macOS `.app` 목표를 이 기술로 구현한다. 원격 서버에 전용 앱·Python·관리 DB를 준비하게 하지 않는다. 온라인 오류 검색과 AI 오류 요약은 이번 계획에서 제외한다.

선택 이유는 실행 엔진을 함께 배포하여 환경 변수를 줄이고 TypeScript 기반 SSH 구현을 직접 연결하는 데 있다. 앱 크기와 runtime 유지보수 비용은 실제 배포·성능 검사로 관리한다. Tauri는 비교에 사용한 대안으로만 남으며 향후 전환 약속이 아니다. 현재 시스템 구성은 [공통 아키텍처](04-system-architecture.md), 구현·검사는 제품·개발 계획서와 품질·보안 체크리스트가 규정한다.
