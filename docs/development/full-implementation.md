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

## 뷰어 제한 읽기 엔진 구현

뷰어별32KiB SFTP 요청으로 최대64KiB 청크를 반환하고 renderer가 다음 sequence를 요청할 때 이전 청크 소비 ACK로 처리한다. 재요청은 저장한 한 청크를 반환하며 범용 RPC 완료 캐시에 파일 byte를 넣지 않는다. probe는4KiB만 읽고 전체 파일 size metadata를 보존한다. 실제 byte 수 제한·EOF·처음/끝 fstat 비교·파일 handle close ACK를 확인하고, 읽기15초/전체30초 기한과 취소는 해당 채널에만 적용한다. 대기 슬롯 시간은30초 기한에서 제외한다. 취소/연결 해제 뒤 늦은 결과는 화면 데이터로 승격하지 않는다.

90개 단위 검사, 타입/build와 Electron 기반 회귀 smoke가 통과했다. short read·중복 sequence·소비 전 읽기 없음·허위 size metadata·읽는 중 파일 변경·timeout·세대 오인 방지를 검사했다. evidence/d06-reader에 실제 출력을 저장했다. 다음 작업은 main의 viewer/probe capability, preload, renderer 소비 ACK 및 decode Worker와 내부 뷰어 창을 연결하는 것이다. 사용자 파일 열기 기능의 완료를 선언하는 기록이 아니다.

## 텍스트·이미지 창 연결 검증

main 소유 viewer/probe token, 창·서버·세대·epoch 바인딩, 동일 자원 창 재사용, renderer 소비 ACK와 격리 decode Worker를 연결했다. 텍스트는 가상 줄 표시·읽기 전용 복사를 제공하고 HTML/ANSI를 실행하지 않는다. 이미지는 헤더 제한 검사 뒤 createImageBitmap 한 번과 bitmaprenderer canvas로 표시하며 화면맞춤·25/50/100/200% 확대를 제공한다. 다시읽기 실패 시 이전 내용을 유지하고 연결 해제 후 캐시를 읽기 전용으로 남긴다. renderer를 잃으면 진행 읽기는 중단하고 명시적 다시읽기만 허용한다. 임의 파일의 선택창에 다운로드 연결은 D07에서 추가한다.

96개 단위 검사·타입·build가 통과했다. 실제 Electron/SSH/SFTP fixture에서 텍스트, 위험 문자열, PNG signature, JPEG EXIF1–8의 치수와 모서리 픽셀, WebP, 잘못된 UTF8 거절과 수정 뒤 다시읽기, 3MiB 초과 PNG 스트리밍·표시를 확인했다. 읽기는 한64KiB 청크 내 서로 다른32KiB 두 구간만 병렬 요청하고 다음 청크는 소비 ACK 뒤 읽는다. evidence/d06-viewers에 실제 출력과 화면·소스 hash를 보존한다. 지원 OS/Ubuntu/OpenSSH/서명 또는 D06 전체 수용 통과 기록이 아니다. 다음 구현은 비동기 전송이다.

## 비동기 전송 기반과 연결 경합 수정

control 세대별 transfer/execution socket을 각각 하나로 제한하는 lease를 추가했다. 같은 role의 opening을 공유하고 closing 중에는 새 socket을 만들지 않으며 실제 close 뒤에만 자리를 비운다. 모든 socket에서 pinned host key와 one-shot 인증을 수행하고 원래 control 종료는 두 role을 닫는다. 보조 연결 종료는 control을 유지한다. 개인키 raw byte·passphrase는 worker 파싱 후 제거하며 현재 세션 signer만 재사용한다.

기능 확인과 요청한 secret 저장 완료 전 resource token을 발급하지 않도록 수정했다. 저장 대기 중 disconnect 뒤 늦은 암호화 응답·connected 이벤트는 capability나 secret 저장을 되살리지 않는다. receipt 저장 fault는 trust 쓰기도 차단한다.

