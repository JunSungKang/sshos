# 연속 구현 실행 기록

2026-11-15. 사용자는 모든 계획서의 구현을 끝까지 이어서 수행하도록 지시했다. 추가 답변에 따라 지원 OS의 수동 실기 검증은 사용자 담당이다. 외부 실기 증거 대기는 최종 인계 목록으로 유지하며 독립적인 코드 구현을 중단하는 조건으로 삼지 않는다. v6 제품 기능과 보안 수용 기준은 낮추지 않고, 수동 시험을 통과했다고 표시하지 않는다.

현재 GitHub 계약은 docs/governance/full-implementation-v1.json이다. 실제 구현 순서에 맞춰 커밋하고 원격 이력과 사용자 변경을 보존한다.

## 저장·개인키·프로필 구현

개인키는512KiB 제한 읽기와 worker_thread 파싱으로 분리했다. bcrypt rounds1–100을 파싱 전에 검사하고 동시 parser1개·5초 기한을 적용한다. 프로필과 호스트 신뢰 저장에 atomic JSON 교체/backup/checksum을 적용했다. UI는 새/기존 프로필을 저장·조회·수정·삭제하고 renderer에는 개인키 전체 경로나 암호문을 반환하지 않는다. 저장소가 손상되면 기존 데이터를 초기화하지 않고 UI를 잠그며 사용자의 재확인을 제공한다.

타입·47개 단위 검사·build·실제 Electron 프로필 CRUD/화면 reload 검사가 통과했다. evidence/d02에 실제 출력을 보존했다. 지원 OS 실기 시험과 코드서명은 사용자 인계 대상으로 남기며 제품 기능 수용 기준을 통과했다고 기록하지 않는다. 다음 작업은 저장된 프로필/신뢰와 SSH 세션을 연결하는 것이다.

## SSH 세션과 데스크톱 창 구현

실제 Electron→main→utilityProcess→loopback SSH 경로에서 지문 확인 전 인증 요청0회, 승인 뒤 인증1회와 연결 유지, SFTP 거절 시 SSH 유지, 세션별 OS 확인 및 연결 해제를 검사했다. main은 서버/세대에 묶인 session capability와 내부 창 ID를 발급한다. 데스크톱은 런처·작업표시줄·드래그·8방향 크기조절·최소화/복원/최대화·키보드 이동을 구현했다. 타입/53개 단위 검사/build/실제 Electron 창 조작/SSH GUI smoke가 통과했으며 evidence/d03-desktop에 저장했다. 파일·뷰어·실행 창의 실제 자원 연동, 닫기 확인과 애니메이션은 후속 통합 대상으로 남긴다. 제품 D03/D04 전체 수용 또는 지원 OS 시험 통과를 뜻하지 않는다.

사용자가 서명·공증 인증서가 현재 없다고 확인했다. 코드 개발을 계속하며 서명/공증 및 지원 OS 실기 검증은 미검사 인계 항목으로 남긴다.

## SFTP 탐색 구현

SFTP opendir/readdir/close와 요청15초/목록60초 제한을 적용했다. 폴더당10,000개/10MiB 상한,256항목 및192KiB 이하 worker page, 일부 목록 표시, Unicode code point 정렬, main 소유 entry/directory token, 세대/창 바인딩을 구현했다. 탐색기에는 트리·가상 목록·숨김 토글·현재 목록 필터가 있고 자동 외부 갱신은 없다. renderer reload는 main의 메모리 목록을 복원하며 SFTP를 다시 조회하지 않는다. 연결이 끊기면 마지막 목록을 읽기 전용으로 남긴다.

57개 단위 검사와 실제 Electron/SSH/SFTP 시험에서 폴더 이동, 위험 이름 plain text, 링크 열기 차단, 명시적 새로고침, UI 복구 시 원격 재조회 없음, 해제 후 캐시 보존을 확인했다. evidence/d05-browsing의 검사는 로컬 fixture 근거이며 D05 전체/Ubuntu·지원 OS 수용 통과를 뜻하지 않는다. 파일 mutation은 다음 구현 단위다.

