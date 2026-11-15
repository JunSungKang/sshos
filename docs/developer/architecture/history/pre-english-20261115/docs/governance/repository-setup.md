# GitHub 연결 및 최초 문서 등록 준비

2026-11-15. origin: git@github.com:JunSungKang/sshos.git. 기존 main의 root commit 609936e07db67734d204169801c251e8839ae4a4는 보존한다. 로컬에는 과거 Git commit이 없었다. docs/history의 문서 판본은 원본 파일로 등록하며 과거 시각으로 commit을 조작하지 않는다.

실제 커밋 순서: (1) 저장소 검토 정책/CI, (2) 보존된 과거 계획과 시안, (3) 현행 v6 계획과 시안. 모두 현재 수행한 등록 작업으로 기록한다. 이후 제품 개발은 실제 구현 단위별 커밋을 추가하며 merge commit 방식으로 이력을 유지한다.

주체는 JunSungKang(author/assignee/push), junsung-bot[bot](current-head formal review)다. GitHub App의 현재 저장소 접근과 사람 ADMIN 권한은 읽기 전용 검사로 확인했다. 새로운 제품 commit을 만들기 전에 기존 파일을 보존하고 feature branch만 push한다.

현재 main에는 보호·ruleset이 없다. 적용 제안: 승인1개, stale review 폐기, 마지막 push 승인, 관리자 포함, force push/branch 삭제 금지, 대화 해결 필수, GitHub Actions 제공자의 planning-docs 필수. merge 방식은 merge commit이며 linear-history 강제는 끈다. 이는 기존 개발 commit을 보존하기 위한 선택이다. 일반 merge wrapper는 App current-head APPROVED를 별도로 강제한다. 베이스 소유 governance-review 워크플로는 최초 정책 PR 병합 후 활성화된다.

사용자는 2026-11-15 “준비한 보호 설정 적용 승인”으로 administrator provisioning을 승인했다. 전용 wrapper 활성화와 서버 재조회가 성공했다. dry-run은 변경 없이 위 설정과 실제 계정을 표시한다. 이번 문서는 승인 기록을 대신하지 않는다. 제품 개발 지시와 v6 scope는 후속 실제 개발 계약에서 연결한다.
