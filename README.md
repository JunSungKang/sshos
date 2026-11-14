# sshOS(시오스)

기존 SSH로 Linux 서버에 연결하여 **데스크톱 형태 작업 공간에서 파일을 탐색·열기·전송하고 원격 프로그램을 실행하는 Electron 클라이언트**의 계획 문서다. 현행 명세는 **v6**이며 **D01 실행 기반을 개발 중**이다. 실제 진행과 미검증 항목은 [구현 상태](docs/implementation-status.json)를 따른다.

바탕화면·겹치는 내부 창·작업 표시줄, 텍스트/이미지 뷰어, 실행 출력, SSH PTY 터미널을 포함한다. 서버의 그래픽 화면을 가져오지 않는다. 초기 서버 지원은 Ubuntu Server 24.04 LTS이며 Windows portable .exe와 macOS .app을 목표로 한다. 시오스 전용 서버 설치·앱 기능용 DB·AI·온라인 오류 검색·외부 변경 자동동기화는 없다.

- [제품 계획서](docs/01-product-plan.md)
- [개발 계획서](docs/02-development-plan.md)
- [데스크톱·창 동작 명세](docs/09-desktop-interaction-spec.md)
- [기능·품질·보안 체크리스트](docs/06-quality-security-checklist.md)
- [GPT-6.1-sol High 구현 인계서](docs/07-implementation-handoff.md)
- [요구사항 추적표](docs/08-requirement-traceability.md)
- [기계 명세](docs/spec-v6.json) · [의존성 기준](docs/dependency-baseline-v6.json)
- [아키텍처](docs/04-system-architecture.md) · [관련 연구·오픈소스](docs/03-research-and-positioning.md) · [Electron 선택](docs/05-framework-comparison.md)
- [대화 결정과 설계 출처](docs/10-session-decisions.md) · [전수 점검과 개정 내역](docs/11-document-audit.md)
- [시안/GIF의 상태](design/README.md) · [문서 검사 결과](docs/planning-validation.json)

프로젝트 라이선스 계획은 AGPL-3.0-only, 의존성은 MIT 우선·호환 OSS 검토다. 단순 사용이나 독립 프로그램 실행만으로 모든 관련코드의 공개를 강제할 수 있다는 뜻은 아니다.

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
npm run build
npm start
```

현재 빌드는 실행·권한 격리 기반을 확인하는 단계다. SSH 연결·파일 작업·원격 실행은 아직 구현하지 않았다. Windows·macOS x64·실제 Ubuntu 검증과 서명/배포 검사는 남아 있다.
