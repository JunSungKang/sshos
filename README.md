# sshOS(시오스)

기존 SSH로 Linux 서버에 연결하여 **데스크톱 형태 작업 공간에서 파일을 탐색·열기·전송하고 원격 프로그램을 실행하는 Electron 클라이언트**를 개발하는 저장소다. 현행 명세는 **v6**이며 통합 수명·보안·배포 검증을 진행 중이다. 실제 진행과 미검증 항목은 [구현 상태](docs/implementation-status.json)를 따른다.

바탕화면·겹치는 내부 창·작업 표시줄, 텍스트/이미지 뷰어, 실행 출력, SSH PTY 터미널을 포함한다. 서버의 그래픽 화면을 가져오지 않는다. 초기 서버 지원은 Ubuntu Server 24.04 LTS이며 Windows portable .exe와 macOS .app을 목표로 한다. 시오스 전용 서버 설치·앱 기능용 DB·AI·온라인 오류 검색·외부 변경 자동동기화는 없다.

- [제품 계획서](docs/01-product-plan.md)
- [개발 계획서](docs/02-development-plan.md)
- [데스크톱·창 동작 명세](docs/09-desktop-interaction-spec.md)
- [기능·품질·보안 체크리스트](docs/06-quality-security-checklist.md)
- [GPT-6.1-sol High 구현 인계서](docs/07-implementation-handoff.md)
- [요구사항 추적표](docs/08-requirement-traceability.md)
- [현재 구현·검증 연결](docs/development/implementation-traceability.md) · [지원 환경 시험 절차](docs/development/native-validation.md)
- [기계 명세](docs/spec-v6.json) · [의존성 기준](docs/dependency-baseline-v6.json)
- [아키텍처](docs/04-system-architecture.md) · [관련 연구·오픈소스](docs/03-research-and-positioning.md) · [Electron 선택](docs/05-framework-comparison.md)
- [대화 결정과 설계 출처](docs/10-session-decisions.md) · [전수 점검과 개정 내역](docs/11-document-audit.md)
- [시안/GIF의 상태](design/README.md) · [문서 검사 결과](docs/planning-validation.json)

프로젝트 라이선스는 AGPL-3.0-only, 의존성은 MIT 우선·호환 OSS 검토다. 단순 사용이나 독립 프로그램 실행만으로 모든 관련코드의 공개를 강제할 수 있다는 뜻은 아니다. 기여 방법은 [CONTRIBUTING](CONTRIBUTING.md), 취약점 제보와 보안 범위는 [SECURITY](SECURITY.md)를 따른다.

문서 구조와 링크·요구 추적은 다음 명령으로 검사한다. 제품 테스트를 실행하는 명령은 아니다.

```sh
python3 -B docs/validate-plan.py --root "$PWD"
```

이전 문서와 시안은 [보존 이력](docs/history/v5-before-desktop-20261115/archive-manifest.json)에 남아 있으며 현행 구현 지침으로 사용하지 않는다. v6의 복합 제품 수용 검사는 모두 untested다. 별도로 수행한 로컬 기반 검사의 결과는 구현 상태에 기록한다.

개발 환경은 Node 24.22.3이다. 저장소 루트에서 다음 순서로 실행한다. 설치 스크립트는 npm/Electron 캐시를 프로젝트의 `.local/`에 저장한다. `npm start`는 빌드된 앱을 실행한다.

```sh
node scripts/install.mjs
npm run typecheck
npm run test:unit
npm run test:coverage
npm run build
npm start
```

현재 개발 빌드는 프로필·호스트 지문 확인·SSH 계정/개인키 인증, 내부 창, SFTP 탐색/단일 파일 변경/비동기 전송, 읽기 전용 텍스트·이미지 보기, 명시적 프로그램 실행과 출력, PTY 터미널을 제공한다. 연결 상태와 SSH 명령 완료 응답 시간을 표시하며 저장 지문·인증정보 삭제와 개인정보를 제외한 진단 미리보기/내보내기를 지원한다.

로컬 자동 검사는 실제 Electron과 loopback SSH fixture를 사용한다. `npm run test:integration`은 준비된 검사들을 실행하고 `.local/verification/`에 결과와 소스 hash를 남긴다. 지원 대상 Windows11/macOS14와 실제 Ubuntu/OpenSSH 조합, 서명·공증 검사는 사용자 시험 항목이며 통과했다고 표시하지 않는다. 현재 macOS26 arm64 개발 실행 결과는 지원 OS 판정을 대신하지 않는다. 배포 서명 계정이 준비되지 않았으므로 공개 배포 준비 상태는 false다.

깨끗한 소스 커밋에서 `npm run package:win` 또는 macOS 호스트의 `npm run package:mac`을 실행하면 `.local/packages/`에 개발용 산출물·SHA256SUMS·빌드 보고서·대응 소스 archive를 만든다. Windows는 unsigned, macOS는 ad-hoc 서명이며 배포자 서명·공증을 의미하지 않는다. `npm run test:performance`는 로컬 부분 측정 후 target 검증 미완료를 나타내는 종료 코드2를 반환한다.
