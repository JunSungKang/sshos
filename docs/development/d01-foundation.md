# D01 실행 기반 개발 기록

시작일: 2026-11-15. 적용 명세: v6, scope digest `22b572637f890232b8971d14d46ee72414bbbf2276360063f54c71365ce535cb`. 실제 사용자의 “작성한 모든 문서를 기반으로 프로젝트 개발을 시작하라” 지시를 승인 근거로 기록했다. SDD ready 검사는 구조/승인 참조를 검사했으며 인간의 판단이나 제품 품질을 인증하지 않는다.

## 실제 구현

- Electron 기본 창, 패키지의 app://ui 정적 protocol, sandbox/contextIsolation/Node 차단, 외부 navigation·권한·다운로드·웹 요청 차단.
- renderer → preload의 lifecycle.getSnapshot → main의 sender/origin/budget/schema → ssh2를 로드한 utilityProcess 통신. 원격 서버에 접속하지 않는다.
- 실제 연결이 없는 개발 화면. 가상의 서버·전송·SSH 응답을 실제 측정값처럼 표시하지 않는다.
- strict TypeScript, exact npm lockfile, Vite build, Vitest, 실제 Electron Playwright smoke. xterm/fit과 실제 CSP 조합은 별도의 테스트 fixture로 확인한다. fixture는 패키지 실행에서 차단한다.
- cache·temp·userData·sessionData·로그·crash 경로를 프로젝트 내부 .local로 설정한다. Electron 최초 import 이전에 실제 설정 이름 electron_config_cache를 적용한다.
- 아직 구현하지 않은 통합·성능·배포 검사는 exit2로 미준비를 표시하며 성공을 출력하는 가짜 테스트로 대체하지 않는다.

## 검증과 한계

현재 머신은 **macOS 26.6.2 arm64**다. 이는 정식 수용 매트릭스의 macOS14 시험을 대신하지 않는다. 개발 Node24.22.3, Electron45.3.2의 실제 Node24.22.2·Chromium156.0.8078.100 조합을 관찰했다. 상세 실제 결과는 evidence/d01과 docs/implementation-status.json을 따른다.

타입 검사·15개 단위 검사·build와 실제 Electron smoke를 실행했다. smoke는 worker handshake, sandbox/renderer Node 격리, 외부 fetch/inline script/eval 차단, xterm DOM/fit 렌더링을 검사한다. Playwright DevTools evaluate는 CSP eval 제한을 우회할 수 있으므로 eval 거절 검사는 실제 패키지 fixture 코드에서 수행한다. 스크린샷은 디자인 검수 보조이며 권한 검사의 대체 증거가 아니다.

npm audit은 moderate6개, high/critical0개를 보고했다. build 도구 계열 minimatch와 전이 의존성 경고를 남겼고 자동 audit fix/다운그레이드를 하지 않았다. 실제 적용성 검토와 license/SBOM은 후속 단계다. Windows/macOS14x64/arm64·Ubuntu24.04amd64/arm64·키/호스트신뢰·SFTP·OS 암호화·서명/공증·fuses 시험이 남아 있으므로 D01 전체 또는 공개배포 완료로 표시하지 않는다.

## 이력과 경계

원격 기존 root commit을 보존하고 정책→과거문서→현행문서를 현재 시각의 실제 등록 commit으로 먼저 push했다. 이후 구현·검사·진행기록을 실제 변경 단위로 commit한다. 과거 문서 날짜로 Git commit을 소급 생성하지 않았다. main 직접 push·force push·보호 우회는 사용하지 않는다.

초기 실행에서 잘못된 캐시 변수로 외부 Electron zip1개가 생성됐다. 실행을 중단하고 원인을 수정했으며 사용자의 정확한 경로 정리 승인 뒤 해당 파일과 빈 부모 폴더만 삭제했다. 이후 설치 스크립트 재현은 올바른 프로젝트 내부 electron_config_cache를 사용한다.

초기 D01 workflow 계약에는 완료된 문서등록 작업의 src금지 규칙이 전체 forbiddenPaths union에 남아 guard가 거절했다. 첫 문서 push 후 승인된 구현 범위를 반영한 v2로 정정하고 정상 guard를 통과했다. v3는 승인된 오픈소스 계획의 LICENSE 경로를 추가한다. 이전 계약 파일은 삭제/덮어쓰기하지 않았다.

다음은 남은 D01 시험 전제를 해결한 뒤 D02의 JSON 저장·프로필·호스트 신뢰를 구현하는 것이다. 이 단계에서 SSH 기능을 가진 완성품이나 모든 OS에서 실행 가능한 배포물을 납품했다고 주장하지 않는다.

## 2026-11-15 인증 기반 추가

사용자의 진행 상황 지적 후 호스트 키 검증, 단일 RSA/Ed25519 서명기, 일회 인증 선택기와 명시적 알고리즘 목록을 구현했다. 공개키 정체성 불일치·약한 RSA·SHA-1·세션 해제 후 지연 서명 전달을 거절한다. loopback SSH 서버와 실제 TCP 핸드셰이크로 미승인/변경 호스트의 인증 요청0건, 승인 후 password 인증, RSA SHA-2 인증, 비밀번호 실패 후 fallback 없음을 검사했다. 모든 시험 키는 메모리에서 생성하며 실제 사용자 credential이나 private key를 파일/로그에 저장하지 않았다.

최신 로컬 검사는32개다. 이중 실제 loopback SSH 사례는5개이며 Ubuntu/OpenSSH 대상 시험과 구분한다. 증거는 evidence/d01-auth에 있다. 아직 UI/세션 관리자에 인증 모듈을 연결하지 않았으며 D01 전체 완료나 사용자 접속 기능 완성을 주장하지 않는다. 공식 완료 단계는0/13, 제품 수용 검사152개는 미실행 상태다. 이전에 작업을 종료한 이유는 실행 기반 검사를 마친 뒤 중간 결과를 최종 응답으로 내보낸 판단 때문이며, 모든 후속 개발이 외부 자원 때문에 차단된 상황은 아니었다.