## 단일 파일 변경과 영수증 구현

서버/세대/경로/stat에 묶인60초1회 확인 token, 변경 전 durable intent, mkdir0700·unlink·rmdir, 같은 폴더 hardlink→ACK 저장→source 제거 intent→unlink를 구현했다. 기존 목적지 제거·덮어쓰기·recursive fallback은 없다. 부모 보존과 원본/목적지 lock을 적용하고, source 제거 실패는 partial, ACK 미확인은 result_unknown으로 유지한다. 영수증은 strict64KiB atomic JSON이며 재시작 dispatched 또는 backup 복구는 미확정으로 분류한다. 사용자가 확인 후 기록을 닫아도 원래 미확정 결과를 보존하며 별도 로컬 기록 삭제는 원격 요청을 보내지 않는다.

73개 단위 검사와 실제 Electron/SFTP fixture에서 확인 전 mutation0회, 폴더 생성/삭제, hardlink 미지원의 원본 보존, 작업 상세와 로컬 기록 삭제를 확인했다. intent 저장 실패 시 dispatch 금지, ACK 뒤 기록 실패의 관측 사실 보존, ACK 유실의 미확정 유지, 경로 제한, future schema 덮어쓰기 거절을 자동 검사했다. evidence/d05-mutations에 근거를 저장했다. 지원 Ubuntu/OpenSSH/OS의 수용 통과를 뜻하지 않는다.

통합 잔여: 늦은 성공 ACK의 별도 관측 기록, 앱 전체 종료/절전/worker 재시작 흐름, receipt 저장 fault의 trust/새 실행 등 전체 기능 guard. D06–D13 구현에서 함께 마무리하며 현재 D05 전체 완료로 선언하지 않는다. 다음 구현은 제한 읽기·signature 검증을 갖는 텍스트/이미지 viewer다.

## 뷰어 형식·읽기 채널 기반 구현

UTF-8 strict decode/BOM1개 처리/CRLF·LF/100,000 scalar 행 제한/2MiB 제한과 줄 시작 위치 색인을 구현했다. PNG의 chunk 길이·CRC·IHDR·정적 제한, JPEG segment/EXIF TIFF의 byte order·범위·IFD 순환·orientation1–8, WebP RIFF·bitstream/canvas 치수·정적 제한을 검사한다. 압축 byte20MiB·변16384px·40MP를 decode 전에 적용한다. 실제 픽셀 압축의 유효성은 후속 createImageBitmap 단계에서 별도로 확인한다.

ssh2 1.17.0의 public sftp callback은 subsystem/INIT 완료를 기다리므로 초기 대기 중인 해당 채널을 캡처하는 버전 고정 adapter를 추가했다. 늦게 열린 채널은 subsystem 요청 전에 닫고, shared SSH socket은 유지하며 close 관측까지 읽기 슬롯을 보존한다. 네 개 전체/서버별 두 개 FIFO pool을 구현했다. 실제 TCP/SSH fixture에서 정상 close 뒤 다른 채널 사용, 지연 open 취소, subsystem timeout의 SSH 유지와 슬롯 순서를 검사했다. 총83개 단위 검사, 타입/build, 파일 GUI 회귀 검사가 통과했다. 아직 viewer 스트리밍/디코드 Worker/창 연결을 수행 중이다.

구조 확인 근거: [W3C PNG3](https://www.w3.org/TR/png-3/), [ITU-T T.81 원문](https://www.w3.org/Graphics/JPEG/itu-t81.pdf), [CIPA Exif2.3 orientation/IFD](https://www.cipa.jp/std/documents/e/DC-008-2012_E.pdf), [RFC9649 WebP](https://www.rfc-editor.org/rfc/rfc9649.html). 전체 Exif3.1 호환성 검증은 미실행이다.
