# sshOS(시오스)

기존 SSH/SFTP로 Linux 서버의 파일을 다루는 Electron 데스크톱 GUI의 계획 저장소다. 현재 판본은 v5이며 제품 코드는 아직 없다. 최초 서버 지원은 Ubuntu Server 24.04 LTS다. 클라이언트는 Windows portable `.exe`와 macOS `.app`를 목표로 한다.

- [제품 계획서](docs/01-product-plan.md)
- [개발 계획서](docs/02-development-plan.md)
- [기능·품질·보안 체크리스트](docs/06-quality-security-checklist.md)
- [GPT-6.1-sol High 구현 인계서](docs/07-implementation-handoff.md)
- [요구사항 추적표](docs/08-requirement-traceability.md)
- [기계 명세](docs/spec-v5.json) · [의존성 기준](docs/dependency-baseline-v5.json)
- [시스템 아키텍처](docs/04-system-architecture.md) · [구조 이미지](design/sshOS-v5-architecture.png)
- [자료조사](docs/03-research-and-positioning.md) · [Electron 선택 기록](docs/05-framework-comparison.md)

앱 기능용 DB, 원격 agent·helper, 온라인 오류 검색, AI 요약은 이번 범위에 없다. 이전 판본은 docs/history에 보존하며 현행 구현 지침으로 사용하지 않는다. 제품 검증 결과는 아직 없고 문서 검증만 planning-validation.json에 기록한다. 프로젝트 라이선스 계획은 AGPL-3.0-only이며 의존성은 MIT를 우선하는 호환 OSS 정책을 따른다.
