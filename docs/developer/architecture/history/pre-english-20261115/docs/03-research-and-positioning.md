# sshOS(시오스) 자료조사와 제품 포지셔닝 v6

조사 기준일: 2026-11-15. 제품 구현·동일 기능 비교 실험·사용자 수요 조사는 아직 수행하지 않았다. 발표일·릴리스일·저장소 관찰일을 구분한다. 공식 문서는 제공 기능의 근거이며 실제 설치 성공률·사용자 수·시장 성공의 근거가 아니다. 구현 범위는 [제품 계획서](01-product-plan.md), 실행 계약은 [개발 계획서](02-development-plan.md), 검사는 [품질·보안 체크리스트](06-quality-security-checklist.md)가 정한다.

## 1. 사용자 결정과 이번 제품의 역할

sshOS(시오스)는 **사용자 PC에서 기존 Linux 서버에 SSH로 접속하고, 파일·뷰어·원격 프로그램·터미널을 하나의 데스크톱 작업 공간에서 다루는 오픈소스 도구**다. 초기 지원 서버는 Ubuntu Server 24.04 LTS다. 사용자는 서버의 데스크톱 화면을 전송받는 것이 아니라, 시오스 자체의 GUI에서 앱 내부 창을 열고 이동·전환하며 원격 파일과 작업을 다룬다.

사용자가 확정한 원칙은 Electron, macOS·Windows GUI 실행, SSH 계정·개인키 인증, 비동기 SFTP와 상시 진행 상태, 앱 기능 DB 제거, 원격 전용 앱·daemon·Python helper 설치 없음, 온라인 오류 검색·AI 제외다. GUI는 로컬 Chromium이 렌더링한다. 원격 exec와 PTY는 서버에 이미 있는 프로그램을 접속 계정의 기존 권한으로 실행하는 경로다. X11·RDP·VNC와 원격 데스크톱 스트리밍을 내부 창과 혼동하지 않는다.

이전 v5에서 파일 작업만으로 범위를 좁히고 터미널·뷰어·자유로운 내부 창을 제외한 내용은 당시 설계 선택이었다. 이를 사용자의 원래 요구나 논문이 요구하는 결론으로 승격하지 않는다. v6은 내부 데스크톱 창, 파일 보기, 원격 실행과 PTY를 포함하는 최신 요구를 기준으로 다시 작성한다. [이전 v5 조사 기록](history/v5-before-desktop-20261115/docs/03-research-and-positioning.md)은 이력이며 현행 구현 규범이 아니다.

| 구분 | 의미 | 이 문서의 예 |
| --- | --- | --- |
| 사용자 결정 | 대화에서 확정한 제품 방향 | Electron, OS 같은 도구 자체의 경험, 서버 추가 설치 없음 |
| 관찰 사실 | 공식 문서·저장소·레지스트리에서 확인 | Termix 데스크톱은 별도 중앙 서버 없이 로컬 backend로 동작할 수 있음 |
| 설계 선택 | 요구를 구현하기 위한 구체적 선택 | 내부 창 관리, 프로세스 경계, 기능별 지원 조건; 정본은 01·02 |
| 연구 결과 | 논문의 표본·과업·시점 안에서의 발견 | 특정 방화벽 관리자 설문의 GUI 선호 |
| 검증할 가설 | 아직 제품 효과를 입증하지 못한 주장 | 파일·출력·전송을 같은 문맥에 두면 다른 도구로 이동하는 비용이 줄어듦 |

## 2. 실제 유사 도구와 중복되는 기능

### 2.1 공식 자료에서 확인한 구조