전송 상태 전이, 최종화 intent 대기 전 취소 잠금, 최대100개 batch 예약, 전체2/서버1 슬롯, remote/local 경로 lock을 구현했다. 실제 byte 엔진은32KiB·최대16개 버퍼로 upload write/download read를 처리하고 short I/O·EOF·4GiB 초과 offset·64GiB 경계를 검사한다. source SHA256와 전량 read-back SHA256, 전송/검증 별도 counter 및 최근3초 속도 계산 기반을 추가했다. 이 기록은 아직 GUI로 전송을 시작할 수 있다는 뜻이 아니다. durable orchestration·실제 파일 adapter·선택/확인/진행 UI를 다음 단위에서 연결한다.

112개 단위 검사·타입·build와 실제 Electron session/file/viewer/isolation 회귀 검사를 통과했다. 회귀 검사에서 Playwright1.65.1의 waitForFunction에 async predicate를 전달하면 반환 Promise 자체를 참으로 처리해 조기 종료하는 것을 설치된 소스에서 확인했다. expect.poll이 bridge 결과를 await하도록 수정하고 관련 GUI 검사를 다시 수행했다. ssh2의 test용 Ed25519 생성기가 DER bitstring의 실제 선행0 byte도 제거해 드물게 잘못된 키를 만드는 별도 fixture 문제를 확인했다. test generator 결과의32byte 공개키 길이를 검사해 잘못된 fixture를 사용하지 않도록 했으며 제품의 사용자 키 처리·인증 재시도 정책은 변경하지 않았다. 실제 출력은 evidence/d07-core에 보존했다.

## 전송 확정 절차와 영수증 복구 구현

전송 runner는 temp intent 저장→배타 생성 ACK→created 저장→byte 전송·원본 최종 stat·handle close→temp 전체 read-back→finalize_intent_pending 취소 잠금→durable finalizing/dispatchAllowed 저장 ACK→exclusive link→destination 확인 기록→temp 제거→완료 기록 순서를 따른다. 같은 task를 다시 실행하지 않으며 취소·30초 무진행·기록 오류·변경 ACK 불명·늦은 ACK 관측을 분리한다. 실제 remote/local I/O adapter는 아직 다음 구현 대상이다. runner 검사는 fault-injected port에 대한 검사이며 실제 대용량 전송 검증을 대신하지 않는다.

영수증은 file_mutation/file_transfer strict union과 불변 서버·경로·초기 stat을 사용한다. 잘못된 pending의 복원은 불명으로 분류하되 새 pending을 디스크에 저장하지 않는다. completed+cleanup needed/unknown도 미해결 보관·확인 대상이며 자동 prune과 확인 전 삭제를 막는다. backup 복구로 새 불확실성이 생기면 과거 acknowledgedAt을 새 승인으로 사용하지 않는다. 이미 알려진 result_unknown은 재실행 시 원래 recoveredFromPhase를 보존한다. 작업 화면은 두 종류의 결과·byte·정리 상태를 구분한다.

추가 점검에서 host trust 저장 대기 중 disconnect와 connect가 경합할 수 있는 구간도 발견해 pending operation으로 예약하고 저장 후 세대를 다시 검사했다. 126개 단위 검사·타입/build·실제 Electron 연결/파일 작업 회귀 검사가 통과했다. evidence/d07-orchestration에 출력과 source hash를 저장했다. 지원 OS/실제 Ubuntu/SFTP 전송 수용 검사 완료를 뜻하지 않는다.

## 실제 로컬 파일·SFTP 전송 adapter 검증

로컬 canonical parent의 dev/ino와 일반 파일 handle/fstat을 검사하고 symlink·UNC·Windows 금지 다운로드 이름을 거절한다. 다운로드 temp는 wx/0600으로 만들며 실제 write 길이·sync·close·동일 inode의 read-back과 exclusive fs.link·destination stat을 확인한다. 업로드는 별도 transfer socket/SFTP에서 wx/0600·bounded write ACK·close·전량 read-back·OpenSSH hardlink API·destination stat·temp unlink를 수행한다. 공개 hardlink API 이외의 rename/copy/destination 제거 fallback은 없다. raw local path를 renderer에서 입력받는 API는 만들지 않았다.

취소/timeout scope는 해당 transfer lease만 닫고 늦게 끝나는 native 작업은 실제 settlement까지 보존해 획득한 handle도 정리한다. 늦은 성공 ACK는 관측으로 기록하고 task를 completed로 승격하지 않는다. temp 검증 도중 EOF나 metadata 변화는 원본 변경과 구분해 VERIFY_MISMATCH로 처리한다.

