# sshOS(시오스) Tauri와 Electron 선택 비교

기준일 2026-11-14. 이 비교는 Windows 11 x64와 macOS 14 이상 arm64/x64에서 실행할 GUI SSH/SFTP 도구를 기준으로 한다. 프레임워크 선택은 사용자 결정 대기다. 앞서 선택한 Electron을 자동 확정하거나 Tauri로 자동 변경하지 않는다. 제품 구현과 동일 기능의 비교 벤치마크는 아직 수행하지 않았다.

## 1. 판단

현재 요구를 함께 만족시키면서 첫 버전의 실행 환경과 검증 변수를 줄이는 선택은 **Electron**을 추천한다. 앱 자체의 배포 크기와 메모리 사용을 제품의 가장 강한 차별점으로 삼고 OS WebView 조건과 추가 검증 비용을 받아들인다면 **Tauri**가 더 적합하다. 이 추천은 구조와 현재 설계 변경량에 근거한 판단이며, 측정된 오류율 순위가 아니다.

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

Electron 후보는 `TypeScript + ssh2 + utilityProcess`다. 기존 논리 구조를 직접 적용할 수 있다. Tauri 후보는 `Rust + russh + russh-sftp`를 우선 검증하고, `ssh2-rs`는 대안으로 비교한다. 이는 후보 순서이며 검증된 성능·호환성 승인이 아니다. [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process), [russh](https://docs.rs/russh/latest/russh/), [russh-sftp](https://docs.rs/russh-sftp/latest/russh_sftp/client/struct.SftpSession.html)

ssh2-rs의 같은 Session에서 blocking read는 다른 호출을 막을 수 있다. 단순히 별도 thread에 넣는 것만으로 탐색·전송·지연 측정의 독립성을 보장하지 못한다. 이미 실행된 blocking 작업은 abort만으로 중단되지 않을 수 있다. [ssh2-rs Session](https://docs.rs/ssh2/latest/ssh2/struct.Session.html), [Tokio blocking task](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html)

Rust SSH 후보에도 native 암호 구성요소가 포함될 수 있으므로 ‘Rust 선택=모든 dependency가 순수 Rust’로 설명하지 않는다. 각 target의 실제 feature·link·bundle을 확인한다. [ssh2-rs build](https://raw.githubusercontent.com/rust-lang/ssh2-rs/master/libssh2-sys/build.rs), [russh 구성](https://raw.githubusercontent.com/Eugeny/russh/main/russh/Cargo.toml)

Tauri+Node sidecar도 가능하지만 별도 binary·프로세스 수명·IPC·서명·배포를 관리해야 한다. 초기 시오스에서 경량성과 단순성을 동시에 얻는 기본안으로 추천하지 않는다. Node 설치를 사용자에게 요구하지 않게 패키징할 수 있어도 포함된 runtime 비용은 남는다. [Tauri sidecar](https://v2.tauri.app/develop/sidecar/), [Node sidecar 안내](https://v2.tauri.app/learn/sidecar-nodejs/)

## 7. 테스트 지원의 현재 상태

Tauri 공식 WebDriver 문서는 WebdriverIO의 `@wdio/tauri-service`와 embedded test plugin을 사용해 Windows·Linux·macOS를 검사하는 경로를 설명한다. direct tauri-driver의 macOS 제한과 전체 테스트 가능성을 혼동하지 않는다. test plugin과 embedded server는 production build에서 제외하고 실제 native 연동 검사를 별도로 수행한다. [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)

Playwright의 Electron 자동화는 공식상 experimental이다. 해당 조합의 고정 버전에서 실행·창 탐색·파일 대화상자·진행 이벤트를 검증해야 한다. 어느 쪽도 테스트 도구가 있다는 사실만으로 안정성을 입증하지 않는다. [Playwright Electron](https://playwright.dev/docs/api/class-electron)

## 8. 선택 후 먼저 확인할 작은 검증 범위

아래는 향후 구현 착수 시의 검증 계획이며 이번 비교에서 실행하지 않았다.

1. 동일한 연결·파일 목록·전송·SSH 응답 표시 화면을 지원 client 3종에서 실행한다. 개발 도구 없는 target을 포함한다.
2. 비밀번호와 encrypted/unencrypted Ed25519·RSA를 실제 binary로 검사한다. 최초 host trust·변경 차단과 전송 연결 검증도 포함한다.
3. 2개의 전송, 탐색, SSH 응답 측정을 함께 실행하고 취소·단절·늦은 응답·sleep/resume을 주입한다. 기존 파일 손상과 거짓 완료가 없어야 한다.
4. 다운로드 크기·해제 디스크·실행 가능 시점·전체 프로세스 메모리·유휴 CPU를 같은 환경과 기능으로 측정한다. Windows portable의 해제 시간도 포함한다.
5. Tauri는 WebView2 정상/없음/조건 미달과 macOS WebKit별 검사를 추가한다. Electron은 자체 runtime 갱신·portable cleanup·safeStorage 재실행을 확인한다.

둘 다 전체 제품을 먼저 개발할 필요는 없다. 사용자가 선택한 후보의 위 위험을 초기에 확인하고, 핵심 요구를 만족하지 못할 때에만 비교 대안을 다시 연다. PoC를 통과했다는 사실도 장기 오류 확률의 수치가 아니다.

## 9. 사용자가 결정할 두 가지 선택

- **Electron 유지:** 조금 더 큰 배포물과 runtime 업데이트 책임을 받아들이고, 실행 엔진 통제·기존 TypeScript SSH 구현·초기 검증의 단순성을 우선한다. 현재 첫 버전의 추천안이다.
- **Tauri 변경:** 앱 자체의 작은 배포물과 경량화 여지를 우선하고, WebView2 지원 조건·OS별 렌더링·Rust SSH backend 검증에 더 투자한다. 경량성을 핵심 제품 기준으로 정한다면 이 선택이 맞다.

선택과 관계없이 DB 없는 저장, 대상 서버 추가 설치 없음, OS형 GUI, 비동기 전송, SSH 응답 지표는 유지한다. Windows .exe/macOS .app이라는 실행 목표도 유지하되 runtime 포함 방식은 선택 결과와 초기 검증에 맞춰 확정한다. 프레임워크 결정 전 시스템 그림은 [공통 아키텍처](04-system-architecture.md)다.
