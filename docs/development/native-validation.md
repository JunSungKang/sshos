# 지원 환경 수동 검증

사용자가 직접 수행할 지원 환경 검증 절차다. 자동화 보고서의 현재 Mac·로컬 ssh2 fixture 결과를 아래 환경의 합격으로 복사하지 않는다. 세부 행동과 기대값은 [품질 보안 검사 목록](../06-quality-security-checklist.md)과 [개발 계획 14절](../02-development-plan.md)이 정본이다.

## 대상과 시험 기록

클라이언트는 Windows11x64, macOS14arm64, macOS14x64다. 각 클라이언트를 Ubuntu24.04LTS amd64와 arm64 서버에 연결해 총6조합을 검사한다. macOS x64를 Rosetta에서 실행한 결과로 native x64를 대신하지 않는다. 서버는 보안 업데이트된 OpenSSH·ext4·일반 사용자 계정을 사용하고 sshd 패키지 버전과 설정을 기록한다.

각 검사 결과에는 checkId, pass·fail·untested 중 하나의 상태, source revision, binary SHA256, 앱 버전, 클라이언트 OS build·CPU, 서버 버전·CPU, fixture 설정, 수행 절차, 예상 결과, 실제 결과, 증거 경로, 결함 ID를 적는다. 실패한 검사를 수행하지 않은 것처럼 지우지 않는다. 재검사는 별도 기록으로 남긴다.

시험용 계정·키·파일만 사용한다. 실제 운영 서버, 개인 업무 파일, 운영 비밀번호를 fixture로 사용하지 않는다. 인증정보는 로컬 OS 입력창이나 앱의 연결 대화상자에 직접 입력하고 보고서에 넣지 않는다.

## 패키지 확인

`npm run package:win` 또는 `npm run package:mac`의 출력 경로에서 `build-report.json`, `SHA256SUMS`, 대응 소스 archive를 함께 보관한다. Windows는 portable exe 하나, macOS는 ZIP 내부 sshOS.app 하나를 빈 사용자 환경에서 실행한다. Node·Python·별도 DB·원격 helper 설치가 요구되면 실패로 기록한다.

현재 패키징 명령은 개발용 산출물을 만든다. Windows 배포자 서명, macOS Developer ID 서명·notarization·stapling은 준비된 인증서로 별도 검증해야 한다. OS가 실행을 차단하면 차단 화면과 서명 상태를 기록한다. ad-hoc 서명 검증 성공을 배포자 인증 또는 공증 성공으로 기록하지 않는다. 서명된 앱을 업데이트할 때 저장 인증정보의 접근 연속성을 확인한다.

## 기능과 장애 시험

각6조합에서 비밀번호와 지원 개인키, 최초 지문 승인, 변경 지문 거절, 세션별 OS 확인, 파일 목록·새로고침, 텍스트·정적 이미지 보기, 업로드·다운로드·전량 readback, 명시적 실행과 PTY를 수행한다. 창 최소화·복원·창만 닫기·작업 상세·저장소 재확인·단절·앱 종료·절전 복귀까지 확인한다. 화면의 서버와 실제 변경 서버가 다르거나 전량 검증 없이 완료로 표시되면 차단 결함이다.

추가 서버 fixture는 SFTP-only/chroot, exec 차단, SFTP 없음, READ 제한, hardlink 미지원, MaxSessions 제한, 읽기 전용 경로, quota·디스크 가득 참이다. 제한 설정은 격리 fixture에만 적용한다. timeout·단절 이후 동일 작업이나 터미널 입력이 자동 재전송되지 않는지 서버 측 관측도 함께 남긴다.

## 성능과 자원

기준 장비는 SSD, RAM8GiB 이상, logical CPU4개 이상이다. 모델·OS build·전원 모드·백그라운드 부하를 기록한다. 기준 네트워크100Mbps·RTT40ms·loss0을 먼저 실측하고, 동일 환경에서5회 반복한다. 장애 조건 RTT500/2000ms·loss1%·완전 단절은 정상 성능과 분리한다.

시작 시간은 연결 화면 조작 가능 시점까지 측정하고 Windows TEMP 해제도 포함한다. cold5회는 OS cache 조건을 기록하며 warm5회와 섞지 않는다. 메모리는60초 안정화 후300개를1초 간격으로 수집한다. main·renderer·utility·GPU·helper의 working set 또는 RSS를 합하고 공유 page 중복 가능성을 적는다. Electron workingSetSize의 단위 KiB를 byte로 바꿀 때1024를 곱한다. JS heap으로 대신하지 않는다. percentile은 정렬 후 nearest-rank를 사용한다.

미연결·3서버·2전송과 검증, 10000항목 목록, 두1GiB 전송 중 탐색, 40MP 뷰어4개·실행6채널·12창 통합 부하, 100cycle 자원 정리를 각각 측정한다. 수치 기준은 개발 계획14절을 그대로 적용한다. `test:performance`의 로컬 등록·warm launch·UI click 결과나 단일 메모리 snapshot을 이 검사로 대체하지 않는다.

## 키보드와 표시

1120×760·1600×1000, OS 배율100/150/200%, Windows/macOS 한글 IME, 키보드 전체 경로·focus 복원·dialog trap, 화면 읽기 프로그램을 확인한다. IME 조합 중 Enter가 실행·삭제·전송을 확정하면 실패다. 원격 vi는 실제 Ubuntu/OpenSSH PTY에서 검사하며 ssh2의 모의 프로그램으로 대신하지 않는다.