138개 단위 검사·타입/build·Electron 파일 작업 회귀 검사가 통과했다. 실제 loopback SSH/SFTP와 현재 로컬 volume에서 정상/빈 파일 양방향·hash·0600·기존 목적지 보존·hardlink 미지원·READ 거절·temp 변조·link 직전 충돌·temp 생성 후 취소와 control 유지가 통과했다. SSH fixture의 server API가 extension을 광고하지 않으므로 시험에 한해 pinned ssh2 1.17.0 VERSION packet에 hardlink 광고를 추가하고 실제 SFTP EXTENDED→fs.link를 처리한다. 제품 adapter는 이 시험용 private protocol 조작을 import하거나 사용하지 않는다. evidence/d07-ports에 실제 출력·환경·source hash를 보존했다. 이는 Ubuntu/OpenSSH·Windows/NTFS·macOS14·5GiB/64GiB 실기 수용 또는 GUI 전송 완료를 뜻하지 않는다. 다음은 worker→main writer protocol과 native 선택/확인·진행 UI다.

## worker→main 영수증 저장 채널 구현

worker의 JSON 직접 쓰기 없이 main writer에64KiB 이하 영수증을 보내고5초 내 식별자가 일치하는 저장 ACK를 받아야 다음 단계로 진행한다. main은 먼저 durably 수락한 resource만 갱신하며 서버·세대·epoch·불변 경로를 확인한다. requestId 중복은 저장을 반복하지 않고 ACK를 재사용하며 sequence 역행을 거절한다. 저장 하나가 실패하면 worker의 모든 대기 허가를 무효화하고 후속 성공 ACK로 풀지 않는다. 수동 저장소 재확인 전에는 신규 저장·변경 진행을 허용하지 않는다. 종결 영수증의 phase를 같은 task ID의 queued/preparing으로 되돌리는 것도 거절한다.

144개 단위 검사·타입/build·Electron startup/isolation와 파일 GUI 회귀가 통과했다. 채널 검사는 메모리 post callback과 실제 AtomicJSONStore 조합으로 저장 전후 권한·중복·시한·다른 세대·64KiB·잘못된 resource를 검사했다. main/utilityProcess의 수신 분기는 연결했으며 실제 전송 command coordinator를 통해 전체 프로세스를 관통하는 검증은 다음 단위다. evidence/d07-receipt-channel에 실제 출력과 source hash를 보존했다. 아직 전송 선택/확인/진행 UI의 완성을 뜻하지 않는다.

## 전송 조정기와 실제 프로세스 관통 검사

worker에 batch reserve→각 row stage→전체 commit 순서를 연결했다. stage만으로 socket·temp를 만들지 않는다. commit 뒤 전역2/서버1 FIFO와 path lock으로 실행하고 실제 자원 close 및 마지막 관측 기록 처리가 끝난 뒤 슬롯을 해제한다. close 불명은 정리 대기로 유지한다. queued 취소는 runner를 생성하지 않으며 disconnect/세대 변경은 해당 작업만 중단한다. 저장 fault는 active transfer를 중단하고 queued 작업을 제거해 이후 저장소 확인이 같은 task를 재실행하지 못하게 한다. progress는 raw path/file byte 없이 metadata event와100행 page로 전달한다.

149개 단위 검사·타입/build·Electron 기반 회귀가 통과했다. scripts/transfer-engine-smoke.mjs는 workspace 안에만 임시 main harness를 만들고 actual utilityProcess 하나와 실제 main ReceiptRepository/ACK 채널을 연결한다. 실제3MiB+17byte 두 파일의 upload/download, 전체 SHA256 read-back, exclusive link, temp 제거, 서버별 순서 및 매 task 새 인증, 작업 뒤 control 유지가 통과했다. harness는 종료 시 자신의 main 파일·fixture·runtime을 제거한다. native dialog 및 renderer enqueue를 우회하는 backend 시험이므로 UI 전송 완료를 뜻하지 않는다. evidence/d07-coordinator에 실제 출력을 보존했다. 저장소 재확인과 worker fault 해제의 실제 수명 결합, 선택/충돌 preview/확인/진행 UI는 다음 통합 대상이다.
