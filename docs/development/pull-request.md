기존 SSH로 접속한 Linux 서버에서 파일 탐색·열기·전송·명시적 프로그램 실행·PTY를 데스크톱 형태 GUI로 제공한다. Electron main/preload/utilityProcess 권한 경계, 서버·세대별 capability, 호스트 키 확인, JSON intent/ACK, 검증 후 배타 파일 확정과 결과 불명 복구를 구현했다. 서버 전용 설치와 앱 DB를 요구하지 않는다.

프로필·설정·진단·로컬 라이선스 화면, 내부 창·작업표시줄·전송 선반, 응답 지표와 장애 복구를 포함한다. 원격 GUI, 편집·덮어쓰기·재귀 작업, 자동 재연결·재실행, AI·온라인 검색은 제외한다. 원래 Git root와 실제 작업 커밋 이력을 보존한다.

검증 결과:

- 단위 검사553개와 모든 대상 파일의 statement90%/branch85% 게이트 통과. 전체96.08%/91.63%.
- 실제 Electron/main/worker/loopback SSH 통합17개 및 보안61개와 Electron/xterm 검사 통과.
- Windows x64 portable와 macOS arm64/x64 개발 패키지의 ASAR 무결성·fuse·고지·크기 및 macOS ad-hoc 검사 통과. 산출물은 소스 커밋·lock hash·SHA256·대응 소스와 연결한다.
- v6 범위 digest를 유지한 문서 검사 통과. 구현 추적표는38개 요구사항을 코드와 실제 증거에 연결한다.

지원 OS·실제 Ubuntu/OpenSSH·OS 암호화·IME/접근성·지정 장비/네트워크 성능은 사용자 시험 전까지 미검증이다. Windows는 unsigned, macOS는 ad-hoc이며 배포자 서명·공증이 없다. npm audit의 moderate6개를 유지하고 high/critical은 보고되지 않았다. G0/G2/G3 사용자 평가를 수행하지 않았으며 공개 준비 상태는 false다.

현재 head의 독립 코드 검토와 GitHub App formal APPROVED 전에는 병합하지 않는다. 최종 근거는 `docs/implementation-status.json`, `docs/development/implementation-traceability.md`와 `evidence/`에 있다.
