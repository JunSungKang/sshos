# 개발용 실행물 인계

독립 리뷰 후 수정된 현재 소스의 단위553개와 통합17개가 통과했다. 아래 실행물은 수정 전 판본이며 현재 소스 기준 재빌드가 진행 중이다. 공개 배포 준비 상태는 false다. 지원 대상 시험·배포자 서명/공증·사용성 평가·공개 전 라이선스/보안 판정은 완료하지 않았다. 현재 커밋의 독립 검토·App formal approval·guarded merge도 별도 gate다.

실행물의 실제 소스 커밋은 `da5cb45d59f6a6943bbd885cfd7960961b9625c4`다. 이후 독립 리뷰의 프로필·기록 재개방 수정과 배포 경로/내구성 관측 보완이 앱 소스를 변경했다. 아래 표는 이전 산출물의 보존 기록이며 최신 후보로 사용하지 않는다. 각 폴더에 실행물, `SHA256SUMS`, `build-report.json`과 대응 소스 tar가 있다. 경로는 저장소 루트 기준이며 무거운 실행물은 Git에 넣지 않았다.

| 대상 | 로컬 산출물 폴더 | 압축 배포물 byte |
| --- | --- | --- |
| Windows11 x64 | `.local/packages/da5cb45d59f6-win-fc5dee97-3c0b-4f21-b1a8-17ad746c434a/` | 162143407 |
| macOS14 arm64 | `.local/packages/da5cb45d59f6-mac-3c5ff72a-d516-4791-92be-58bff885885f/` | 120592058 |
| macOS14 x64 | 위 mac 폴더의 x64 ZIP | 127799838 |

Windows는 `sshOS 0.1.0.exe`, macOS는 아키텍처가 맞는 ZIP의 `sshOS.app`을 실행한다. Windows는 unsigned, macOS는 ad-hoc 서명이다. 서명/공증 통과로 표시하지 않는다. 세 산출물의 정확한 이름·SHA256·무결성/fuse/고지/크기 검사는 [산출물 manifest](../../evidence/d12-final-development/artifacts.json)와 대상별 보고서에 있다. 실제 지원 OS에서 실행한 결과는 아직 없다.

소스에서 개발하려면 README의 고정 Node 버전과 설치/검사/빌드/시작 절차를 따른다. 개발 명령은 `.local/`에 runtime/cache/evidence를 둔다. 재빌드는 깨끗한 Git 커밋에서 `npm run package:win` 또는 macOS 호스트의 `npm run package:mac`으로 수행한다.

검증 근거는 다음과 같다.

- 단위534개와 파일별 statement90%/branch85% 모두 통과. 전체96.06%/91.55%이며 임계값 완화·실패 모듈 추가 제외는 없다.
- 실제 Electron/main/worker/loopback SSH 통합17개, 보안61개와 Electron/xterm 통과. OS dialog/vault/focus 대체 조건은 보고서에 남겼다.
- 세 개발 패키지의925 ASAR member hash, embedded integrity, six fuses, 고지와 크기 검사 통과. macOS ad-hoc deep/strict 검사 통과.
- v6 문서 검사와 GitHub CI 통과. [구현 추적표](implementation-traceability.md)가38개 요구사항과 실제 코드/증거를 연결한다.
- 로컬 부분 성능 측정은 [보고서](../../evidence/d13-handoff/performance-partial.json)에 있다. 종료 코드2는 지정 target 성능 검증이 미완료라는 뜻이다. 단일 메모리 snapshot을 p95로 취급하지 않는다.

사용자 시험은 [지원 환경 절차](native-validation.md)와 [152개 검사](../06-quality-security-checklist.md)를 따른다. Windows/macOS·Ubuntu6조합, 실제 OS 암호화·키보드/IME·접근성·지정 네트워크/부하·자원100cycle 결과를 소스 커밋과 binary hash에 연결한다. 인증서가 준비되지 않았다는 사용자 답변을 유지하며 다시 요구하거나 서명 성공을 꾸며내지 않는다.

G0/G2/G3는 [사용성 평가 상태](usability-evaluation.md)대로 미실시다. npm audit moderate6개와 공개 전 공급망/라이선스 판정은 [의존성 검토](dependency-review.md)에 남긴다. 이 인계서가 복합 수용 검사나 공개 승인을 대신하지 않는다.
