# 개발용 실행물 인계

sshOS(시오스)의 승인된 애플리케이션 기능 구현과 현재 개발 장비에서 가능한 자동 검증을 마쳤다. 단위553개, 실제 Electron/main/worker/loopback SSH 통합17개, 보안61개와 Electron/xterm 검사가 통과했다. 지원 OS·실제 Ubuntu/OpenSSH·서명/공증·사용성 평가의 수용 판정은 남아 있으며 공개 배포 준비 상태는 false다.

실행물3개의 실제 소스 커밋은 `8b41e23211fcac17ca40a467cd5c93c7a2d89264`다. 프로필 변경 경합, 미해결 작업 보호,5001개 이상 기록 재개방, 배포 앱 runtime 경로와 directory fsync 관측 보완을 모두 포함한다. 각 폴더에 실행물, `SHA256SUMS`, `build-report.json`과 대응 소스 tar가 있다. 경로는 저장소 루트 기준이며 무거운 실행물은 Git에 넣지 않았다.

| 대상 | 로컬 산출물 폴더 | 압축 배포물 byte |
| --- | --- | --- |
| Windows11 x64 | `.local/packages/8b41e23211fc-win-a24506fe-5390-48b1-a56b-418f3b8fb4d8/` | 162144333 |
| macOS14 arm64 | `.local/packages/8b41e23211fc-mac-88069be5-6f3d-4e1b-9dae-266fcc49fcd3/` | 120592957 |
| macOS14 x64 | 위 mac 폴더의 x64 ZIP | 127800737 |

Windows는 `sshOS 0.1.0.exe`, macOS는 아키텍처가 맞는 ZIP의 `sshOS.app`을 실행한다. Windows는 unsigned, macOS는 ad-hoc 서명이다. 각 이름·SHA256·정적 무결성/fuse/고지/크기 검사는 [산출물 manifest](../../evidence/d12-reviewed-development/artifacts.json)와 대상별 보고서에 있다. 이전 `da5cb45` 실행물은 이 판본으로 대체한다. 실제 지원 OS에서 실행한 결과와 배포자 서명·공증 성공을 의미하지 않는다.

소스 개발과 재빌드는 README의 고정 Node 버전 및 설치/검사/빌드/시작 절차를 따른다. 개발 명령은 `.local/`에 runtime/cache/evidence를 둔다. 패키지는 깨끗한 Git 커밋에서 `npm run package:win` 또는 macOS 호스트의 `npm run package:mac`으로 만든다. 배포 앱의 데이터는 명세의 OS 기본 userData에 저장하며 sessionData/runtime·crashes·logs도 그 하위로 지정한다.

검증 근거는 다음과 같다.

- [단위/coverage](../../evidence/d11-review-corrections/coverage-summary.json):553개와 모든 대상 파일의 statement90%/branch85% 게이트 통과. 전체96.08%/91.63%이며 임계값 완화·실패 모듈 추가 제외는 없다.
- [통합17개](../../evidence/d11-review-corrections/integration-report.json), [보안](../../evidence/d11-review-corrections/security-report.json): 프로필 저장 ACK 중 연결 차단, 결과 불명 작업의 프로필 보호, directory fsync 불가의 고정 진단과 경로 검사를 포함한다. OS dialog/vault/focus 대체 조건은 보고서에 남겼다.
- 세 패키지 각각926 ASAR member hash, embedded integrity, six fuses, 고지와 크기 검사 통과. Windows 고지20개, macOS 고지14개이며 macOS ad-hoc deep/strict 검사도 통과했다.
- v6 문서 검사와 런타임 소스 커밋의 [GitHub CI](../../evidence/d12-reviewed-development/correction-ci.json) 통과. [구현 추적표](implementation-traceability.md)가38개 요구사항을 코드/증거와 연결한다.
- [로컬 부분 성능](../../evidence/d12-reviewed-development/performance-partial.json):100개 durable JSON 등록5회 p95 1135.61ms, warm 개발 앱 시작5회 527.08–951.74ms,100회 UI click의 두 번째 animation frame까지 p95 30.80ms. 지정 target 검증이 남아 종료 코드2를 유지한다. 단일 586.02MiB snapshot을 p95로 취급하지 않는다.

이전 독립 검토의 major2건은 수정됐으며 읽기 전용 리뷰어가 코드와 증거로 해결을 확인했다. 문서·증거 후속 커밋까지 포함한 정확한 현재 head의 독립 판정·App formal approval·필수 CI·병합·head branch 정리 상태는 [PR#1](https://github.com/JunSungKang/sshos/pull/1)이 정본이다. 이 인계서 자체는 그 gate의 완료 증거가 아니다.

사용자 시험은 [지원 환경 절차](native-validation.md)와 [152개 검사](../06-quality-security-checklist.md)를 따른다. Windows/macOS·Ubuntu6조합, OS 암호화·키보드/IME·접근성·지정 네트워크/부하·자원100cycle 결과를 소스 커밋과 binary hash에 연결한다. 인증서가 준비되지 않았다는 사용자 답변을 유지한다.

G0/G2/G3는 [사용성 평가 상태](usability-evaluation.md)대로 미실시다. npm audit moderate6개와 공개 전 공급망/라이선스 판정은 [의존성 검토](dependency-review.md)에 남긴다.152개 복합 수용 검사의 미실시 상태는 자동 검사 개수나 구현 기능 수와 구분한다.
