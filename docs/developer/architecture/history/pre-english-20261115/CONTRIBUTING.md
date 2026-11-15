# sshOS 기여 방법

sshOS(시오스)는 SSH만 연결하면 사용하는 클라이언트 데스크톱 도구다. 원격 에이전트, 데이터베이스, X11, 원격 GUI, AI·검색·자동 업데이트를 추가하지 않는다. 승인된 기능과 수용 기준은 [제품 계획](docs/01-product-plan.md), [개발 계획](docs/02-development-plan.md), [상호작용 명세](docs/09-desktop-interaction-spec.md), [검사 목록](docs/06-quality-security-checklist.md)이 정본이다.

## 개발 환경

Node24.22.3을 사용한다. 저장소 최상위에서 다음 명령을 실행한다. 설치 스크립트는 의존성·Electron·빌드 캐시와 개발 실행 데이터를 저장소의 `.local/` 아래로 지정한다. 배포 앱 사용자는 Node나 Python을 설치할 필요가 없다.

```sh
node scripts/install.mjs
npm run typecheck
npm run test:unit
npm run build
npm start
```

개발 실행은 `scripts/launch.mjs`를 사용한다. 기본 Electron 실행으로 사용자 홈에 개발 데이터를 만들지 않는다. 로컬 데이터·개인키·인증정보·작업 본문·캐시·빌드 산출물을 커밋하지 않는다.

## 변경과 검증

버그 수정에는 재현 조건과 관찰된 결과를 적고, 수정한 실패 경로를 검사한다. 공개 IPC를 추가하면 송신자·스키마·용량·수명·서버 generation 검증을 함께 구현한다. 원격 변경 전의 기록 ACK와 결과 불명 상태를 유지하며, 실패한 명령·전송·터미널 입력을 자동 재전송하지 않는다.

```sh
npm run test:integration
npm run test:security
npm run test:coverage
npm run test:performance
python3 -B docs/validate-plan.py --root .
```

통합 검사는 로컬의 격리된 SSH fixture를 사용한다. 사용자 서버를 기본 시험 대상으로 사용하지 않는다. `test:coverage`의 파일별 문장90%·분기85% 기준을 낮추거나 실패 파일을 제외해 통과시키지 않는다. `test:performance`는 실제 로컬 측정 후 지원 환경 수용 시험의 공백을 보고하며, 그 공백이 있으면 종료 코드2를 반환한다. 이 종료 코드를 합격으로 바꾸지 않는다.

## Pull request

문제와 수정 후 동작, 실행한 검사와 남은 검증을 적는다. 구현 컨텍스트와 분리된 검토를 받는다. 저장소 유지관리자는 사람 계정의 commit·push·PR, 현재 head에 대한 GitHub App formal approval, 사람 계정의 merge 절차를 사용한다. 보호 규칙을 우회하지 않으며 merge 후 확인된 head branch의 원격·추적·로컬 ref를 모두 정리한다.

기능 범위·지원 OS·보안 계약·수용 기준을 바꾸는 제안은 승인된 명세를 몰래 수정하지 않는다. 변경할 요구사항과 영향받는 검사 항목을 먼저 제시한다. 기여 코드는 [AGPL-3.0-only](LICENSE)로 제공하고 다른 출처의 코드·에셋은 출처와 사용 조건을 함께 제출한다.