| ID·도구 | 배포·연결 구조와 관련 기능 | 라이선스 관찰 | 시오스에 대한 의미 |
| --- | --- | --- | --- |
| O01 Electerm | Windows·macOS·Linux 등의 로컬 터미널·SSH·SFTP 클라이언트. 작은 원격 파일 편집, 여러 인증 방식, 점프·터널, 빠른 명령을 제공한다. [공식 저장소](https://github.com/electerm/electerm) | [MIT](https://github.com/electerm/electerm/blob/master/LICENSE) | 로컬 앱에 GUI 파일 관리·터미널·원격 편집을 결합하는 방식은 선행한다. ‘SSH 도구는 대부분 콘솔뿐’이라는 전제로 기능을 비교하지 않는다. |
| O02 Tabby | Windows·macOS·Linux 터미널·연결 관리자. 탭·분할, SSH, 암호화 저장, SFTP 관련 기능을 제공하고 Windows portable 실행 경로도 있다. [공식 저장소](https://github.com/Eugeny/tabby) | [MIT](https://github.com/Eugeny/tabby/blob/master/LICENSE) | 터미널 중심이라는 차이는 있으나 GUI 연결·파일 기능이 없다고 표현하지 않는다. 기본 기능과 커뮤니티 플러그인 범위는 실제 비교 시 구분한다. |
| O03 XPipe | 기존 SSH·셸을 활용하는 로컬 연결 허브. 파일 브라우저는 주로 원격 셸과 기존 명령을 사용하며 SFTP도 지원한다. 터미널·외부 편집기 연계가 있다. [저장소](https://github.com/xpipe-io/xpipe), [파일 브라우저](https://docs.xpipe.io/guide/file-browser) | 공개 핵심 [Apache-2.0](https://github.com/xpipe-io/xpipe/blob/master/LICENSE.md), open-core. README가 비공개 구현 범위를 명시한다. | 서버 사전 설치 없는 GUI와 기존 명령 활용은 새 범주가 아니다. 제품 전체를 완전한 공개 소스로 분류하지 않는다. |
| O04 Cockpit | 주된 웹 배치는 cockpit-ws·cockpit-bridge를 사용한다. Linux의 Cockpit Client는 SSH로 Cockpit 패키지가 없는 서버에도 접속할 수 있는 별도 경로를 제공한다. 이 경로는 Python bridge를 사용한다. [구조](https://docs.cockpit-project.org/cockpit-guide/latest/guide/cockpit-manual.html), [Client 발표](https://cockpit-project.org/blog/cockpit-295.html) | 프로젝트는 [GNU LGPL](https://cockpit-project.org/)로 소개한다. 재사용 파일별 조건 확인 필요. | ‘Cockpit은 항상 서버 패키지 설치가 필수’는 부정확하다. 시오스의 차이는 Windows·macOS 클라이언트 및 원격 bridge/Python을 추가 요구하지 않는 계약이다. |
| O05 WinSCP | Windows 파일 클라이언트. Explorer·Commander UI, 하단 비동기 큐, 전체·개별 진행·속도·대기·오류·사용자 응답 상태를 표시한다. [공식 전송 큐](https://winscp.net/eng/docs/ui_queue) | [코드 GPL-3.0-or-later](https://winscp.net/eng/docs/license). 설치 패키지·이미지·상표·.NET assembly 조건은 구별한다. | 상시 전송 선반과 대기 이유 표시는 차별성의 선언이 아니라 비교해야 할 기본 품질이다. |
| O06 Cyberduck | macOS·Windows 파일 클라이언트. SFTP 전송, 전송 창, 충돌 처리와 지원 조건에 따른 재개를 제공한다. [전송 문서](https://docs.cyberduck.io/cyberduck/transfer/) | [GPLv3 원문](https://github.com/iterate-ch/cyberduck/blob/master/LICENSE.txt). only/or-later 판정은 파일별 고지를 추가 확인한다. | 두 OS의 GUI 파일 전송은 이미 있다. 재개 제약을 제품 전체의 결함으로 일반화하지 않는다. |
| O07 Termix | 중앙 self-hosted 방식과 데스크톱의 로컬 서버 방식이 모두 있다. 파일 관리자·편집기·이미지/PDF/audio/video preview·터미널·탭·분할·dock을 제공한다. [설치](https://docs.termix.site/install/), [파일 관리자](https://docs.termix.site/plugins/file-manager/), [인터페이스](https://docs.termix.site/guide/interface/) | 코어 [Apache-2.0](https://github.com/Termix-SSH/Termix/blob/main/LICENSE); 플러그인은 개별 확인 대상. | 가장 직접적인 비교 대상이다. 중앙 서버 없음, 파일 뷰어, 터미널 연계, 여러 작업을 유지하는 UI 자체로 유일성을 주장하지 않는다. |
| O08 Capistrano | 로컬 Ruby/Rake에서 SSH로 releases·shared·current 구조의 배포와 이전 릴리스 복귀를 수행한다. [배포 구조](https://capistranorb.com/documentation/getting-started/structure/), [복귀](https://capistranorb.com/documentation/getting-started/rollbacks/) | [MIT](https://github.com/capistrano/capistrano/blob/master/LICENSE.txt) | 원격 명령과 배포 자동화의 선행 사례다. 사용자가 PTY에서 기존 배포 도구를 실행하는 것과 시오스가 배포·복원 기능의 결과를 보증하는 것은 다르다. |

### 2.2 Termix를 비교할 때 반드시 유지할 사실

Termix 공식 Desktop sync 문서는 `This device only`에서 데이터가 PC에 남고 별도 서버 계정 로그인이 필요 없다고 설명한다. 데스크톱 앱은 내부적으로 작은 Termix 서버를 실행한다. 연결된 서버와 동기화하는 방식은 다른 선택지이며, 연결 시작점을 PC 또는 서버로 고를 수 있다. 따라서 시오스와 비교할 때 Termix의 중앙 서버 설치 비용을 무조건 부과하면 안 된다. [공식 Desktop sync](https://docs.termix.site/configure/desktop-sync/)

Termix의 파일 관리자는 원격 미리보기·내장 편집기·터미널 옆 파일 패널을, 인터페이스는 탭·분할·dock을 이미 설명한다. 시오스의 자유롭게 겹치는 내부 창이 사용자의 실제 과업에 더 적합한지는 별도 비교가 필요하다. Termix 코어에는 DB·backend·플러그인 구조가 있으며 공식 package.json에도 관련 의존성이 나타난다. 시오스의 JSON·직접 IPC·비동기 SSH 엔진은 구조적 차이로 설명할 수 있지만, 이것만으로 더 빠르고 안전하거나 메모리가 적다고 결론 내리지 않는다. [Termix package.json](https://github.com/Termix-SSH/Termix/blob/main/package.json)

### 2.3 유지보수 상태 관찰

2026-11-15에 공식 GitHub API의 저장소 정보와 `releases/latest`를 읽었다. 아래 `pushed_at`은 저장소에 push가 관찰된 시각이며 기본 브랜치의 특정 commit 시각으로 바꿔 적지 않는다. 모두 `archived: false`였으나 이는 유지보수 품질·장기 지속성·사용량 등급이 아니다. UTC 시각의 날짜만 표기한다.

| 도구 | 관찰한 latest release와 게시일 UTC | 저장소 pushed_at UTC | 저장소 API |
| --- | --- | --- | --- |
| Electerm | [v5.10.0 · 2026-11-10](https://github.com/electerm/electerm/releases/tag/v5.10.0) | 2026-11-14 | [API](https://api.github.com/repos/electerm/electerm) |
| Tabby | [v1.0.238 · 2026-10-07](https://github.com/Eugeny/tabby/releases/tag/v1.0.238) | 2026-11-13 | [API](https://api.github.com/repos/Eugeny/tabby) |
| XPipe | [24.10 · 2026-10-29](https://github.com/xpipe-io/xpipe/releases/tag/24.10) | 2026-11-11 | [API](https://api.github.com/repos/xpipe-io/xpipe) |
| Cockpit | [372 · 2026-11-10](https://github.com/cockpit-project/cockpit/releases/tag/372) | 2026-11-13 | [API](https://api.github.com/repos/cockpit-project/cockpit) |
| WinSCP | GitHub latest endpoint가 404. 다른 배포 채널의 릴리스 부재를 뜻하지 않음 | 2026-11-13 | [API](https://api.github.com/repos/winscp/winscp) |
| Cyberduck | [9.6.0 · 2026-11-05](https://github.com/iterate-ch/cyberduck/releases/tag/release-9-6-0) | 2026-11-13 | [API](https://api.github.com/repos/iterate-ch/cyberduck) |
| Termix | [v26.11.1 · 2026-11-09](https://github.com/Termix-SSH/Termix/releases/tag/v26.11.1) | 2026-11-14 | [API](https://api.github.com/repos/Termix-SSH/Termix) |
| Capistrano | [v3.20.1 · 2026-05-16](https://github.com/capistrano/capistrano/releases/tag/v3.20.1) | 2026-11-02 | [API](https://api.github.com/repos/capistrano/capistrano) |

## 3. 관련 연구와 적용 범위

### P01 작업 맥락과 중단 후 복귀

Barrett 등, **Field Studies of Computer System Administrators: Analysis of System Management Tools and Practices**, CSCW 2004, pp. 388–395, DOI `10.1145/1031607.1031672`. 관리자 12명을 25일 관찰하고 약 200시간의 영상을 수집한 현장 연구이며 설문·인터뷰·일지 분석도 결합했다. 상황 인식, 작업 중단, 절차 계획과 상태 공유의 필요성을 관찰했다. [저자 원문](https://www.cs.cmu.edu/~15849g/readings/barrett04.pdf)

적용 가설은 파일 창·뷰어·프로그램 출력·터미널 사이에서 대상 서버·경로·작업 정체성을 유지하면 중단 후 복귀가 쉬워질 수 있다는 것이다. 2004년 기업 관리자 연구는 현재 개인 서버 사용자의 수요나 자유 배치 창의 우월성을 입증하지 않는다. 같은 과업에서 문맥 회복 시간과 잘못된 대상 조작을 측정한다.

### P02 GUI 선호의 과업 의존성

Voronkov, Martucci, Lindskog, **System Administrators Prefer Command Line Interfaces, Don’t They? An Exploratory Study of Firewall Interfaces**, SOUPS 2019, pp. 259–271. 공식 학회 페이지는 DOI를 기재하지 않으며 공개 원고 DOI는 `10.48550/arXiv.1905.13582`다. 관리자 300명의 방화벽 관리 설문에서 GUI 선호 60%, CLI 선호 32%를 보고했다. [USENIX](https://www.usenix.org/conference/soups2019/presentation/voronkov), [공개 원고](https://arxiv.org/abs/1905.13582)

자기보고 선호이며 수행 속도나 오류율 비교가 아니다. GUI 파일·프로그램 조작과 터미널을 사용 목적에 맞게 연결할 가치가 있다는 가설에 사용한다. ‘모든 콘솔 작업은 GUI가 낫다’, ‘일반인은 터미널을 사용하면 안 된다’는 결론으로 확대하지 않는다.

### P03 완료 메시지와 관측 근거

Velasquez, Durcikova, **Sysadmins and the Need for Verification Information**, CHIMIT 2008, Article 4, 8 pages, DOI `10.1145/1477973.1477979`. 숙련 관리자 4명에게 각 20개 과업을 부여하고 완료된 64개 과업을 분석했다. 복잡도와 추가 검증 정보 탐색의 관련성이 관찰되었으며 모든 가설이 지지된 것은 아니다. [저자 업로드 원문](https://www.researchgate.net/publication/221545614_Sysadmins_and_the_need_for_verification_information), [저자 연구 목록](https://nicolefv.com/research)

단일 제품·소표본의 탐색 연구다. 시오스는 SSH 연결, 전송 byte, 파일 확정, 명령 exit, 응용프로그램의 실제 목표 달성을 구분한다. `exit 0`을 모든 운영 효과가 검증되었다는 뜻으로 사용하지 않는다. 실행 창에서 사용자가 확인된 결과와 미확인 결과를 구분하는지 측정한다.

### P04 운영 변경과 시험 환경

Jenkins 등, **Not as easy as just update: Survey of System Administrators and Patching Behaviours**, CHI 2024, 17 pages, DOI `10.1145/3613904.3642456`. 패치 관리에 참여한 220명의 자기보고 행동을 조사했으며 전용 시험 환경이 가정만큼 보편적이지 않음을 보고했다. [연구실 원문](https://tulipslab.org/papers/jenkinsCHI2024.pdf)

이는 원격 명령·터미널을 제품에서 제거해야 한다는 근거가 아니다. 기존 권한으로 명령을 실행하는 기능과 서비스의 건강·배포 성공·자동 복구까지 보증하는 기능의 책임이 다르다는 설계 판단에 참고한다. 사용자의 원격 프로그램 선택과 결과를 UI가 과장하지 않는지 확인한다.

### P05 SSH 호스트 신뢰

Neef, Wisiol, **Oh SSH-it, what’s my fingerprint? A Large-Scale Analysis of SSH Host Key Fingerprint Verification Records in the DNS**, CANS 2022, DOI `10.1007/978-3-031-20974-1_4`. Tranco 100만 도메인과 CT의 5억 개 이상 이름을 26일간 측정했다. 조사 집단의 SSHFP는 약 1만 도메인 중 1개였고 그중 절반 이상에 DNSSEC가 없었다. [저자 원문·서지](https://arxiv.org/abs/2208.08846)

2022년 도메인 측정이며 2026년 보급률·사용자 행동 결과가 아니다. 신규 키, 신뢰 일치, 변경된 키를 구분하고 확인하지 않은 키를 신뢰 완료로 표시하지 않는 데 적용한다. 파일 GUI와 PTY 모두 같은 호스트 신뢰 경계를 통과해야 한다.

### P06 되돌리기의 전제

Brown, Patterson, **Undo for Operators: Building an Undoable E-mail Store**, USENIX ATC 2003. 학회 서지에 DOI가 기재되지 않았다. SMTP·IMAP 저장소에 상호작용 기록, 되감기, 수정, 재실행과 외부 결과 정합성을 결합한 시스템 연구다. [USENIX 원문](https://www.usenix.org/conference/2003-usenix-annual-technical-conference/undo-operators-building-undoable-e-mail-store)

범용 SSH 작업에 취소 버튼 하나로 rollback을 제공할 수 있다는 근거가 아니다. 전송 중지, exec/PTY 종료 요청, 이미 수행한 파일·서버 변경의 복원은 구분해야 한다. 원격 명령의 부작용을 창 닫기만으로 되돌렸다고 표시하지 않는다. 이 연구를 서버 DB·상주 helper의 도입 근거로 사용하지 않는다.

## 4. 실제 예외와 확장된 UI의 실패 조건

아래 이슈 상태는 2026-11-15 API에서 재확인했다. 제보자의 추정 원인은 확정된 근본 원인과 구별한다. 이슈의 존재는 현재 모든 사용자에게 발생하는 결함이나 경쟁 제품의 품질 순위를 뜻하지 않는다.

| ID | 공식 자료에서 확인한 사례 | 시오스에 적용할 검증 방향 |
| --- | --- | --- |
| E01 | [Tabby #10628](https://github.com/Eugeny/tabby/issues/10628), 2025-08-12 생성·open. 다운로드·폴더 생성과 달리 업로드 시 세션 종료를 제보. rename 원인설은 제보자의 추정. | 연결·탐색·쓰기·exec/PTY 가능 여부를 분리한다. 하나의 성공으로 다른 작업을 보증하지 않는다. |
| E02 | [Electerm #2928](https://github.com/electerm/electerm/issues/2928), 2023-08-16 생성·2026-05-02 closed. 파일·폴더 혼합 업로드 중 일부 누락 제보. | 여러 항목의 성공·실패·건너뜀을 별도로 기록한다. 현재 제품에 미해결 결함이 남았다고 주장하지 않는다. |
| E03 | [Electerm #4719](https://github.com/electerm/electerm/issues/4719), 2026-11-11 생성·open. Windows에서 원격 파일을 앱 밖 Explorer로 드래그하는 기능 요청. | 내부 창의 OS 같은 표현과 외부 OS 드래그 지원을 혼동하지 않는다. 원격 파일의 로컬 준비·수명·취소는 명세가 정한다. |
| E04 | [Termix 파일 관리자 변경 기록](https://docs.termix.site/plugins/file-manager/changelog/), 1.1.3은 SFTP 단계 timeout과 연결 점검으로 멈춤을 수정했다고 설명한다. 1.2.0은 일부 실패 뒤 남은 항목, 오래된 경로·단축키·창 상태 문제를 다룬다. 개별 버전 게시일은 확인하지 못했다. | 여러 창과 비동기 작업의 늦은 응답이 현재 경로·선택·다른 창을 덮어쓰지 않도록 검증한다. |
| E05 | [Cockpit 322](https://cockpit-project.org/blog/cockpit-322.html), 2024-08-08. 서로 다른 호스트의 코드가 브라우저 문맥에서 상호 영향을 줄 수 있어 host switching의 신뢰 경계를 설명한다. | 서버별 ID와 권한 경계를 유지한다. 파일 내용·프로그램 출력·터미널 title·링크는 신뢰할 수 없는 데이터다. |

뷰어·터미널 확대에는 추가 실패면이 있다. 원격 HTML/SVG 등의 내용을 앱 권한으로 실행하는 것, 터미널 제어 시퀀스를 일반 DOM에 삽입하는 것, 백그라운드 창의 입력을 다른 서버로 보내는 것, 창 크기 변경과 PTY 크기가 어긋나는 것, 출력 소비가 입력 속도를 따라가지 못해 메모리가 늘어나는 것을 검사한다. 구체적 허용 형식·렌더링·버퍼 한도는 02가 정한다. [xterm 보안](https://xtermjs.org/docs/guides/security/), [flow control](https://xtermjs.org/docs/guides/flowcontrol/)

## 5. 기술 근거와 의존성 판단

| 근거 | 확인한 사실 | v6에서의 의미 |
| --- | --- | --- |
| T01 [ssh2 1.17.0 API](https://github.com/mscdex/ssh2/tree/v1.17.0) | SFTP, exec, 원격 shell/PTY, setWindow를 제공한다. hostVerifier 미설정 기본값은 자동 승인이다. exit 이벤트는 프로토콜상 선택적이고 signal 요청을 서버가 무시할 수 있다. | 앱이 host trust·시간 제한·출력·취소 결과를 관리해야 한다. 원격 PTY에 로컬 node-pty가 필수는 아니다. |
| T02 [xterm.js](https://github.com/xtermjs/xterm.js), [보안](https://xtermjs.org/docs/guides/security/) | 터미널 렌더러이며 SSH 클라이언트나 셸 자체가 아니다. title·링크·출력은 embedding 앱에서 안전하게 처리해야 한다. | @xterm/xterm과 fit addon을 IPC 경유 SSH 채널에 연결한다. WebSocket 서버나 외부 CDN을 도입할 이유가 되지 않는다. |
| T03 [Electron 구조](https://www.electronjs.org/docs/latest/tutorial/process-model), [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process) | Chromium 다중 프로세스와 Node 기반 utilityProcess를 제공한다. | 화면의 내부 창과 OS 프로세스 수를 동일시하지 않는다. renderer·IPC·로컬 코어·원격 엔진 경계는 02가 정한다. |
| T04 [OpenSSH PROTOCOL](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL) | rename·hardlink·fsync 등 확장의 의미와 지원 여부는 별개다. | byte 전송·최종 경로 반영·영속 저장을 구분한다. 파일 충돌·덮어쓰기·확정 알고리즘은 02를 따른다. |
| T05 [WinSCP 임시 파일 전송](https://winscp.net/eng/docs/resume) | 임시 이름 전송은 권한·속성·복구 조건에 영향을 준다. | 임시 파일만 사용하면 모든 덮어쓰기와 외부 동시 변경이 안전하다고 약속하지 않는다. |
| T06 [react-rnd](https://github.com/bokuweb/react-rnd) | React drag/resize 구성요소이며 bounds 등의 기능을 제공한다. 창 관리자 전체를 제공하지 않는다. | 조사 대안으로만 남긴다. v6은 React와 Pointer Events로 내부 창을 직접 관리하며 react-rnd는 채택하지 않는다. |

[의존성 기준 v6](dependency-baseline-v6.json)은 2026-11-15 공식 레지스트리로 17개 exact 버전·integrity를 확인한 기록이다. 기존 15개 버전은 조회와 해시가 모두 일치했다. @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0을 추가했다. 설치·빌드·조합 테스트·취약점·배포 라이선스 검토를 완료했다는 뜻은 아니다.

ssh2에는 optional native 의존성이 있고 @types/ssh2의 Node 18 타입 의존성과 최상위 Node 24 타입을 lockfile·strict typecheck에서 확인해야 한다. 메타데이터만으로 조합 결함 또는 호환 성공을 판정하지 않는다. 원격 shell을 위해 로컬 shell·node-pty·로컬 HTTP/WebSocket daemon을 새로 요구하지 않는다.

## 6. 실제 차별화 가설과 트레이드오프

| 검증할 가치 | 감수하는 비용·포기하는 전제 | 반증 또는 한계 |
| --- | --- | --- |
| 파일을 보고 프로그램을 실행하고 결과를 확인하는 흐름이 같은 서버 문맥에 이어진다. | 내부 창의 focus·z-order·입력·닫기·작업 수명을 명확히 구현해야 한다. | 기존 도구보다 창과 서버를 더 혼동하거나 정리 시간이 늘면 이점이 없다. |
| 콘솔에 익숙하지 않은 사용자는 지원 GUI로 시작하고 필요한 경우 같은 공간에서 PTY를 사용한다. | 모든 명령을 GUI로 번역하지 않는다. 원격 프로그램 동작과 권한을 대신 보증하지 않는다. | GUI로 시작한 과업이 자주 설명 없는 터미널 작업으로 끊기면 접근성 가설을 재검토한다. |
| 설치 마법사·중앙 계정·별도 서버 구성 없이 시작한다. | Electron 번들 크기·메모리, OS별 서명·공증·권한 확인 비용을 감수한다. | Termix의 device-only 등 실제 간편 배치와 비교해 준비 단계가 줄지 않을 수 있다. |
| 클라이언트의 JSON·OS 암호화와 기존 SSH 경로를 사용한다. | 로컬 복구·동시성·손상 처리·비밀 저장을 직접 구현한다. 중앙 동기화·팀 관리 기능을 얻지 않는다. | DB 없음 자체는 속도·안전성·유지보수 우위의 증거가 아니다. |
| 전송·실행·출력·결과 불명을 같은 작업 표시 체계로 이해한다. | 파일 작업과 arbitrary exec/PTY는 확인 가능한 성공 의미가 다르다. | exit·연결·byte 수를 전체 과업 성공으로 오인하면 설계가 실패한다. |

‘최초 SSH GUI’, ‘유일한 agentless 도구’, ‘사용자가 어쩔 수 없이 선택’, ‘OS형 UI라서 더 빠름’은 조사 결과로 주장할 수 없다. 시오스의 역할은 중앙 운영 플랫폼이나 원격 데스크톱을 복제하는 것이 아니라, **기존 계정의 권한 안에서 파일·보기·실행을 일관된 로컬 작업 공간으로 연결하는 것**이다. 이 역할이 유용한지는 실제 반복 과업으로 검증한다.

원격 계정에 이미 허용된 명령을 실행할 수 있다는 것과 앱이 권한을 우회하거나 서버 서비스를 자동 설치한다는 것은 다르다. 자동화·서비스·관리 기능별 포함 여부는 01·02의 현행 요구를 따른다. 과거 파일 전용 축소안을 근거로 최신 사용자 기능을 다시 제외하지 않는다.

## 7. 수요 측정과 기능 검증의 분리

G0·G2·G3는 제품 방향을 판단하기 위한 **권고 수요·사용성 조사**다. 모집 실패나 관찰 기회 부족을 기능 결함으로 처리하지 않으며, 외부 출시의 필수 차단 조건으로 사용하지 않는다. 구현 정확성·보안·배포·데이터 무결성 검사는 별도의 release gate로 운영한다. 조사 표본·기간·과업을 정하면 근거와 한계를 함께 기록하며 논문에서 유도된 통계적 합격선이라고 표현하지 않는다.

- **G0 인터뷰:** 최근 실제 파일 찾기·보기·전송·명령 실행·결과 확인 사례와 기존 도구를 수집한다. 파일 작업만 하는 개인 운영자라는 사전 조건으로 최신 요구를 좁히지 않는다.
- **G2 과업 비교:** 같은 사용자가 익숙한 도구 조합과 시오스를 모두 사용한다. Termix device-only, Electerm/Tabby, XPipe, WinSCP·Cyberduck 조합에서 실제 필요한 기능을 갖춘 대상을 선정한다. 북마크·설정·숙련을 인위적으로 제거하지 않는다. 작업 순서 효과를 통제하고 완료·문맥 복귀·대상 오류·도움 요청·기다리는 이유의 이해를 기록한다.
- **G3 반복 사용:** 실행 가능한 배포물에서 실제 과업 기회와 자발적 선택, 다른 도구로 돌아간 이유를 함께 기록한다. 기회가 없으면 관찰 부족이며 수요 없음으로 단정하지 않는다.

일회성 시연의 호감과 장기 채택을 구분한다. 소표본의 오류 0건을 실환경 오류율 0으로 일반화하지 않는다. 수요 조사 결과는 우선순위와 후속 개선의 근거이며, 사용자가 확정한 역할을 근거 없이 축소할 권한이 아니다.

## 8. 라이선스와 재사용의 경계

프로젝트 라이선스 계획은 **AGPL-3.0-only**다. MIT 우선은 의존성 선정 원칙이며 프로젝트 자체가 MIT라는 뜻이 아니다. 다른 오픈소스도 정확한 버전·파일·결합·배포 조건을 검토한 뒤 채택한다. MIT·Apache 표기만으로 Electron 배포물, 전이 의존성, 이미지·글꼴·codec까지 모두 검토 완료로 표시하지 않는다. [GNU 호환성 설명](https://www.gnu.org/licenses/license-compatibility.html), [GNU 라이선스 목록](https://www.gnu.org/licenses/license-list.html)

AGPL은 적용 저작물과 파생물의 배포 및 해당하는 수정판의 네트워크 상호작용에 대응소스 제공 조건을 둔다. 단순히 도구를 사용하는 것, 독립된 파일을 전송하거나 원격 스크립트를 실행하는 것만으로 그 파일·서버 전체 코드가 자동으로 AGPL 공개 대상이 되는 것은 아니다. ‘이 코드를 이용한 모든 코드의 무조건 공개’를 법적으로 전부 보장한다고 설명하지 않는다. [AGPL 본문 §0·2·5·6·13](https://www.gnu.org/licenses/agpl-3.0.html), [GNU FAQ](https://www.gnu.org/licenses/gpl-faq.html#AGPLv3InteractingRemotely)

코드와 디자인 자산도 구별한다. WinSCP의 공식 조건은 아이콘·이미지·상표의 별도 제한을 명시하므로 기능·UX를 조사했다는 이유로 시오스에 해당 이미지를 복사하지 않는다. 경쟁 제품의 기능 목록은 설계 참고 자료이며 코드·자산 반입 승인이 아니다. [WinSCP 라이선스](https://winscp.net/eng/docs/license)
