# sshOS(시오스) 자료조사와 제품 집중 전략

문서 판본은 v5 조사 보고서이며 조사 기준일은 2026년 11월 14일이다. 논문의 발표일, 제품 릴리스일, 저장소 commit 날짜는 조사일과 구분하여 표기한다. 저장소 날짜는 UTC 기준이다. 대상 독자는 sshOS(시오스)의 제품 범위와 구현 명세를 결정하는 기획자·개발자다.

sshOS(시오스)는 **기존 Linux 서버의 파일 작업을 명령어 입력 없이 수행하려는 개인 운영자를 위한 OS형 SSH 작업 공간**에 집중한다. 초기 지원 서버는 Ubuntu Server 24.04 LTS다. SSH 비밀번호·키 인증, 통합 파일 탐색, 비동기 SFTP 업로드·다운로드, 상시 전송 진행, 폴더 생성·이름 변경·비재귀 삭제, 활성 서버의 SSH 응답시간 표시가 초기 범위다.

사용자가 확정한 실행 원칙은 Windows portable `.exe`와 macOS `.app`의 간편 실행, 앱 기능 저장소에서 DB 제거, JSON 파일과 OS 암호화 사용, 원격 서버에 추가 앱·런타임 준비를 요구하지 않는 것이다. macOS `.app` 내부 번들 구조는 허용한다. 사용자는 비교 후 Electron을 최종 선택했다. Chromium·Node.js를 앱에 포함하는 Electron 배포를 기준으로 계획한다. 실제 패키지의 실행 절차·서명·동작은 검증 전이며 프레임워크 선택을 구현 완료의 증거로 사용하지 않는다. 선택 근거와 감수하는 비용은 [Electron 선택 결정 기록](05-framework-comparison.md)에 남긴다.

