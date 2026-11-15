# sshOS(시오스) 자료조사와 제품 집중 전략

문서 판본은 v3 조사 보고서이며 조사 기준일은 2026년 11월 14일이다. 논문의 발표일, 제품 릴리스일, 저장소 commit 날짜는 조사일과 구분하여 표기한다. 저장소 날짜는 UTC 기준이다. 대상 독자는 sshOS(시오스)의 제품 범위와 구현 명세를 결정하는 기획자·개발자다.

SSH 연결을 GUI로 제공하는 기능, 원격 파일 탐색과 비동기 전송, 대상 서버에 전용 관리 프로그램을 설치하지 않는 연결 방식, OS처럼 구성한 작업 공간에는 이미 구현 사례가 있다. 특히 XPipe와 Termix는 초기 구상과 직접 겹친다. 따라서 개념의 새로움보다 특정 운영 작업을 끝까지 수행하고 그 결과를 이해하게 하는 능력을 검증해야 한다. [O03 XPipe](https://github.com/xpipe-io/xpipe), [O07 Termix](https://github.com/Termix-SSH/Termix)

이번 조사에 따른 전략안은 **기존 Ubuntu Server 24.04 LTS의 systemd HTTP 서비스를 담당하는 사용자가 단일 파일을 검증 업로드하고, 명시적으로 파일 교체와 재시작을 실행한 뒤, 관찰 결과를 확인하며 필요하면 직전 파일을 복원하는 작업**에 집중하는 것이다. 이 타깃과 범위는 조사에서 도출한 제안이다. 사용자가 이미 확정한 요구사항으로 취급하지 않는다. 제품·개발 계획서가 이 전략안을 채택한 경우에만 구현 범위가 된다.

## 1 사실과 전략 가설의 구분

| 구분 | 이 보고서에서의 의미 | 예시 |
| --- | --- | --- |
| 관찰 사실 | 논문 원문, 공식 문서, 저장소, 릴리스, 이슈에서 확인한 내용 | Termix 데스크톱에는 standalone local server 방식이 있다. |
| 연구 결과 | 해당 연구의 방법·표본·시점 안에서 보고된 발견 | 방화벽 관리자 설문에서는 GUI 선호 응답이 CLI보다 많았다. |
| 전략 추론 | 관찰과 연구를 바탕으로 sshOS가 선택할 제품 범위 | 단일 파일의 적용·관찰·복원을 연결된 작업으로 제공한다. |
| 미검증 가설 | 목표 사용자에게 실제로 시험해야 하는 주장 | 기존 도구 조합보다 결과 이해도가 높고 반복 사용 의향이 생긴다. |

공식 기능 문서의 존재는 기능의 구현 의도와 제공 범위를 보여 준다. 실제 설치 상태의 동작, 사용량, 결함 빈도, 장기 유지보수, 구매·도입 의향은 별도 검증 대상이다. 이슈는 제보가 있었다는 근거이며 해당 문제가 모든 사용자 또는 현재 버전에 존재한다는 근거로 사용하지 않는다. 연구 결과의 적용 범위는 각 논문 항목에 한정한다.

출처 식별자 P01–P06은 논문, O01–O08은 비교 도구, T01–T08은 기술 문서, E01–E05는 실제 예외 사례다. 식별자는 제품·개발 명세와 근거를 연결하기 위해 유지한다.

## 2 연구 논문

### P01 시스템 관리자의 실제 작업과 맥락

**Field Studies of Computer System Administrators: Analysis of System Management Tools and Practices.** Rob Barrett, Eser Kandogan, Paul P. Maglio, Eben Haber, Leila A. Takayama, Madhu Prabaker. CSCW 2004, 2004년 11월 6–10일, pp. 388–395. DOI `10.1145/1031607.1031672`. [저자 원문과 DOI](https://www.leilatakayama.org/downloads/Takayama.Sysadmins_CSCW2004_prepress.pdf)

**방법과 발견.** 12명의 관리자를 25일 동안 관찰하고 약 200시간의 영상을 수집했다. 별도로 설문 16명과 101명, 인터뷰 12건, 관리자 1명의 10개월 일지 분석을 결합했다. 상황 인식, 끼어드는 작업, 복잡한 절차의 계획·예행연습, 시스템 상태 공유의 필요성을 관찰했다. 명령 실행과 실제 변경 결과를 혼동하는 사례도 포함한다. [원문 방법과 사례](https://www.cs.cmu.edu/~15849g/readings/barrett04.pdf)

**sshOS에 적용할 가설.** 같은 작업의 서버·경로·파일·서비스·전송·관찰 기록을 함께 유지하면 중단 뒤 복귀와 결과 확인이 쉬워질 수 있다. OS 같은 작업 공간은 이 맥락을 지속시키는 수단으로 평가한다.

**한계와 측정.** 2004년 대형 기업 데이터센터 연구이며 개인 VPS 운영자의 현재 수요를 대표하지 않는다. 중단 후 복귀 시간, 대상 서버·파일을 정확히 식별하는 비율, 잘못된 대상에 조작하는 횟수를 비교 시험에서 측정한다.

### P02 GUI 선호는 작업 종류에 따라 달라진다

**System Administrators Prefer Command Line Interfaces, Don’t They? An Exploratory Study of Firewall Interfaces.** Artem Voronkov, Leonardo A. Martucci, Stefan Lindskog. SOUPS 2019, 2019년 8월, pp. 259–271. 공식 학회 서지에는 DOI가 기재되지 않았으며 공개 원고 DOI는 `10.48550/arXiv.1905.13582`다. [USENIX 학회 페이지](https://www.usenix.org/conference/soups2019/presentation/voronkov), [저자 공개 원고](https://arxiv.org/abs/1905.13582)

**방법과 발견.** 방화벽 관리 경험이 있는 관리자 300명의 온라인 설문에서 GUI 선호는 60%, CLI 선호는 32%였다. 이 결과는 해당 응답자의 방화벽 관리 선호다. [학회 초록과 서지](https://www.usenix.org/conference/soups2019/presentation/voronkov)

**sshOS에 적용할 가설.** 작업을 시각적으로 표현하는 접근은 시험할 가치가 있다. 먼저 반복 과업을 고정하고, 그 과업에서 GUI가 무엇을 줄이는지 측정해야 한다.

**한계와 측정.** 자기보고 선호 조사이며 수행 속도·오류율의 우월성을 측정한 실험이 아니다. Linux 명령 전체를 GUI로 옮길 이유나 sshOS의 시장 수요로 일반화하지 않는다. 기존 도구와 동일 과업의 완료율, 시간, 도움 요청, 잘못된 조작을 비교한다.

### P03 성공 표시 외에 검증 정보가 필요하다

**Sysadmins and the Need for Verification Information.** Nicole F. Velasquez, Alexandra Durcikova. CHIMIT 2008, 2008년 11월 14–15일, Article 4, 8 pages. DOI `10.1145/1477973.1477979`. 원문 저자명은 발표 당시 이름인 Velasquez이며 현재 저자 연구 페이지는 Nicole Forsgren 명의다. [저자 업로드 원문](https://www.researchgate.net/publication/221545614_Sysadmins_and_the_need_for_verification_information), [저자 연구 목록](https://nicolefv.com/research)

**방법과 발견.** 사전 베타 데이터 복제 관리 GUI를 사용한 숙련 관리자 4명의 영상·음성을 분석했다. 각 20개 과업 중 미완료를 제외한 64개 과업이 분석 대상이었다. 복잡도와 추가 검증 정보 탐색 사이에는 유의한 관련이 있었으나, 위험도와의 관련성 및 검증 정보량 증가 가설은 지지되지 않았다. [저자 원문 방법과 결과](https://www.researchgate.net/publication/221545614_Sysadmins_and_the_need_for_verification_information)

**sshOS에 적용할 가설.** 전송 응답, 파일 해시 확인, 파일 교체 확인, 재시작 응답, 서비스 상태, HTTP 응답을 구분해서 보여 주면 사용자가 실제 결과를 더 정확히 판단할 수 있다.

**한계와 측정.** 4명·단일 제품의 탐색 연구다. 성공 메시지가 항상 불필요하다는 뜻도 아니다. 사용자가 실제 완료 여부를 정확히 답하는 비율, 다른 도구에서 다시 확인하는 횟수, 결과 불명 상태를 성공으로 오인하는 횟수를 측정한다. DOI 페이지 직접 열기는 실패했으며 저자 원문·저자 목록과 P04 참고문헌으로 서지를 교차 확인했다.

### P04 패치 관리는 별도의 운영 복잡성을 가진다

**Not as easy as just update: Survey of System Administrators and Patching Behaviours.** Adam Jenkins, Linsen Liu, Maria Wolters, Kami Vaniea. CHI 2024, 2024년 5월 11–16일, 17 pages. DOI `10.1145/3613904.3642456`. [연구실 원문](https://tulipslab.org/papers/jenkinsCHI2024.pdf)

**방법과 발견.** 패치 관리에 참여하는 관리자 220명의 자기보고 행동을 조사했다. 전용 시험 환경은 가정했던 만큼 보편적이지 않았으며, 일부 관리자는 소수 장비에서 시험하거나 단계적으로 배포했다. 문제가 생긴 패치에는 동료·외부 커뮤니티 등 여러 정보원을 활용했다. [저자 연구 페이지](https://vaniea.com/publication/jenkins2024chi/)

**sshOS에 적용할 가설.** 패키지 업데이트·신규 서버 구축·자동 복구까지 묶으면 각각의 준비·시험·실패 대응을 함께 책임져야 한다. 초기 버전은 이미 준비된 서비스의 제한된 변경으로 좁힌다.

**한계와 측정.** SSH GUI의 효과를 측정한 연구가 아니다. 제외 기능을 정하는 보조 근거다. 고객 인터뷰에서는 단일 파일 교체가 실제로 독립적인 과업인지, 패키지 설치·DB 변경·컨테이너 작업이 항상 함께 필요한지 확인한다.

### P05 호스트 확인을 자동 신뢰로 대체할 수 없다

**Oh SSH-it, what’s my fingerprint? A Large-Scale Analysis of SSH Host Key Fingerprint Verification Records in the DNS.** Sebastian Neef, Nils Wisiol. CANS 2022, LNCS 13641. DOI `10.1007/978-3-031-20974-1_4`. 공개 원고 최초 제출은 2022년 8월 18일, 개정은 2022년 11월 23일이다. [저자 공개 원문과 출판 정보](https://arxiv.org/abs/2208.08846)

**방법과 발견.** Tranco 100만 도메인과 인증서 투명성 로그의 5억 개 이상 이름을 26일간 측정했다. 조사 집단에서 SSHFP 레코드는 약 1만 도메인 중 1개였으며, 그중 절반 이상은 DNSSEC 없이 제공되었다. [원문 초록](https://arxiv.org/abs/2208.08846)

**sshOS에 적용할 가설.** 첫 접속, 신뢰 기록과 일치하는 재접속, 키 변경을 구분하고 사용자가 확인할 지문과 대상 정보를 보여 준다. 검증 자료가 없는 상황을 검증 완료로 표시하지 않는다.

**한계와 측정.** 도메인 측정이며 사용자 행동 실험이 아니다. 2026년 보급률로 인용하지 않는다. 신규 키·변경 키·주소 재사용·정상 재접속 시험에서 신뢰 상태와 실제 연결 대상이 일치하는지 검증한다.

### P06 복구 기능에는 복구 대상과 기록이 필요하다

**Undo for Operators: Building an Undoable E-mail Store.** Aaron B. Brown, David A. Patterson. USENIX ATC 2003, 2003년 6월. 공식 학회 서지에는 DOI가 기재되지 않았다. [USENIX 원문 페이지](https://www.usenix.org/conference/2003-usenix-annual-technical-conference/undo-operators-building-undoable-e-mail-store)

**방법과 발견.** 운영자 복구 프레임워크를 설계하고 SMTP·IMAP 이메일 저장소에 구현한 시스템 연구다. 사용자 상호작용 기록, 상태 되감기, 수정, 기록된 작업의 재실행 및 외부에 보인 결과의 정합성 처리를 결합했다. [학회 초록과 구현 설명](https://www.usenix.org/conference/2003-usenix-annual-technical-conference/undo-operators-building-undoable-e-mail-store)

**sshOS에 적용할 가설.** 전송 취소, 직전 파일 복원, 서비스 재시작은 서로 다른 동작이다. 복원 가능한 상태와 복원되지 않는 외부 효과를 먼저 명시해야 한다.

**한계와 측정.** 이메일 저장소의 공학적 사례이며 범용 SSH 복구 도구의 사용자 시험이 아니다. 각 변경 단계에서 연결·프로세스·저장 실패를 발생시키고, 파일과 기록의 실제 상태가 UI에 정확히 반영되는지 확인한다.

## 3 유사 도구의 구현 범위

### 3.1 기능과 배치 구조

| ID와 도구 | 공식적으로 확인한 기능과 배치 구조 | 라이선스와 배포 범위 | sshOS가 검증해야 할 차이 |
| --- | --- | --- | --- |
| O01 Electerm | Windows·macOS·Linux 로컬 터미널·SSH·SFTP 파일 관리자. 키·암호·에이전트 인증, 점프 호스트, 원격 편집을 제공한다. 전송 구현은 별도 SFTP 채널과 진행량 이벤트를 사용한다. [저장소](https://github.com/electerm/electerm), [전송 구현](https://github.com/electerm/electerm/blob/e25e213e472f54ad63642f257cf8456ba3116f5a/src/app/server/transfer.js) | MIT. [라이선스 원문](https://github.com/electerm/electerm/blob/master/LICENSE) | SSH·탐색·진행률의 결합은 이미 있다. 단일 작업의 적용·관찰·복원까지 사용자가 이해하는지 비교한다. |
| O02 Tabby | Windows·macOS·Linux 로컬 터미널. GUI 연결 관리, 탭·분할, 암호화 자격증명 컨테이너, SFTP, 점프 호스트·포워딩을 제공한다. [저장소](https://github.com/Eugeny/tabby) | MIT. [라이선스 원문](https://github.com/Eugeny/tabby/blob/master/LICENSE) | 콘솔 중심이어도 GUI 연결·파일 기능을 갖춘다. 조사한 README만으로 상시 전송 큐의 세부 UX까지 확인한 것은 아니다. |
| O03 XPipe | 기존 SSH·셸 도구를 사용하는 로컬 연결 허브. 원격 사전 설치 없이 파일 브라우저, 시스템 간 전송, 터미널·편집기 연계를 제공한다. [저장소](https://github.com/xpipe-io/xpipe), [파일 브라우저](https://docs.xpipe.io/guide/file-browser) | Windows·macOS·Linux. 공개 핵심은 Apache-2.0이며 open-core다. [라이선스 원문](https://github.com/xpipe-io/xpipe/blob/master/LICENSE.md) README는 일부 기능·shell handling 구현이 비공개임을 명시한다. [공개 범위](https://github.com/xpipe-io/xpipe) | 서버 설치가 필요 없는 GUI라는 주장만으로 차별화할 수 없다. 전체 제품을 완전한 공개 소스라고 분류하지 않는다. |
| O04 Cockpit | 브라우저에서 서비스·로그·자원·스토리지를 관리한다. cockpit-ws와 cockpit-bridge 구조이며 추가 호스트에는 SSH를 사용한다. 파일 관리는 별도 cockpit-files 프로젝트다. [기능](https://cockpit-project.org/guide/latest/features.html), [다중 호스트 구조](https://docs.cockpit-project.org/cockpit-guide/latest/guide/multi-host.html) | Linux 서버와 웹 브라우저. 공식 프로젝트는 GNU LGPL로 소개한다. 세부 파일의 라이선스는 실제 재사용 시 확인해야 한다. [공식 소개](https://cockpit-project.org/) | 범용 서버 GUI는 이미 이미 구현 사례가 있는 범주다. 배치·설치 조건의 차이와 좁은 작업의 품질을 비교한다. |
| O05 WinSCP | Windows 로컬 파일 클라이언트. Explorer·Commander UI, 하단 백그라운드 큐, 전체·개별 진행률, 속도·예상 시간, 오류·사용자 응답 요구 상태를 제공한다. [전송 큐](https://winscp.net/eng/docs/ui_queue) | 코드 GPL-3.0-or-later. 배포 이미지에는 별도 조건이 명시된다. [공식 라이선스](https://winscp.net/eng/docs/license) | 상시 비동기 전송 표시는 기본 품질 기준으로 본다. 시오스는 전송 뒤 적용 결과까지 연결하는 가치가 필요하다. |
| O06 Cyberduck | macOS·Windows 파일 클라이언트. SFTP, 전송 창, 중단·재개, 충돌 처리, Windows 작업 표시줄 진행 표시를 제공한다. 서버가 재개를 지원하지 않으면 처음부터 재전송할 수 있다. [전송 문서](https://docs.cyberduck.io/cyberduck/transfer/) | 공개 저장소는 GPLv3 표기다. only·or-later 세부 판단은 이 조사에서 확정하지 않는다. [라이선스 원문](https://github.com/iterate-ch/cyberduck/blob/master/LICENSE.txt) | 파일 전송과 재개는 선행 기능이다. 일부 서버의 재개 제약을 제품 전체의 결함으로 확대하지 않는다. |
| O07 Termix | 중앙 self-hosted 서버와 데스크톱 standalone local server를 모두 지원한다. SSH·파일 관리·metrics 등 플러그인, dock·탭 배치, 저장·복원 Workspaces, operations 기능이 있다. [저장소](https://github.com/Termix-SSH/Termix), [설치 모델](https://docs.termix.site/install/) | 데스크톱 Windows·macOS·Linux 및 웹·모바일. 코어 Apache-2.0이며 플러그인은 개별 확인 대상이다. [라이선스 원문](https://github.com/Termix-SSH/Termix/blob/main/LICENSE) | 초기 구상과 가장 직접적으로 겹친다. 중앙 서버가 반드시 필요하다고 설명하면 부정확하다. OS형 작업 공간 역시 단독 차별점이 아니다. |
| O08 Capistrano | 로컬 Ruby·Rake CLI에서 SSH 배포를 실행한다. releases·shared·current 링크 구조와 이전 릴리스 복귀를 제공한다. [구조](https://capistranorb.com/documentation/getting-started/structure/), [복귀](https://capistranorb.com/documentation/getting-started/rollbacks/) | MIT. 특정 데스크톱 GUI OS 지원 제품으로 분류하지 않는다. [라이선스 원문](https://github.com/capistrano/capistrano/blob/master/LICENSE.txt) | 배포·복귀 절차 자체도 선행 구현이 있다. 제한된 사용자가 스크립트 유지 없이 결과를 이해하고 수행하는 가치가 검증 대상이다. |

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
| E02 | Electerm #2928은 2023-08-16 생성, 조사일 현재 closed다. 파일·폴더 혼합 업로드에서 일부 항목이 빠진다는 제보다. 현재 버전에 남아 있다는 주장은 하지 않는다. [이슈](https://github.com/electerm/electerm/issues/2928) | 여러 항목의 전송은 성공·실패·건너뜀을 분리한다. v3 핵심 파일 적용은 단일 파일로 제한하고 검증 이전 교체를 막는다. |
| E03 | Electerm #4719는 2026-11-11 생성, 조사일 현재 open인 Windows 원격 파일의 Explorer 방향 드래그 기능 요청이다. 반대 방향 업로드와의 차이를 설명한다. [이슈](https://github.com/electerm/electerm/issues/4719) | OS와 비슷한 시각 표현이 모든 OS 제스처 지원을 뜻하지 않게 한다. 외부 드래그 지원에는 로컬 준비 시간·취소·임시파일 수명 정의가 필요하다. |
| E04 | Termix 파일 관리자 1.1.3 변경 기록은 SFTP 단계 timeout·연결 사전 확인·오류 표시로 전송·삭제의 멈춤과 패널 정지를 수정했다고 명시한다. 1.1.2는 SFTP 부재·sudo·비영문 파일명을 다룬다. 해당 문서의 버전 게시일은 확인되지 않았다. [공식 변경 기록](https://docs.termix.site/plugins/file-manager/changelog/) | 무기한 진행 표시를 허용하지 않는다. 연결 손실·권한 부족·SFTP 미지원·응답 시간 초과를 구분한다. SFTP 미지원 시 임의 SCP·셸 방식으로 우회하지 않는 범위 선택이 가능하다. |
| E05 | Cockpit 322의 2024-08-08 발표는 여러 호스트 코드를 같은 브라우저 문맥에서 실행할 때의 신뢰 문제와 host switcher 폐기 방향을 설명한다. [공식 발표](https://cockpit-project.org/blog/cockpit-322.html) | 서버별 작업 정체성을 고정하고 파일명·로그·명령 출력은 실행 불가능한 데이터로 렌더링한다. 이 사례로 Cockpit 전체의 안전성을 일반화하지 않는다. |

## 5 파일 교체와 관찰이 보장할 수 있는 범위

| ID | 공식 기술 근거 | v3 전략에 필요한 경계 |
| --- | --- | --- |
| T01 | WinSCP는 임시 이름으로 전송한 뒤 이름을 바꾸는 방식, 원본 owner·group 등 속성 소실, 대상 파일 덮어쓰기 권한과 디렉터리 내 신규 파일 생성 권한의 차이를 명시한다. 문서 수정일은 2026-06-03이다. [공식 전송 문서](https://winscp.net/eng/docs/resume) | 임시 파일 교체를 모든 파일에 안전한 기본값이라고 표현하지 않는다. 전용 슬롯과 지원하는 메타데이터 조건을 먼저 검사한다. |
| T02 | Capistrano는 롤백이 앱·플러그인별 검증 대상이며 DB migration을 자동 복원하지 않는다고 명시한다. current 링크 전환 이후의 실패는 불일치 상태를 남길 수 있다. [공식 롤백 문서](https://capistranorb.com/documentation/getting-started/rollbacks/) | 직전 파일 복원은 DB·쓰기 데이터·외부 요청의 복원이 아니다. 사용자에게 파일 복원과 재시작·응답 회복 결과를 각각 보여 준다. |
| T03 | Python 3.12의 os.replace는 다른 파일시스템 사이에서 실패할 수 있고, 성공한 rename은 원자적 동작이라고 명시한다. [Python 3.12 os.replace](https://docs.python.org/3.12/library/os.html#os.replace) | 준비 파일·대상 파일·복원 파일은 같은 파일시스템에 둔다. 파일 이름 전환의 원자성과 여러 단계의 원자성·동시 수정 보호·정전 후 내구성을 구별한다. |
| T04 | Python 3.12 shutil 문서는 copy·copy2도 모든 메타데이터를 복사하지 못하며 POSIX owner·group·ACL의 보존 한계를 명시한다. [Python 3.12 shutil](https://docs.python.org/3.12/library/shutil.html) | 일반 복사 함수 사용만으로 원본 속성을 보존했다고 판정하지 않는다. 초기 슬롯에서 허용할 UID·GID·mode를 고정하고, 지원하지 않는 ACL·xattr·특수 파일은 제외한다. |
| T05 | Ubuntu Noble systemctl 문서는 active를 unit의 활성 상태로 정의하고 서비스별 세부 상태를 별도로 다룬다. [Ubuntu 24.04 systemctl](https://manpages.ubuntu.com/manpages/noble/man1/systemctl.1.html) | active 관찰은 앱의 새 버전·기능 정확성을 증명하지 않는다. 관찰한 unit·상태·시간을 표시한다. |
| T06 | RFC 9110 §15.3.1은 HTTP 200을 해당 요청의 성공으로 정의한다. RFC 발행일은 2022년 6월이다. [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.1) | HTTP 응답은 그 시점의 그 요청 결과다. 지정 endpoint가 기대 버전을 확인하는 계약을 갖지 않으면 새 파일이 실제 기능을 수행한다는 보장으로 확대하지 않는다. |
| T07 | OpenSSH의 posix-rename 확장은 POSIX rename, fsync 확장은 열린 파일의 fsync를 별도로 정의한다. [OpenSSH PROTOCOL](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL) | SFTP ACK 진행률을 디스크 영속 저장률로 표현하지 않는다. rename 완료만으로 전체 작업의 영속 기록까지 완료되었다고 판정하지 않는다. |
| T08 | Linux flock은 협조적 잠금이며 이를 따르지 않는 프로세스의 파일 접근을 막지 않는다. [Linux flock 설명](https://man7.org/linux/man-pages/man2/flock.2.html) | 외부 writer가 없는 전용 슬롯을 지원 전제로 둔다. 사전 검사로 미래의 외부 쓰기 부재를 입증했다고 주장하지 않는다. |

이 근거에 따른 UI 결과는 `업로드 검증됨`, `파일 교체 확인됨`, `재시작 요청 결과`, `서비스 상태 관찰`, `HTTP 응답 관찰`, `결과 확인 필요`처럼 실제 확보한 증거에 연결한다. SHA-256 일치는 전송 내용의 동일성에 관한 증거이며 파일이 안전하거나 업무 기능이 정확하다는 증거가 아니다. 서비스 실행 식별자인 InvocationID의 변화 역시 관찰 근거이며 새 버전의 기능 정확성을 증명하지 않는다. 최종 문구는 `파일 교체·재시작·응답 확인 완료`처럼 확인한 범위를 표시한다. 연결이 끊겼다는 사실만으로 원격 변경이 실행되지 않았다고 판정해서는 안 된다.

## 6 조사에 따른 제품 집중 전략안

### 6.1 맡을 역할과 첫 사용자

제안하는 첫 사용자는 이미 준비된 Ubuntu Server 24.04 LTS HTTP 서비스의 운영 책임자다. 이 사용자는 SSH 접근 권한과 대상 파일·systemd unit의 의미를 알고 있으나 파일 전송, 재시작, 로그 확인, 파일 복원을 위해 여러 화면과 명령을 오가는 비용을 줄이고 싶어 한다. Linux 지식이 전혀 없는 사용자가 운영 결정을 자동으로 위임하는 제품으로 정의하지 않는다.

역할 문장은 다음과 같다.

> sshOS(시오스)는 준비된 Linux HTTP 서비스에 단일 파일을 적용하고 관찰 결과를 확인하며, 필요할 때 직전 파일을 복원하는 과정을 하나의 지속적인 작업 공간에서 수행하는 오픈소스 데스크톱 도구다. 초기 지원 서버 OS는 Ubuntu Server 24.04 LTS다.

이 역할 안에서도 비밀번호·SSH 키 인증, 비동기 SFTP 업로드·다운로드, 상시 진행률은 기본 기능이다. OS 같은 느낌은 홈·파일·작업·결과가 일관된 서버 문맥을 공유하고 작업 중 화면을 바꾸어도 진행 상황을 잃지 않는 경험으로 구현한다. 초기 앱은 홈·연결·파일·작업·설정의 5개로 제한하는 안을 사용한다. 자유롭게 겹치는 내부 창, 일반 시스템 모니터링, 프로세스 강제 종료는 이 전략의 초기 범위에서 제외한다.

### 6.2 적합 조건과 지원에서 제외할 사례

다음 조건은 v3 전략안의 의도적인 범위 제한이다. 기술 검사로 확인할 조건과 운영자가 유지할 전제를 구별한다. 구체적 경로·파일 크기·시간 제한·권한 값은 제품·개발 명세가 확정한다.

| 적합 조건 | 채택 이유와 포기하는 범위 |
| --- | --- |
| 기존 OpenSSH·SFTP와 systemd HTTP 서비스가 동작한다. | 신규 서버 구축, 서비스 최초 설치, 방화벽·패키지·DB 설정을 제외한다. |
| 변경 산출물은 빌드가 끝난 단일 일반 파일이다. | 디렉터리 전체 배포, 서버 빌드, 의존성 설치, 압축 해제, 다중 파일의 원자적 배포를 제외한다. |
| 서비스는 등록된 대상 파일과 unit의 관계를 운영자가 확인했다. | 파일을 분석하여 적합한 서비스를 자동 추론하지 않는다. |
| 전용 파일 슬롯과 준비·복원 위치는 같은 로컬 파일시스템에 있다. | 임의 기존 경로, 네트워크 파일시스템, 교차 파일시스템 교체를 지원 전제로 삼지 않는다. |
| 슬롯의 UID·GID·mode를 제한하고 symlink·hardlink·특수 파일·추가 ACL·xattr 등 명세가 보존하지 않는 속성을 차단한다. | 모든 Unix 파일의 원래 메타데이터를 보존하는 범용 파일 교체를 포기한다. |
| 슬롯에는 sshOS 이외의 배포 도구와 서비스가 쓰지 않는다. | 외부 동시 변경을 무손실로 합치는 기능을 제외한다. 이 조건은 운영 전제이며 사전 검사만으로 보장되지 않는다. |
| 서버에는 Python 3.12와 필요한 표준 라이브러리가 이미 있다. | 별도 패키지 자동 설치나 상주 에이전트를 추가하지 않는다. 필요한 런타임이 없으면 적용 기능을 차단한다. |
| 등록된 unit 재시작·로그 관찰에 필요한 기존 권한이 있다. | 앱이 sudo 정책·계정 권한을 자동 확대하지 않는다. |
| 파일 적용이 DB schema, 공유 데이터, 외부 API의 되돌릴 수 없는 변경을 요구하지 않는다. | 파일 복원만으로 복구되지 않는 배포를 공식 적합 사례에서 제외한다. |
| HTTP 관찰 주소와 기대 응답 조건이 명확하다. | 응답 관찰을 업무 기능의 완전한 시험으로 표현하지 않는다. |

`상주 에이전트 없음`은 서버 측 실행이 전혀 없다는 뜻이 아니다. 이 전략은 기존 Python 3.12에서 한 번 실행하고 종료하는 helper로 작업 기록·잠금·fsync를 처리하며 준비 파일·복원 파일·작업 기록을 남기는 안을 사용한다. 별도 daemon 설치는 하지 않아도 상태 파일은 남는다. 무엇을 실행하고 어디에 무엇을 저장하는지는 구현 명세와 실제 동작이 일치해야 한다.

### 6.3 핵심 작업과 차별화 가설

핵심 작업은 `연결과 호스트 확인 → 단일 파일 선택 → 비동기 업로드와 내용 검증 → 사용자의 적용 선택 → 기존 파일 보존과 파일 교체 → 등록 unit 재시작 → 파일·서비스·HTTP 결과 관찰 → 필요한 경우 직전 파일 복원`이다. 전송 완료가 적용 동의가 되지 않으며, 적용 동의가 업무 기능 검증의 성공을 뜻하지 않는다.

| 지키려는 가치 | 감수할 비용과 제한 | 가설이 실패한 것으로 볼 증거 |
| --- | --- | --- |
| 한 작업의 대상·전송·변경·관찰·복원 근거가 함께 남는다. | 일반 SFTP보다 상태 기록과 단절 복구 구현이 복잡하다. | 사용자가 결과를 기존 도구와 비슷하게 혼동하거나 작업 기록을 읽지 않는다. |
| 지원 조건 안에서는 실패·불명·완료를 구별한다. | 사전 적합 검사가 엄격하여 많은 임의 서버를 지원하지 못한다. | 적합 고객도 슬롯·권한 준비 비용 때문에 도입을 포기한다. |
| 파일 적용과 직전 파일 복원을 명시적으로 다룬다. | 범용 배포·자동 롤백·DB 복구·여러 서버 동시 적용을 제공하지 않는다. | 실제 과업의 대부분이 다중 파일·DB 변경·컨테이너로 이어진다. |
| 일관된 OS형 작업 공간을 제공한다. | 데스크톱 두 OS의 배포·서명·접근성을 관리해야 한다. | 같은 작업을 Termix·XPipe·기존 파일 도구에서 더 쉽게 끝내고 재사용하지 않는다. |

검증할 선택 이유는 ‘GUI여서’ 또는 ‘서버 설치가 없어서’에 그치지 않는다. **좁게 정한 파일 적용 작업에서 무엇이 바뀌었고 무엇을 확인했으며 무엇을 아직 모르는지 사용자가 더 정확히 이해하는가**가 중심이다. 기존 도구가 같은 가치를 충분히 제공하면 독립 제품의 범위를 다시 판단한다.

### 6.4 초기 버전에서 확대하지 않을 범위

범용 Linux 제어판, 모든 명령의 GUI화, 다른 배포판, 서버 최초 구축, 패키지·방화벽·사용자 관리, DB migration, Docker·Kubernetes 관리, 다중 서버 동시 배포, 자유로운 실행 hook, 임의 스크립트 편집, 자동 장애 원인 추론, AI 명령 실행, 팀용 중앙 권한 서버, 플러그인 생태계를 초기 전략의 확장 경로로 사용하지 않는다.

이 제외 목록은 사용자 수를 최대화하는 선택이 아니다. 한 작업에서 확보할 관찰 증거와 복구 범위를 끝까지 검증하기 위한 선택이다. 기능 추가 요청은 핵심 과업의 수행에 필요한지와 기존 적합 조건을 깨는지를 먼저 판단한다.

## 7 수요와 사용성을 검증하는 계획

검증의 모집 대상·인원·기간·과업·합격 단위·통과 수치는 [제품 계획서 §9](01-product-plan.md#9-선택할-이유를-검증하는-단계)가 유일한 규범이다. 이 보고서는 별도의 숫자나 출시 조건을 정의하지 않는다. 해당 기준은 논문에서 도출된 통계 기준이 아니라 이번 제품의 진행 결정을 위한 설계값이다. 인터뷰·비교 시험·pilot은 아직 수행하지 않았다.

- **G0:** 최근 실제 파일 교체 사례를 조사한다. 단일 파일 여부만 보지 않고 제품 계획서 §5의 전체 지원 조건과 준비 담당자의 설정 수용 여부를 확인한다. 가상의 사용 의향이나 불편하다는 일반 응답만으로 통과시키지 않는다.
- **G1:** disposable Ubuntu 서버에서 교체·단절·재부팅·복원 경계를 검증한다. 실제 파일, journal, 명령 호출 횟수를 대조한다. 기술 시험으로 수요를 증명하지 않는다.
- **G2:** 동일 참가자가 기존 도구 조합과 sshOS를 모두 사용하며 순서를 균등하게 나눈다. 동등한 준비 상태와 과업을 사용한다. 참가자가 평소 사용하는 스크립트·북마크를 제거하지 않는다. 대상·파일·재시작 요청·현재 응답·남은 불확실성을 구별하는 능력이 핵심 지표다. 시간·설정 비용·창 전환·도움 요청도 함께 보고하며 더 느려진 경우 숨기지 않는다. Termix는 직접 겹치는 경쟁 도구이므로 별도 기능·준비 비용 비교에서 빠뜨리지 않는다.
- **G3:** 서명된 빌드로 반복 사용을 관찰한다. 적합 작업 기회와 실제 선택 횟수를 함께 기록한다. 기회가 부족하면 통과·실패 대신 관찰 부족이며, 미지원 과업과 기존 도구로 돌아간 이유도 보고한다.

정답은 실험 전에 fixture의 실제 상태와 기록으로 고정한다. 실험 후 결과에 맞춰 통과 기준을 낮추지 않는다. 기준을 바꾸면 새 명세와 변경 이유를 기록하고 영향을 받는 시험을 다시 수행한다. 소표본에서 오류가 없다는 결과를 실환경 오류율 0으로 일반화하지 않는다. 통과는 다음 단계 진행 판단이며 대규모 채택이나 장기 유지율의 입증이 아니다.

## 8 계획서와 명세에 연결할 판단

| 근거 | 계획서에 반영할 결정 | 검증할 내용 |
| --- | --- | --- |
| P01, P03 | 서버·파일·unit·전송·관찰·복원을 하나의 작업 정체성에 연결한다. | 화면 전환·재연결 뒤 대상과 결과가 혼동되지 않는다. |
| P02, O01–O07 | GUI·SFTP·OS형 공간 자체를 독창성 주장으로 사용하지 않는다. | 기존 도구 대비 완료와 결과 이해의 차이를 측정한다. |
| P04, O08, T02 | 준비된 단일 서비스·단일 파일 범위로 제한한다. | 실제 고객 과업이 이 범위 안에서 독립적으로 끝난다. |
| P05 | 신규 호스트·신뢰 일치·키 변경을 구분한다. | 자동 신뢰나 키 변경의 무시 없이 접속 상태가 정확하다. |
| P06, T01–T04, T07–T08 | 파일 교체·메타데이터·잠금·복원·내구성의 보장 범위를 분리한다. | 각 단계 실패에서 실제 파일과 기록을 대조할 수 있다. |
| T05–T06 | 서비스 활성 상태와 HTTP 응답을 관찰 결과로 표시한다. | 새 버전의 기능 정확성을 확인했다고 과장하지 않는다. |
| E01–E05 | 전송·제어 연결·timeout·서버 정체성·렌더링의 예외를 명시한다. | 진행이 영구 정지하거나 다른 서버 문맥으로 섞이지 않는다. |

현재 근거로는 사용자가 sshOS를 반드시 선택할 수밖에 없다거나 장기 수요가 입증되었다고 말할 수 없다. 선택 이유는 제한된 과업의 실제 성공, 결과 이해, 반복 사용으로 확인한다. 범위 축소는 그 검증을 가능하게 하기 위한 전략안이다.
