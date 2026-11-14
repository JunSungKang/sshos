# sshOS(시오스) v5 구현 인계서

대상 실행자: GPT-6.1-sol High. 목적: 이미 정한 첫 버전 요구를 임의 확장·약화하지 않고 구현·검증한다. 현재 파일은 개발 실행 지침이며 제품 구현이 시작됐다는 기록이 아니다.

## 1. 읽기 순서

1. 사용자의 최신 지시와 작업 루트의 AGENTS 지침을 읽는다.
2. [제품 계획](01-product-plan.md)에서 사용자 가치·지원·제외 범위를 읽는다.
3. [개발 계획](02-development-plan.md) 전체를 읽고 상태·파일 확정·취소·보안·배포 계약을 확인한다.
4. [검수 체크리스트](06-quality-security-checklist.md)와 [기계 명세](spec-v5.json)와 [요구사항 추적표](08-requirement-traceability.md)의 요구·작업·검사 연결을 읽는다.
5. [정확한 의존성 기준](dependency-baseline-v5.json), [구조](04-system-architecture.md)를 읽는다.
6. 근거가 필요할 때만 [연구](03-research-and-positioning.md), [Electron 결정](05-framework-comparison.md)을 읽는다. docs/history의 이전 요구를 현행 요구에 합치지 않는다.

## 2. 구현 시작 지시를 받은 뒤의 행동

사용자가 실제 구현을 지시한 경우에만 아래를 실행한다. 계획을 검토하거나 문구를 수정하라는 지시는 구현 착수가 아니다. 프레임워크 Electron 선택은 확정됐으며 다시 Tauri 선택을 묻지 않는다.

- 현재 v5 scope digest와 실제 구현 착수 메시지를 연결하여 승인 상태를 기록한다. 가상의 승인 메시지를 만들지 않는다.
- 현재 파일과 Git 상태를 읽어 기존 사용자 변경을 보존한다. 새 worktree·외부 temp를 만들지 않는다.
- 적용 스킬을 읽고 개발 계획 D01부터 진행한다. API 사용 가능성·서명·실제 SSH/SFTP 전제를 먼저 확인한다.
- 각 단계의 taskId/R ID/C ID를 작업 기록에 적는다. 검사가 통과한 단계만 다음 의존 단계로 진행한다.
- 선행 조건이 없으면 정확한 자원이나 실패 API를 보고하고 해당 작업을 보류한다. 독립적인 승인 범위의 작업을 계속한다.
- 완료 보고에는 구현한 동작, 실행한 검사와 미실행 검사, 생성한 배포물, 미해결 결함을 분리한다.

## 3. 변경할 수 없는 계약

| 대상 | 실행 규칙 |
| --- | --- |
| 기술 | Electron + React/TypeScript + ssh2 + utilityProcess. 고정 버전과 lockfile 사용 |
| 데이터 | 기능 저장소는 JSON + OS 암호화. DB·ORM 추가 금지 |
| 서버 | 기존 SSH/SFTP만 전제. 원격 helper·agent·Python 설치 금지 |
| 기능 | 제품§2의 제외 기능을 코드·화면·stub·설정·dependency로 추가하지 않음 |
| 검색과 AI | 온라인 오류 검색, 숨은 브라우저, 검색 API, AI 요약, 모델 SDK 없음 |
| 파일 확정 | temp 검증 후 exclusive hardlink. overwrite/rename fallback 없음 |
| 불명 결과 | 자동 재실행·자동 원격 정리·추측 완료 없음 |
| 인증 | control/transfer 모두 hostVerifier, key 변경 차단, 비밀 평문 저장 없음 |
| 실행 경계 | 제한 IPC, UI sandbox, UI에서 OS/SSH 직접 접근 없음 |
| 검증 | 체크리스트 필수 항목을 mock이나 문서 검사로 대체하지 않음 |

이 표는 전체 상세 계약을 대체하지 않는다. 기능을 삭제해 테스트를 통과시키거나 테스트 기대값을 구현에 맞춰 바꾸지 않는다. D01에서 dependency 조합이 실패하면 새 정확한 버전과 영향 검사안을 기록하고 명세 개정을 거친다.

## 4. 단계별 제출 형식

각 단계의 결과는 다음 내용을 포함한다.

```text
단계: Dxx
적용 명세: sshOS-v5 + scope digest
구현 요구: Rxx 목록
변경 파일: 실제 경로
검사: C ID / 실제 명령 또는 수동 절차 / 환경 / pass, fail, untested
증거: 보고서·hash·capture·서명검증 파일 경로
미해결: defect ID / 영향 / 다음 행동
다음 단계: 선행 조건을 만족하는 D ID
```

미구현 코드에 대한 테스트를 pass로 표시하지 않는다. ‘완벽’, ‘보안 문제 없음’, ‘모든 OS에서 실행됨’처럼 시험 범위를 넘는 결과를 쓰지 않는다. 검증에 사용한 source revision과 binary hash를 함께 남긴다.

## 5. 구현자를 위한 시작 프롬프트

아래 프롬프트는 실제 구현 시작을 요청할 때 사용한다. 이 문서에 실려 있다는 사실만으로 현재 실행하지 않는다.

> sshOS(시오스) v5를 구현한다. 먼저 AGENTS와 docs/01-product-plan.md, docs/02-development-plan.md, docs/06-quality-security-checklist.md, docs/spec-v5.json, docs/dependency-baseline-v5.json, docs/07-implementation-handoff.md를 읽어라. Electron은 확정이며 온라인 오류 검색·AI 요약은 제외다. 이번 버전은 기존 SSH/SFTP에 직접 연결하는 DB 없는 데스크톱 GUI다. D01부터 선행 조건과 수용 검사를 통과하면서 진행하라. 문서 충돌·외부 자원 부재·검증 불가가 있으면 해당 항목을 구체적으로 기록하고 임의 우회하지 마라. 구현과 관련된 필수 검사에 증거를 남기고 미실행은 untested로 유지하라. 이미 승인된 가역 작업은 반복 확인 없이 수행하되, 원격 쓰기·Git/GitHub 작업은 적용 지침과 실제 승인 범위를 준수하라.

## 6. 외부 선행 자원

제품 계약의 미정 사항은 없다. 다음은 구현·배포 단계에서 실제로 준비해야 하는 자원이다: 허가된 Windows 11 x64/macOS 14 arm64/x64 시험 환경, Ubuntu 24.04 amd64/arm64 격리 시험 서버, 배포자 서명 인증서·macOS 공증 권한, push할 실제 원격 저장소, 사용자 검증 참여자. 없으면 해당 target·서명·push·사용자 시험은 미완료다. 가짜 자료나 다른 target 결과로 대체하지 않는다.

개발 캐시·시험 데이터는 허용 workspace 안으로 한정한다. 테스트 fixture의 비밀번호·개인키·호스트 키는 별도 격리된 시험용으로 생성하고 공개 저장소에 실제 사용자 credential을 넣지 않는다. 테스트 중 원격 변경 대상도 fixture allowlist로 제한한다.