v3의 단일 파일 배포·전용 슬롯·원격 DB·Python helper·systemd HTTP 서비스·배포 복원 요구는 철회한다. 이전 판본은 [v3 조사 보고서](history/v3/03-research-and-positioning.md)에 보존한다. SSH GUI·원격 파일 탐색·비동기 전송·원격 전용 앱 설치가 없는 연결·OS형 공간은 기존 구현에도 있다. 차별화는 **간편한 시작, 대기 이유의 가시성, 서버·경로 문맥 유지, 기능별 가능 여부의 전달**에서 검증한다. [O03 XPipe](https://github.com/xpipe-io/xpipe), [O07 Termix](https://github.com/Termix-SSH/Termix), [O05 WinSCP 전송 큐](https://winscp.net/eng/docs/ui_queue)

## 1 확정 원칙과 연구 가설의 구분

| 구분 | 이 보고서에서의 의미 | 예시 |
| --- | --- | --- |
| 사용자 확정 원칙 | 최신 사용자 요구로 정한 제품 경계 | 간편 실행, 앱 기능 DB 제거, 추가 서버 앱·런타임 준비 없음 |
| 사용자 확정 기술 | 비교 후 사용자가 선택한 구현 기반 | Electron과 Chromium·Node.js를 포함하는 클라이언트 배포 |
| 관찰 사실 | 공식 문서·저장소·릴리스·이슈에서 확인한 내용 | Termix에는 사용자 PC에서 backend를 실행하는 standalone 선택지가 있다. |
| 연구 결과 | 해당 논문의 방법·표본·시점 안에서 보고된 발견 | 방화벽 관리자 설문에서는 GUI 선호 응답이 CLI보다 많았다. |
| 전략 추론 | 원칙과 근거를 연결한 제품 집중 방향 | 기존 SSH 계정으로 반복하는 파일 탐색·전송·정리를 핵심 과업으로 정한다. |
| 미검증 가설 | 실제 사용자에게 시험해야 하는 주장 | 시작이 간편하고 대기 이유가 명확하면 기존 도구보다 반복해서 선택한다. |

공식 기능 문서는 기능의 제공 범위를 보여 준다. 실제 설치 상태의 동작, 이용률, 결함 빈도, 장기 유지보수, 도입 의향은 별도 검증 대상이다. 이슈는 제보가 있었다는 근거이며 모든 사용자나 현재 버전에 같은 문제가 있다는 근거로 사용하지 않는다. 연구의 적용 범위는 각 논문 항목에 한정한다.

출처 식별자 P01–P06은 논문, O01–O08은 비교 도구, T01–T08은 기술 문서, E01–E05는 실제 예외 사례다. 기존 식별자와 출처를 보존하며 §5에서 현재 적용하는 근거와 철회한 설계의 참고자료를 구분한다. v5의 기능·사용자 동작은 [제품 계획서](01-product-plan.md), 구현 계약은 [개발 계획서](02-development-plan.md), 품질·보안 검사는 [품질·보안 체크리스트](06-quality-security-checklist.md)가 규범이다. 이 보고서는 근거와 가설을 설명하며 별도의 수치·파일 충돌 정책·검사 통과 조건을 만들지 않는다.

## 2 연구 논문

### P01 시스템 관리자의 실제 작업과 맥락

**Field Studies of Computer System Administrators: Analysis of System Management Tools and Practices.** Rob Barrett, Eser Kandogan, Paul P. Maglio, Eben Haber, Leila A. Takayama, Madhu Prabaker. CSCW 2004, 2004년 11월 6–10일, pp. 388–395. DOI `10.1145/1031607.1031672`. [저자 원문과 DOI](https://www.leilatakayama.org/downloads/Takayama.Sysadmins_CSCW2004_prepress.pdf)

**방법과 발견.** 12명의 관리자를 25일 동안 관찰하고 약 200시간의 영상을 수집했다. 별도로 설문 16명과 101명, 인터뷰 12건, 관리자 1명의 10개월 일지 분석을 결합했다. 상황 인식, 끼어드는 작업, 복잡한 절차의 계획·예행연습, 시스템 상태 공유의 필요성을 관찰했다. 명령 실행과 실제 변경 결과를 혼동하는 사례도 포함한다. [원문 방법과 사례](https://www.cs.cmu.edu/~15849g/readings/barrett04.pdf)

**sshOS에 적용할 가설.** 같은 작업의 서버·경로·선택한 파일·전송·결과를 함께 유지하면 화면을 바꾸거나 중단된 작업으로 돌아왔을 때 맥락을 회복하기 쉬워질 수 있다. OS 같은 작업 공간은 이 맥락을 지속시키는 수단으로 평가한다.

**한계와 측정.** 2004년 대형 기업 데이터센터 연구이며 개인 VPS 운영자의 현재 수요를 대표하지 않는다. 중단 후 복귀 시간, 대상 서버·파일을 정확히 식별하는 비율, 잘못된 대상에 조작하는 횟수를 비교 시험에서 측정한다.

### P02 GUI 선호는 작업 종류에 따라 달라진다

**System Administrators Prefer Command Line Interfaces, Don’t They? An Exploratory Study of Firewall Interfaces.** Artem Voronkov, Leonardo A. Martucci, Stefan Lindskog. SOUPS 2019, 2019년 8월, pp. 259–271. 공식 학회 서지에는 DOI가 기재되지 않았으며 공개 원고 DOI는 `10.48550/arXiv.1905.13582`다. [USENIX 학회 페이지](https://www.usenix.org/conference/soups2019/presentation/voronkov), [저자 공개 원고](https://arxiv.org/abs/1905.13582)

**방법과 발견.** 방화벽 관리 경험이 있는 관리자 300명의 온라인 설문에서 GUI 선호는 60%, CLI 선호는 32%였다. 이 결과는 해당 응답자의 방화벽 관리 선호다. [학회 초록과 서지](https://www.usenix.org/conference/soups2019/presentation/voronkov)

**sshOS에 적용할 가설.** 작업을 시각적으로 표현하는 접근은 시험할 가치가 있다. 먼저 반복 과업을 고정하고, 그 과업에서 GUI가 무엇을 줄이는지 측정해야 한다.

**한계와 측정.** 자기보고 선호 조사이며 수행 속도·오류율의 우월성을 측정한 실험이 아니다. Linux 명령 전체를 GUI로 옮길 이유나 sshOS의 시장 수요로 일반화하지 않는다. 기존 도구와 동일 과업의 완료율, 시간, 도움 요청, 잘못된 조작을 비교한다.

### P03 성공 표시 외에 검증 정보가 필요하다

**Sysadmins and the Need for Verification Information.** Nicole F. Velasquez, Alexandra Durcikova. CHIMIT 2008, 2008년 11월 14–15일, Article 4, 8 pages. DOI `10.1145/1477973.1477979`. 원문 저자명은 발표 당시 이름인 Velasquez이며 현재 저자 연구 페이지는 Nicole Forsgren 명의다. [저자 업로드 원문](https://www.researchgate.net/publication/221545614_Sysadmins_and_the_need_for_verification_information), [저자 연구 목록](https://nicolefv.com/research)

**방법과 발견.** 사전 베타 데이터 복제 관리 GUI를 사용한 숙련 관리자 4명의 영상·음성을 분석했다. 각 20개 과업 중 미완료를 제외한 64개 과업이 분석 대상이었다. 복잡도와 추가 검증 정보 탐색 사이에는 유의한 관련이 있었으나, 위험도와의 관련성 및 검증 정보량 증가 가설은 지지되지 않았다. [저자 원문 방법과 결과](https://www.researchgate.net/publication/221545614_Sysadmins_and_the_need_for_verification_information)

**sshOS에 적용할 가설.** 접속 상태, 개별 파일 작업의 가능 여부, 전송 진행, 사용자 응답 대기, 완료 확인을 구분하면 사용자가 다음 행동을 더 정확히 고를 수 있다. SSH 응답시간과 파일 전송 결과는 서로 다른 정보이며 확인하지 않은 결과를 완료 문구에 포함하지 않는다.

**한계와 측정.** 4명·단일 제품의 탐색 연구다. 성공 메시지가 항상 불필요하다는 뜻도 아니다. 사용자가 실제 완료 여부를 정확히 답하는 비율, 다른 도구에서 다시 확인하는 횟수, 결과 불명 상태를 성공으로 오인하는 횟수를 측정한다. DOI 페이지 직접 열기는 실패했으며 저자 원문·저자 목록과 P04 참고문헌으로 서지를 교차 확인했다.

### P04 패치 관리는 별도의 운영 복잡성을 가진다

**Not as easy as just update: Survey of System Administrators and Patching Behaviours.** Adam Jenkins, Linsen Liu, Maria Wolters, Kami Vaniea. CHI 2024, 2024년 5월 11–16일, 17 pages. DOI `10.1145/3613904.3642456`. [연구실 원문](https://tulipslab.org/papers/jenkinsCHI2024.pdf)

**방법과 발견.** 패치 관리에 참여하는 관리자 220명의 자기보고 행동을 조사했다. 전용 시험 환경은 가정했던 만큼 보편적이지 않았으며, 일부 관리자는 소수 장비에서 시험하거나 단계적으로 배포했다. 문제가 생긴 패치에는 동료·외부 커뮤니티 등 여러 정보원을 활용했다. [저자 연구 페이지](https://vaniea.com/publication/jenkins2024chi/)

**sshOS에 적용할 가설.** 패키지 업데이트·신규 서버 구축·자동 복구까지 묶으면 각각의 준비·시험·실패 대응을 함께 책임져야 한다. 초기 버전은 기존 SSH/SFTP 권한으로 수행하는 파일 작업에 집중하고 서버 운영 자동화를 제외한다.

**한계와 측정.** SSH GUI의 효과를 측정한 연구가 아니다. 제외 기능을 정하는 보조 근거다. 고객 인터뷰에서는 파일 탐색·전송·정리 작업이 독립적으로 반복되는지, 사용자가 서버 운영 자동화까지 기대하는지 구분해 기록한다.

### P05 호스트 확인을 자동 신뢰로 대체할 수 없다

**Oh SSH-it, what’s my fingerprint? A Large-Scale Analysis of SSH Host Key Fingerprint Verification Records in the DNS.** Sebastian Neef, Nils Wisiol. CANS 2022, LNCS 13641. DOI `10.1007/978-3-031-20974-1_4`. 공개 원고 최초 제출은 2022년 8월 18일, 개정은 2022년 11월 23일이다. [저자 공개 원문과 출판 정보](https://arxiv.org/abs/2208.08846)

**방법과 발견.** Tranco 100만 도메인과 인증서 투명성 로그의 5억 개 이상 이름을 26일간 측정했다. 조사 집단에서 SSHFP 레코드는 약 1만 도메인 중 1개였으며, 그중 절반 이상은 DNSSEC 없이 제공되었다. [원문 초록](https://arxiv.org/abs/2208.08846)

**sshOS에 적용할 가설.** 첫 접속, 신뢰 기록과 일치하는 재접속, 키 변경을 구분하고 사용자가 확인할 지문과 대상 정보를 보여 준다. 검증 자료가 없는 상황을 검증 완료로 표시하지 않는다.

**한계와 측정.** 도메인 측정이며 사용자 행동 실험이 아니다. 2026년 보급률로 인용하지 않는다. 신규 키·변경 키·주소 재사용·정상 재접속 시험에서 신뢰 상태와 실제 연결 대상이 일치하는지 검증한다.

### P06 복구 기능에는 복구 대상과 기록이 필요하다

**Undo for Operators: Building an Undoable E-mail Store.** Aaron B. Brown, David A. Patterson. USENIX ATC 2003, 2003년 6월. 공식 학회 서지에는 DOI가 기재되지 않았다. [USENIX 원문 페이지](https://www.usenix.org/conference/2003-usenix-annual-technical-conference/undo-operators-building-undoable-e-mail-store)

**방법과 발견.** 운영자 복구 프레임워크를 설계하고 SMTP·IMAP 이메일 저장소에 구현한 시스템 연구다. 사용자 상호작용 기록, 상태 되감기, 수정, 기록된 작업의 재실행 및 외부에 보인 결과의 정합성 처리를 결합했다. [학회 초록과 구현 설명](https://www.usenix.org/conference/2003-usenix-annual-technical-conference/undo-operators-building-undoable-e-mail-store)

**sshOS에 적용할 가설.** 전송 중지와 이미 수행한 원격 파일 변경의 취소를 구별한다. 비재귀 삭제나 이름 변경에 범용 되돌리기를 약속하지 않으며, 단절 뒤 확인하지 못한 결과를 명시한다. 배포 롤백은 초기 범위에서 제외한다.

**한계와 측정.** 이메일 저장소의 공학적 사례이며 범용 SSH 복구 도구의 사용자 시험이 아니다. 전송·이름 변경·삭제의 응답이 사라지는 시험에서 실제 파일 상태와 UI가 일치하는지 확인한다. 이 연구를 서버 측 복구 DB나 helper가 필요하다는 근거로 사용하지 않는다.

## 3 유사 도구의 구현 범위

### 3.1 기능과 배치 구조

| ID와 도구 | 공식적으로 확인한 기능과 배치 구조 | 라이선스와 배포 범위 | sshOS가 검증해야 할 차이 |
| --- | --- | --- | --- |
| O01 Electerm | Windows·macOS·Linux 로컬 터미널·SSH·SFTP 파일 관리자. 키·암호·에이전트 인증, 점프 호스트, 원격 편집을 제공한다. 전송 구현은 별도 SFTP 채널과 진행량 이벤트를 사용한다. [저장소](https://github.com/electerm/electerm), [전송 구현](https://github.com/electerm/electerm/blob/e25e213e472f54ad63642f257cf8456ba3116f5a/src/app/server/transfer.js) | MIT. [라이선스 원문](https://github.com/electerm/electerm/blob/master/LICENSE) | SSH·탐색·진행률의 결합은 이미 있다. 첫 연결부터 파일 작업까지의 준비 단계와 전송 대기 이유의 이해도를 비교한다. |
| O02 Tabby | Windows·macOS·Linux 로컬 터미널. GUI 연결 관리, 탭·분할, 암호화 자격증명 컨테이너, SFTP, 점프 호스트·포워딩을 제공한다. [저장소](https://github.com/Eugeny/tabby) | MIT. [라이선스 원문](https://github.com/Eugeny/tabby/blob/master/LICENSE) | 콘솔 중심이어도 GUI 연결·파일 기능을 갖춘다. 조사한 README만으로 상시 전송 큐의 세부 UX까지 확인한 것은 아니다. |
| O03 XPipe | 기존 SSH·셸 도구를 사용하는 로컬 연결 허브. 원격 사전 설치 없이 파일 브라우저, 시스템 간 전송, 터미널·편집기 연계를 제공한다. [저장소](https://github.com/xpipe-io/xpipe), [파일 브라우저](https://docs.xpipe.io/guide/file-browser) | Windows·macOS·Linux. 공개 핵심은 Apache-2.0이며 open-core다. [라이선스 원문](https://github.com/xpipe-io/xpipe/blob/master/LICENSE.md) README는 일부 기능·shell handling 구현이 비공개임을 명시한다. [공개 범위](https://github.com/xpipe-io/xpipe) | 서버 설치가 필요 없는 GUI라는 주장만으로 차별화할 수 없다. 전체 제품을 완전한 공개 소스라고 분류하지 않는다. |
| O04 Cockpit | 브라우저에서 서비스·로그·자원·스토리지를 관리한다. cockpit-ws와 cockpit-bridge 구조이며 추가 호스트에는 SSH를 사용한다. 파일 관리는 별도 cockpit-files 프로젝트다. [기능](https://cockpit-project.org/guide/latest/features.html), [다중 호스트 구조](https://docs.cockpit-project.org/cockpit-guide/latest/guide/multi-host.html) | Linux 서버와 웹 브라우저. 공식 프로젝트는 GNU LGPL로 소개한다. 세부 파일의 라이선스는 실제 재사용 시 확인해야 한다. [공식 소개](https://cockpit-project.org/) | 범용 서버 GUI는 이미 구현 사례가 있는 범주다. sshOS는 기존 SSH/SFTP를 이용하는 개인 파일 작업에 집중한다. |
| O05 WinSCP | Windows 로컬 파일 클라이언트. Explorer·Commander UI, 하단 백그라운드 큐, 전체·개별 진행률, 속도·예상 시간, 오류·사용자 응답 요구 상태를 제공한다. [전송 큐](https://winscp.net/eng/docs/ui_queue) | 코드 GPL-3.0-or-later. 배포 이미지에는 별도 조건이 명시된다. [공식 라이선스](https://winscp.net/eng/docs/license) | 상시 비동기 전송 표시는 기본 품질 기준으로 본다. 같은 기능의 존재를 인정하고 맥락 유지와 기다리는 이유의 전달 품질을 비교한다. |
| O06 Cyberduck | macOS·Windows 파일 클라이언트. SFTP, 전송 창, 중단·재개, 충돌 처리, Windows 작업 표시줄 진행 표시를 제공한다. 서버가 재개를 지원하지 않으면 처음부터 재전송할 수 있다. [전송 문서](https://docs.cyberduck.io/cyberduck/transfer/) | 공개 저장소는 GPLv3 표기다. only·or-later 세부 판단은 이 조사에서 확정하지 않는다. [라이선스 원문](https://github.com/iterate-ch/cyberduck/blob/master/LICENSE.txt) | 파일 전송과 재개는 선행 기능이다. 일부 서버의 재개 제약을 제품 전체의 결함으로 확대하지 않는다. |
| O07 Termix | 중앙 self-hosted 서버와 데스크톱 standalone local server를 모두 지원한다. 후자는 사용자 PC의 backend 실행 방식이며 대상 SSH 서버에 Termix를 설치하는 방식과 구분한다. SSH·파일 관리·metrics 등 플러그인, dock·탭 배치, 저장·복원 Workspaces, operations 기능이 있다. [저장소](https://github.com/Termix-SSH/Termix), [설치 모델](https://docs.termix.site/install/) | 데스크톱 Windows·macOS·Linux 및 웹·모바일. 코어 Apache-2.0이며 플러그인은 개별 확인 대상이다. [라이선스 원문](https://github.com/Termix-SSH/Termix/blob/main/LICENSE) | 직접 비교 대상이다. standalone도 원격 SSH 서버에 별도 Termix 앱 설치 없이 연결하는 선택지다. 중앙 서버 필수 또는 유일한 무서버 설치 GUI라는 대조를 사용하지 않는다. OS형 작업 공간 역시 단독 차별점이 아니다. |
| O08 Capistrano | 로컬 Ruby·Rake CLI에서 SSH 배포를 실행한다. releases·shared·current 링크 구조와 이전 릴리스 복귀를 제공한다. [구조](https://capistranorb.com/documentation/getting-started/structure/), [복귀](https://capistranorb.com/documentation/getting-started/rollbacks/) | MIT. 특정 데스크톱 GUI OS 지원 제품으로 분류하지 않는다. [라이선스 원문](https://github.com/capistrano/capistrano/blob/master/LICENSE.txt) | 배포·복귀의 선행 사례로 보존한다. v5는 배포와 롤백을 제외하므로 직접 파일 클라이언트 비교의 기준으로 사용하지 않는다. |

### 3.2 유지보수와 archive 상태 관찰

다음 날짜는 2026-11-14 조사 중 공식 저장소 API와 릴리스에서 관찰한 값이다. 최근 commit·release가 있다는 사실만으로 장기 지속 가능성이나 이용률을 판단하지 않는다. `archived: false`는 GitHub 저장소의 보관 설정값이며 적극적인 유지보수를 보장하는 등급이 아니다.

| 도구 | 관찰한 릴리스 게시일 UTC | 관찰한 기본 브랜치 commit UTC | archive 관찰 |
| --- | --- | --- | --- |
| Electerm | [v5.10.0 · 2026-11-10](https://github.com/electerm/electerm/releases/tag/v5.10.0) | [e25e213 · 2026-11-14](https://github.com/electerm/electerm/commit/e25e213e472f54ad63642f257cf8456ba3116f5a) | [API](https://api.github.com/repos/electerm/electerm) `archived: false` |
| Tabby | [v1.0.238 · 2026-10-07](https://github.com/Eugeny/tabby/releases/tag/v1.0.238) | [467ce8e · 2026-10-06](https://github.com/Eugeny/tabby/commit/467ce8ebfa467fb88cf6d154c9a5891e3d3647f0) | [API](https://api.github.com/repos/Eugeny/tabby) `archived: false` |
| XPipe | [24.10 · 2026-10-29](https://github.com/xpipe-io/xpipe/releases/tag/24.10) | [41fca55 · 2026-11-11](https://github.com/xpipe-io/xpipe/commit/41fca55e5aa5fc144cbb68080e36ca003653fe86) | [API](https://api.github.com/repos/xpipe-io/xpipe) `archived: false` |
| Cockpit | [372 · 2026-11-10](https://github.com/cockpit-project/cockpit/releases/tag/372) | [8151774 · 2026-11-13](https://github.com/cockpit-project/cockpit/commit/81517745c50d4be3e30403c9bcc2f6ce9d226b14) | [API](https://api.github.com/repos/cockpit-project/cockpit) `archived: false` |
| WinSCP | GitHub latest release 조회로 확인하지 못했다. 릴리스 부재를 뜻하지 않는다. | [82e192f · 2026-11-11](https://github.com/winscp/winscp/commit/82e192fff59684b44669c2d7902846a37a52504c) | [API](https://api.github.com/repos/winscp/winscp) `archived: false` |
| Cyberduck | [9.6.0 · 2026-11-05](https://github.com/iterate-ch/cyberduck/releases/tag/release-9-6-0) | [6f2511a · 2026-11-13](https://github.com/iterate-ch/cyberduck/commit/6f2511a1e72fc0d1d32c7ad96f22fb0396e5f5c1) | [API](https://api.github.com/repos/iterate-ch/cyberduck) `archived: false` |
| Termix | [v26.11.1 · 2026-11-09](https://github.com/Termix-SSH/Termix/releases/tag/v26.11.1) | [bf67af7 · 2026-11-13](https://github.com/Termix-SSH/Termix/commit/bf67af7dfa3b649d68643eb9de2727f51ee89e53) | [API](https://api.github.com/repos/Termix-SSH/Termix) `archived: false` |
| Capistrano | [v3.20.1 · 2026-05-16](https://github.com/capistrano/capistrano/releases/tag/v3.20.1) | 이번 조사에서 특정 commit 날짜를 기록하지 않았다. | archived 필드 미확인. 추가 익명 API 조회가 rate limit 403으로 제한되었다. |

GitHub 자동 라이선스 분류만으로 라이선스를 확정하지 않는다. Cockpit API 분류는 null, WinSCP는 NOASSERTION이었지만 각 공식 사이트에 라이선스 설명이 있다. 이 보고서의 도구 라이선스는 해당 공식 설명과 공개 범위를 함께 읽은 결과이며, sshOS에 코드를 가져올 때의 결합·배포 적합성을 승인한 기록은 아니다. [Cockpit 공식 소개](https://cockpit-project.org/), [WinSCP 라이선스](https://winscp.net/eng/docs/license)

## 4 실제 예외 사례와 명세에 반영할 경계

| ID | 관찰한 사례 | sshOS에 적용할 설계 추론 |
| --- | --- | --- |
| E01 | Tabby #10628은 2025-08-12 생성되었고 조사일 현재 open이다. 다운로드·폴더 생성은 되지만 업로드 시 SSH 세션이 종료된다는 제보다. 제보자의 rename 원인 추정은 확인된 원인으로 사용하지 않는다. [이슈](https://github.com/Eugeny/tabby/issues/10628) | 연결·탐색 성공을 업로드 성공으로 대체하지 않는다. 업로드별 결과와 제어 연결의 응답성을 시험한다. |
| E02 | Electerm #2928은 2023-08-16 생성, 조사일 현재 closed다. 파일·폴더 혼합 업로드에서 일부 항목이 빠진다는 제보다. 현재 버전에 남아 있다는 주장은 하지 않는다. [이슈](https://github.com/electerm/electerm/issues/2928) | 여러 전송의 성공·실패·건너뜀을 분리하고 일부 실패를 전체 성공으로 표시하지 않는다. 파일·폴더 전송 범위와 충돌 정책은 제품·개발 명세에서 정한다. |
| E03 | Electerm #4719는 2026-11-11 생성, 조사일 현재 open인 Windows 원격 파일의 Explorer 방향 드래그 기능 요청이다. 반대 방향 업로드와의 차이를 설명한다. [이슈](https://github.com/electerm/electerm/issues/4719) | OS와 비슷한 시각 표현이 모든 OS 제스처 지원을 뜻하지 않게 한다. 외부 드래그 지원에는 로컬 준비 시간·취소·임시파일 수명 정의가 필요하다. |
| E04 | Termix 파일 관리자 1.1.3 변경 기록은 SFTP 단계 timeout·연결 사전 확인·오류 표시로 전송·삭제의 멈춤과 패널 정지를 수정했다고 명시한다. 1.1.2는 SFTP 부재·sudo·비영문 파일명을 다룬다. 해당 문서의 버전 게시일은 확인되지 않았다. [공식 변경 기록](https://docs.termix.site/plugins/file-manager/changelog/) | 무기한 진행 표시를 허용하지 않는다. 연결 손실·권한 부족·SFTP 미지원·응답 시간 초과를 구분한다. exec 제한과 SFTP 미지원을 같은 장애로 합치지 않는다. SSH 응답시간을 측정할 수 없어도 SFTP가 가능하면 파일 기능을 유지한다. |
| E05 | Cockpit 322의 2024-08-08 발표는 여러 호스트 코드를 같은 브라우저 문맥에서 실행할 때의 신뢰 문제와 host switcher 폐기 방향을 설명한다. [공식 발표](https://cockpit-project.org/blog/cockpit-322.html) | 서버별 작업 정체성을 고정하고 파일명·로그·명령 출력은 실행 불가능한 데이터로 렌더링한다. 이 사례로 Cockpit 전체의 안전성을 일반화하지 않는다. |

## 5 파일 작업의 확인 범위와 철회한 설계 근거

### 5.1 현재 파일 작업에 적용하는 근거

| ID | 공식 기술 근거 | v5에 적용할 경계 |
| --- | --- | --- |
| T01 | WinSCP는 임시 이름으로 전송한 뒤 이름을 바꾸는 방식, 원본 owner·group 등 속성 소실, 대상 파일 덮어쓰기 권한과 디렉터리 내 신규 파일 생성 권한의 차이를 명시한다. 문서 수정일은 2026-06-03이다. [공식 전송 문서](https://winscp.net/eng/docs/resume) | 임시 파일 전송을 모든 파일에 안전한 만능 방식으로 설명하지 않는다. 파일 충돌·덮어쓰기·메타데이터·임시파일 처리의 실제 계약은 제품·개발 명세를 따른다. |
| T07 | OpenSSH의 posix-rename 확장은 POSIX rename, fsync 확장은 열린 파일의 fsync를 별도로 정의한다. [OpenSSH PROTOCOL](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL) | 전송 진행률을 디스크 영속 저장률로 표현하지 않는다. 지원 확장과 실제로 확인한 범위에 맞춰 완료를 표시하며 추가 서버 프로그램 설치로 기능을 보완하지 않는다. |

접속 성공, 목록 조회 성공, 파일 생성 가능, 업로드 완료, 이름 변경 응답, 삭제 응답은 서로 다른 결과다. 한 기능의 성공으로 다른 기능의 권한과 완료를 추정하지 않는다. 연결 단절로 변경 응답을 받지 못했다면 실제 상태를 확인하기 전 성공 또는 미실행으로 단정하지 않는다. 재시도·조회·정리의 구체적 동작은 제품·개발 명세에 정의한다.

### 5.2 현재 실행 조건에서 제외한 이전 설계 자료

다음 자료의 기술적 설명은 조사 기록으로 보존한다. v5에 Python·DB·전용 슬롯·HTTP 서비스·원격 잠금 helper를 요구하는 근거로 사용하지 않는다.

| ID | 보존하는 원출처의 설명 | v5에서의 처리 |
| --- | --- | --- |
| T02 | Capistrano는 롤백이 앱·플러그인별 검증 대상이며 DB migration을 자동 복원하지 않는다고 명시한다. current 링크 전환 이후의 실패는 불일치 상태를 남길 수 있다. [공식 롤백 문서](https://capistranorb.com/documentation/getting-started/rollbacks/) | 배포·서비스 롤백을 제외하는 배경 자료로만 유지한다. |
| T03 | Python 3.12의 os.replace는 다른 파일시스템 사이에서 실패할 수 있고, 성공한 rename은 원자적 동작이라고 명시한다. [Python 3.12 os.replace](https://docs.python.org/3.12/library/os.html#os.replace) | Python helper 구현 계약을 철회한다. 이 자료로 원격 런타임 준비를 요구하지 않는다. |
| T04 | Python 3.12 shutil 문서는 copy·copy2도 모든 메타데이터를 복사하지 못하며 POSIX owner·group·ACL의 보존 한계를 명시한다. [Python 3.12 shutil](https://docs.python.org/3.12/library/shutil.html) | Python 복사·복원 절차를 철회한다. 실제 파일 기능의 속성 보존 범위는 현재 SFTP 명세에서 정한다. |
| T05 | Ubuntu Noble systemctl 문서는 active를 unit의 활성 상태로 정의하고 서비스별 세부 상태를 별도로 다룬다. [Ubuntu 24.04 systemctl](https://manpages.ubuntu.com/manpages/noble/man1/systemctl.1.html) | 서비스 상태·재시작을 초기 파일 작업의 필수 단계로 사용하지 않는다. |
| T06 | RFC 9110 §15.3.1은 HTTP 200을 해당 요청의 성공으로 정의한다. RFC 발행일은 2022년 6월이다. [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.1) | HTTP endpoint·health check를 제거한다. 상단 SSH 응답시간과 HTTP 응답을 혼용하지 않는다. |
| T08 | Linux flock은 협조적 잠금이며 이를 따르지 않는 프로세스의 파일 접근을 막지 않는다. [Linux flock 설명](https://man7.org/linux/man-pages/man2/flock.2.html) | 전용 슬롯·원격 lock/helper 계약을 철회한다. 일반 파일 작업에서 외부 동시 변경을 무손실로 해결한다고 약속하지 않는다. |

## 6 v5의 역할과 차별화 가설

### 6.1 대상 사용자와 핵심 작업

첫 대상은 기존 Linux 서버와 SSH 계정을 보유한 개인 운영자다. 서버 주소·로그인 방법·작업할 파일을 알고 있으며, 파일 위치를 찾고 전송·정리하는 일에 명령어를 입력하고 싶지 않은 사람이다. 서버를 처음 구축하거나 운영 판단 전체를 자동화하려는 요구는 초기 범위에 포함하지 않는다.

> sshOS(시오스)는 기존 Linux 서버에 SSH로 접속하여 파일을 찾고 옮기고 정리하는 일을, 서버·경로·진행 상태가 이어지는 OS형 작업 공간에서 수행하는 오픈소스 데스크톱 도구다. 초기 지원 서버 OS는 Ubuntu Server 24.04 LTS다.

핵심 작업은 `앱 실행 → SSH 비밀번호 또는 키로 연결 → 통합 탐색기에서 경로·파일 선택 → 전송 또는 지원하는 파일 작업 → 다른 작업 중 진행·대기 이유 확인 → 결과 확인`이다. 폴더 생성, 이름 변경, 비재귀 삭제를 포함하며 서비스 적용·재시작·배포 복원 절차를 요구하지 않는다. 트리와 목록은 한 탐색기의 같은 위치를 표현한다.

OS 같은 느낌은 홈·연결·파일·작업·설정의 일관된 공간, 활성 서버의 명확한 표시, 화면을 바꾸어도 유지되는 작업, 상시 전송 상태로 구현하는 방향이다. Electron의 프로세스·IPC·렌더링 경계와 레이아웃 구현은 개발 계획서에 따른다. 모든 Linux 명령을 버튼으로 만드는 것을 초기 완료 조건으로 삼지 않는다.

### 6.2 실행과 데이터 저장의 경계

| 사용자 원칙 | v5에서의 의미 | 함께 명시할 한계 |
| --- | --- | --- |
| 간편 실행 | 배포 목표는 Windows portable `.exe`와 macOS `.app`다. macOS 앱 내부 번들을 허용한다. | Electron은 Chromium·Node.js를 포함해 배포한다. 설치 프로그램 없는 실행 목표와 실제 해제 파일·설정 저장을 구분하며 실행 단계·파일 크기·서명은 배포물로 검증한다. |
| 앱 기능 저장소에서 DB 제거 | 프로필·설정·작업 상태 등 기능 데이터는 명세에 정한 JSON 파일로 저장하고 민감 값은 OS 암호화 기능을 이용한다. | DB가 없다는 말이 로컬 데이터가 전혀 남지 않는다는 뜻은 아니다. 파일 위치·저장 실패·복구·삭제 정책은 명세에 공개한다. |
| 추가 서버 앱·런타임 준비 없음 | 기존 SSH/SFTP와 접속 계정의 권한을 사용한다. 서버에 전용 앱, Python helper, DB, 관리용 daemon을 설치하거나 준비하게 하지 않는다. | 기존 서버의 SSH/SFTP와 해당 파일 권한이 필요하다. 부족한 권한을 앱이 자동 확대하지 않는다. |
| 기능별 가능 여부 표시 | 연결·SFTP·파일 작업 권한·SSH 응답 측정 상태를 구분한다. | 한 가지 관측 기능의 실패 때문에 가능한 다른 기능까지 실패로 표시하지 않는다. |

Termix standalone의 local server는 사용자 PC의 backend 실행 방식이다. 중앙 self-hosted 서버 배치와 구분해야 하며 원격 SSH 서버에 별도 Termix 프로그램 설치가 필요하다는 뜻으로 설명하지 않는다. sshOS가 별도의 중앙 서버를 요구하지 않는다는 원칙을 유일한 agentless GUI라는 주장으로 바꾸지 않는다. [O07 설치 방식](https://docs.termix.site/install/), [O03 원격 사전 설치 없는 XPipe](https://github.com/xpipe-io/xpipe)

### 6.3 상시 진행과 상단 SSH 응답시간

비동기 업로드·다운로드는 탐색과 화면 이동을 막지 않으며 어느 화면에서도 진행 상태를 확인할 수 있게 한다. UI는 진행 중인지, 큐에서 기다리는지, 사용자 선택을 기다리는지, 응답을 받지 못하는지, 완료 확인 중인지를 구별한다. 비율을 계산할 수 없는 단계에 임의 퍼센트를 붙이지 않는다. 상태별 문구·갱신 주기·동시 전송 수·중단 처리는 제품·개발 명세를 따른다.

오른쪽 상단에는 활성 서버의 **SSH 응답시간**을 표시한다. 측정은 해당 SSH 연결의 `exec('/bin/true')` 요청부터 응답까지의 왕복이며 ICMP ping이 아니다. 채널 준비와 서버의 명령 처리 등 SSH 요청 경로의 지연을 포함하므로 순수 네트워크 지연·파일 전송 속도·서버 전체 정상성으로 표시하지 않는다. 활성 서버를 바꾸면 측정값의 대상도 명확히 바뀌어야 하며 다른 서버의 과거 값을 현재 값처럼 보여 주지 않는다.

exec가 정책상 제한되거나 측정 명령을 실행할 수 없으면 응답시간은 측정 불가다. SFTP가 사용 가능하다면 파일 기능을 유지한다. 오래된 값·진행 중 측정·측정 불가·연결 끊김의 표시, 시간 제한과 측정 빈도는 제품·개발 명세가 정한다. 이 측정 방식은 v5 설계 결정이며 기존 논문이 우월성을 입증한 기능으로 설명하지 않는다.

### 6.4 차별화 가설과 포기하는 범위

| 검증할 가치 | 감수하는 범위와 비용 | 가설을 재검토할 관찰 |
| --- | --- | --- |
| 실행한 뒤 기존 계정으로 첫 파일 작업을 쉽게 시작한다. | Electron 배포·서명·OS별 실행 경험을 검증해야 한다. DB·중앙 서버·추가 서버 런타임을 기능 확장의 전제로 사용하지 않는다. | 기존 도구보다 첫 작업의 준비 시간·설정 실패가 줄지 않는다. |
| 왜 기다리는지와 다음 행동을 이해한다. | 전송 상태·권한·중단·일부 실패를 세밀하게 표현해야 한다. | 진행률만 보고 실패·사용자 응답 대기·측정 불가를 혼동한다. |
| 서버·경로·작업 맥락이 유지된다. | 전환·닫기·재접속의 상태 정책이 필요하다. | 다른 서버나 경로에 작업하거나 전송 대상을 다시 찾는 문제가 줄지 않는다. |
| 가능한 기능을 계속 사용할 수 있다. | SSH 접속, SFTP, exec 측정, 개별 파일 권한을 분리해 다뤄야 한다. | 응답시간 측정 실패가 파일 작업 실패로 오해되거나 전체 화면을 막는다. |
| 필요한 파일 작업에 집중한 OS형 공간을 제공한다. | 서버 전체 제어와 운영 자동화를 초기 범위에서 제외한다. | 목표 사용자의 반복 과업이 파일 기능만으로 끝나지 않거나 기존 도구로 지속해서 돌아간다. |

서버 전체 제어, 서비스 재시작, 배포와 롤백, CI, 프로세스 종료, 팀용 중앙 서버, 패키지·방화벽·계정 관리, 원격 데스크톱 스트리밍, 모든 명령의 GUI화는 초기 범위에 넣지 않는다. 원격 DB·Python·helper·전용 슬롯·HTTP endpoint를 간편 실행의 숨은 선행 조건으로 다시 도입하지 않는다.

온라인 오류 검색과 AI 오류 요약은 이번 계획에서 완전히 제외한다. 검색·요약 UI, 외부 검색 또는 AI 서비스 호출, API 키 설정, 오류·파일·서버 정보의 해당 서비스 전송 경로를 만들지 않는다. 오류 안내는 제품·개발 명세에 정의한 앱 내부 상태와 확인된 원인 범위에서 제공한다.

파일 충돌·덮어쓰기, 전송 대상 형식, 취소·재시도, 임시파일, 메타데이터, 삭제 확인의 세부 계약은 제품·개발 명세를 따른다. 이 조사 보고서는 별도의 파일 정책을 확정하지 않는다. 사용자가 sshOS를 선택할 이유는 간편한 시작과 파일 작업 경험에서 검증하며 기능의 독점성·필연적 채택·장기 수요를 전제하지 않는다.

## 7 수요와 사용성을 검증하는 계획

검증의 모집 대상·인원·기간·과업·합격 단위·통과 수치는 [제품 계획서 §9](01-product-plan.md)가 유일한 규범이다. 이 보고서는 별도의 숫자나 출시 조건을 정의하지 않는다. 해당 기준은 논문에서 도출된 통계 기준이 아니라 이번 제품의 진행 결정을 위한 설계값이다. 인터뷰·비교 시험·pilot은 아직 수행하지 않았다.

- **G0:** 최근 실제 SSH 파일 탐색·전송·정리 사례를 조사한다. 기존 계정과 도구, 수행 빈도, 준비 과정, 기다리며 판단하는 정보, 실패 경험을 기록한다. 단일 파일 배포·전용 슬롯·HTTP 서비스 적합성을 모집 조건으로 사용하지 않는다.
- **G1:** 지원 Ubuntu 서버와 실제 클라이언트에서 접속·SFTP·전송 중단·파일 작업 결과·exec 측정 제한·저장 오류를 시험한다. 서버에 추가 앱·DB·런타임을 준비하지 않은 조건에서 검증한다. 기술 시험으로 수요를 증명하지 않는다.
- **G2:** 동일 참가자가 기존 도구 조합과 sshOS를 모두 사용하며 수행 순서를 균등하게 나눈다. 기존 도구의 북마크·저장 계정·익숙한 절차를 제거하지 않는다. 첫 실행·접속·파일 위치 찾기·전송 중 화면 전환·대기 이유와 결과 이해·지원하는 파일 작업을 비교한다. 준비 시간, 완료 시간, 도움 요청, 잘못된 서버·경로 선택, 측정 불가와 연결 실패의 혼동을 보고한다. Termix standalone, XPipe, WinSCP·Cyberduck 등 실제 사용 조합의 준비 비용과 기능을 공정하게 비교한다.
- **G3:** 서명된 실행 패키지로 반복 사용을 관찰한다. 적합한 파일 작업 기회와 실제 선택 횟수를 함께 기록한다. 기회가 부족하면 관찰 부족으로 분리하고 미지원 과업과 기존 도구로 돌아간 이유를 보고한다.

정답은 시험 전에 실제 서버·파일 상태와 전송 기록으로 고정한다. 시험 후 결과에 맞춰 통과 기준을 낮추지 않는다. 기준을 바꾸면 새 명세와 변경 이유를 기록하고 영향을 받는 시험을 다시 수행한다. 소표본에서 오류가 없다는 결과를 실환경 오류율 0으로 일반화하지 않는다. 통과는 다음 단계 진행 판단이며 대규모 채택이나 장기 유지율의 입증이 아니다.

## 8 계획서와 명세에 연결할 판단

| 근거 또는 확정 원칙 | 계획서에 반영할 결정 | 검증할 내용 |
| --- | --- | --- |
| 사용자 실행 원칙 | portable `.exe`와 `.app` 배포 목표, JSON 파일·OS 암호화, 추가 서버 앱·런타임 준비 없음 | Electron 배포물의 실행 절차와 앱 기능 DB 미사용을 확인한다. |
| P01, P03 | 서버·경로·선택 파일·전송·결과를 같은 작업 문맥에 유지한다. | 화면 전환·재연결 뒤 대상과 상태를 혼동하지 않는다. |
| P02, O01–O07 | GUI·SFTP·OS형 공간·agentless 자체를 독창성 주장으로 사용하지 않는다. | 기존 도구 대비 시작·완료·대기 이유 이해·반복 선택의 차이를 측정한다. |
| P04, P06, O08, T02 | 서버 운영 자동화·배포 롤백·범용 되돌리기를 초기 범위에서 제외한다. | 파일 작업에 집중한 범위가 실제 반복 과업에 맞는지 확인한다. |
| P05 | 신규 호스트·신뢰 일치·키 변경을 구분한다. | 간편한 접속이 호스트 확인 생략으로 구현되지 않는다. |
| T01, T07, E01–E04 | 실제 SFTP 기능·권한·전송 상태·완료 확인 범위에 맞춰 표시한다. | 연결 성공과 개별 작업 성공을 혼동하지 않고 중단·부분 실패를 구별한다. |
| 사용자 상단 표시 원칙, P03 | 활성 서버의 SSH exec 응답시간과 파일 기능 상태를 분리한다. | exec 측정 불가여도 가능한 SFTP 기능은 유지하고 측정 대상을 명확히 표시한다. |
| E05 | 원격 문자열을 데이터로 렌더링하고 서버별 작업 정체성을 유지한다. | 악성 파일명·출력의 실행과 서버 문맥 혼동을 막는다. |

v5의 집중 대상은 기존 서버의 파일 작업이다. 사용자에게 필요한 기본 기능을 쉽게 시작하고 상태를 이해하며 반복해서 사용할 수 있는지가 제품의 실용성을 판단하는 기준이다. 독창성이나 대중적 유행 여부는 공개 기능 목록만으로 확정하지 않는다.
