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

## 로컬 선택 권한과 native dialog 제한

main 소유 파일/폴더 선택 서비스는 실제 경로·stat·canonical parent를 메모리에 보관하고 renderer에는 표시명·선택 token·크기/지원 여부만 반환한다.120초 도달 시 권한이 만료되며 role별 map을 사용한다. 혼합 선택은 미지원 항목도 모두 반환하고101개 선택은 전체 거절한다. renderer 교체를 무효화한 뒤 늦게 끝난 dialog 결과는 권한으로 발급하지 않는다. key picker와 전송 선택 서비스가 동일한 frame별 dialog gate를 공유하도록 구성했다. 원격 프로그램 실행·파일 변경을 이 서비스에서 수행하지 않는다.

155개 단위 검사·타입/build와 Electron 회귀가 통과했다. native OS dialog 자체는 unit fixture로 대체하고 실제 workspace 파일 metadata와 symlink 거절을 검사했으므로 Windows/macOS native picker 실기 통과를 뜻하지 않는다. 파일 선택 서비스의 UI bridge와 transfer preview/confirmation은 다음 구현 대상이다. evidence/d07-selections에 출력을 보존했다.

개인키 선택도120초 경계에서 만료한 capability를 정리해20개 선택 제한이 과거 만료 항목 때문에 영구 소진되지 않도록 수정하고 검사했다.

## 전송 목록 사전 확인과 일회성 승인

main 소유 preview는 native 선택 권한과 파일 창·서버·세대·epoch를 검증하고 control SFTP의 읽기 전용 stat으로 업로드 충돌과 다운로드 원본을 검사한다. 원격 변경·transfer socket 생성은 확인 단계에서 수행하지 않는다. 미지원·충돌 행도 목록에 남기며 이름 수정과 선택 변경은 기존 확인 token을 폐기한다. 유효하고 선택된 행만 최대60초 일회성 권한으로 확정하며 native 선택120초 시한을 넘기지 않는다. 실제 로컬 경로는 renderer에 전달하지 않는다. 최대100개 목록은60,000byte 이하 page로 나눈다.

162개 단위 검사·타입/build와 실제 utilityProcess의 transfer:inspect 및 양방향 backend 전송 검사가 통과했다. Windows 다운로드 이름 제약은 주입한 정책 검사이며 Windows 실기 통과가 아니다. evidence/d07-previews에 출력을 보존했다. preview를 이용하는 enqueue bridge와 renderer 전송 화면은 다음 구현 대상이다.

## 전송 GUI와 main 수락 절차 연결

탐색기에 최대100개 Ctrl/Cmd/Shift 선택·업로드·다운로드·파일 열기 선택창의 다운로드를 연결했다. 확인창은 모든 유효/충돌/미지원 행과 서버·계정·host 지문을 보여주고 대상 이름 적용 또는 선택 해제를 제공한다. 확인 token만 제출하며 ‘유효한 N개만 전송 · 나머지 M개 제외’를 명시한다. 원격 전체 read-back의 추가 시간·전송량과 기존 파일을 덮지 않는 동작을 확인창에 표시한다.

main은 worker 전체 batch 예약 뒤 모든 queued 영수증을 저장하고 모든 row를 stage한 뒤 한 번만 commit한다. 사전 등록 실패는 commit하지 않고 저장한 대기 기록을 중단 처리한다. 등록 중과 실행 중을 구별하고 등록 중 취소는 요청을 거절한다. 시작된 작업은 파일 창 닫기와 renderer reload에 귀속되지 않는다. 하단60px 선반은 실행최대2개·전송/검증 단계·byte·최근 속도·대기/등록/실패/확인 필요 수·취소·전체 작업을 표시한다. task list/detail에는 runtime 관측과 durable 기록을 합치되 native 전체 경로를 renderer로 반환하지 않는다. event sequence gap은 모든 등록된 서버의 bounded snapshot과 대조하며 더 오래된 snapshot이 진행값을 되돌리지 못한다. 누락된 종결 이벤트는 안정된 worker snapshot과 durable terminal 영수증으로 대조한다.

169개 단위 검사·타입/build·Electron/file/viewer/backend 회귀가 통과했다. 실제 Electron GUI에서 두 파일 업로드와 Ctrl/Cmd 두 파일 다운로드, 충돌 이름 변경, 확인 전 변경·보조 인증 없음,4MiB 업로드 중 창 닫기 및 renderer reload 후 전송 유지, 전체 SHA256·목적지 보존·temp 제거·매 task 신규 socket 인증과 control 유지를 확인했다. native picker는 시험 main process에서만 fixture 응답으로 대체했으며 제품 backdoor는 추가하지 않았다. evidence/d07-transfer-ui에 출력·실제 화면3장·source hash를 저장했다. 지원 OS/Ubuntu/OpenSSH/대용량/서명 수용 검사와 저장소 재확인·앱 수명 통합까지 완료했다는 뜻은 아니다. 다음은 저장소 오류 복구 및 control metadata 직렬화다.

## 저장소 재확인 barrier와 metadata 직렬화

control metadata SFTP의 OS 확인·목록·mutation inspection/prepare/step·transfer inspection을 세대별32개 이하 whole-operation FIFO로 직렬화했다. 앞 요청 실패가 다음 요청을 영구 정지시키지 않으며 연결 해제 뒤 대기 작업은 원격 요청을 보내지 않는다. 읽기 전용 viewer와 실제 전송은 별도 채널을 유지한다.

저장소 재확인은 main↔worker 전용 epoch/requestId/token protocol을 사용한다. 정상 실행 중에는 재확인을 거절하며 저장 오류 복구는 신규 변경을 잠그고 진행 등록·mutation·transfer 종료와 영수증 writer settlement를 확인한다. worker의 active/reserved 작업이5초 내 정리되지 않으면 재개하지 않는다. barrier 뒤 JSON을 검증·재개방하고 일회성 token으로 worker writer fault/pause를 해제한다. 불명 응답은 잠금을 유지하며 자동 작업 재실행은 없다. profile 쓰기와 host trust도 영수증 fault/복구 중 변경 잠금을 공유한다. 기존 읽기 조회를 같은 이유로 잠그지 않는다.

175개 단위 검사·타입/build·실제 Electron backend/GUI/file/session 회귀가 통과했다. 실제 utilityProcess에서 강제 저장 fault barrier→JSON reopen→writer reset 뒤 새 task만3MiB 전송하고 이전 두 task가 재실행되지 않음을 신규 인증 횟수와 파일 hash로 확인했다. GUI 저장소 재확인 후 다운로드도 통과했다. evidence/d07-recovery에 출력과 source hash를 보존했다. 실제 디스크 부족·Windows 파일 잠금·지원 OS 매트릭스·앱 종료/절전/crash 통합 검사는 남아 있으며 다음 구현은 D08 실행과 D09 PTY다.

## GUI 실행 backend와 공유 채널·출력 한도

실행 명세는 direct/sh/bash와 canonical path/cwd, 최대64개·각4096byte·합계16KiB argv를 검증한다. POSIX single-quote 명령 구성은 실제 /bin/sh fixture에서 metacharacter·작은따옴표·빈 인수·Unicode를 별도 인수로 보존했다. 원격 실행 파일·cwd·실행 비트를 control metadata FIFO에서 재검사하고 dispatching intent의 main 저장 ACK 후에만 exec를 보낸다. stdin에 선행 EOF를 보내지 않으며 실행 전체 시간·무출력 기한을 두지 않는다.

execution/PTY 공유 채널 슬롯은 전체6·서버4이며 opening과 close 미확정도 포함한다. 같은 execution socket을 공유하고 마지막 실제 채널 close 뒤 유휴 socket을 닫는다. 요청10초 timeout/거절 후 다른 실행이 살아 있으면 socket을 강제 종료하지 않고 미정리 슬롯을 보존한다. 늦게 반환된 channel은 즉시 close하고 close event/socket 종료 전 슬롯을 해제하지 않는다. stdout/stderr는 arrival chunk를 구분하고 작업4MiB/전체16MiB의 payload+metadata charge로 tiny chunk 수도 제한한다. 종결 작업의 출력부터 해제하며 전역 압력에서는 가장 오래된 chunk를 제거하고 생략 사실을 노출한다. 원격 출력은 메모리만 사용하고 read RPC는 범용 완료 캐시에 저장하지 않는다.

영수증 저장은 file_transfer/file_mutation/gui_exec/pty의 strict union으로 확장했다. 실행/PTY에는 argv·입력·출력·command hash를 허용하지 않는다. prepared 복구는 전송하지 않은 취소, dispatch/running/stop 복구는 결과 불명이며 backup은 종결 관측도 최신성 불명으로 처리한다. 코드0을 업무 성공으로 해석하지 않는다. exit 관측과 channel close가 모두 확인돼야 exited다. TERM1회·5초 stop_unconfirmed·명시적 채널 닫기와 결과 불명을 분리한다.

192개 단위 검사·타입/build 및 actual Electron utilityProcess/SSH/main JSON ACK 실행 검사가 통과했다. 실제 SSH 채널에서 동시 두 실행의 socket 공유, stdout/stderr, 종료7, 무출력 stdin 유지, TERM 무시, 로컬 채널 닫기 후 불명, 명시 거절과 control 유지를 확인했다. fixture의 프로그램 동작은 SSH server channel로 모사하며 실제 셸 quoting은 별도 /bin/sh 시험이다. transfer engine/GUI와 file 회귀도 통과했다. evidence/d08-engine에 출력·source hash를 저장했다. 아직 사용자 실행 확인창·출력 창·POSIX 세션 확인·출력 소비 ACK/복구 UI·실제 Ubuntu 실행 수용 완료를 뜻하지 않는다. 다음은 main 권한과 실행 GUI 연결이다.

## 실행 확인창·출력 창과 작업 관리자 연결

탐색기의 명시적 실행 버튼은 direct 기본값·인수별 입력·검증된 directoryToken 실행 위치 선택·세션별 POSIX 호환 확인을 제공한다. main이 source/stat/인수/세대/epoch에 고정한60초 일회성 확인을 발급한다. preview는 원격 실행을 보내지 않는다. 확정 후 내부 출력 창 자리를 확보하고 prepared 저장을 완료한 뒤 worker에 실행을 요청한다. 실행 인수는 요청 후 main 메모리 참조를 비우며 영수증에 저장하지 않는다. 실행 비트 없는 direct는 거절하며 사용자가 sh/bash를 선택해야 한다.

출력 창은 stdout/stderr와 ANSI escape를 plain text로 표시하고 UTF8 분할/줄 조각을 이어 붙인다. 표시 한도4,194,304 UTF-16 code unit·20,000행·단일행100,000 UTF-16 code unit을 적용하며 이전 출력 생략을 알린다. 이는 worker 원본 byte ring 한도와 별도인 표시 한도다. 가상 행과32KiB 소비 cursor·한 청크 재전달·1MiB/s 전송 pacing을 사용한다. 모든 viewer/exec 읽기는 공통100회/s renderer scheduler를 공유해 main의128회/s stream budget을 넘지 않는다. renderer 교체와 창 닫기 후 늦은 byte를 폐기하며 출력 byte를 상태 snapshot에 넣지 않는다.

실행 출력 창 닫기는 창 유지/창만 닫고 계속 실행/중지 요청을 구분한다. main은 실행 중 창의 일반 close 우회를 거절하고 확인 token을 요구한다. 숨긴 창은 전체 작업에서 같은 실행의 메모리 출력에 다시 연결하며 renderer reload도 실행을 재요청하지 않는다. 과거 영수증은 관측 metadata만 열고 자동 실행하지 않는다. TERM과 채널 닫기도 서버·경로가 고정된 별도 일회성 확인을 사용한다. 실제 종료 정보와 기록 저장 오류·대기·정리 미확정을 구분한다.

206개 단위 검사·타입/build·actual Electron 실행 GUI와 기존 Electron/file/viewer/transfer GUI 회귀가 통과했다. 실행 확인 전 exec/auth 없음, 빈 인수·특수문자·cwd, plain 로그, 창 닫기 main guard, 숨기기/재열기/reload 동안 실행1회 유지, 활성 실행 중 정상 저장소 재확인 거절, TERM 무시5초 뒤 불명, 나중의 exit0와 close, non-executable direct 거절 후 sh와 exit3 보존을 확인했다. evidence/d08-gui에 출력·실제 화면3장·source hash를 보존했다. 실제 Ubuntu 프로그램/noexec/CPU/지원 OS 수용은 사용자 시험 대상이다. 저장 오류와 활성 실행이 겹치는 writer 재확인·worker 재생성·종료/절전/renderer 장애 통합은 D10에서 완료해야 하며 현재 완료 또는 release-ready로 표시하지 않는다. 다음 구현은 D09 PTY다.

## PTY backend와 복구·입력 경계

PTY는 GUI 실행과 같은6/4 채널 풀을 사용하고 intent 저장 ACK 후 xterm-256color·80×24·pixel0으로 shell을 요청한다. env/X11/agent 옵션을 추가하지 않는다. worker 출력 history는 채널1MiB·전체6MiB이며 live 미소비256KiB에서 두 출력 stream을 pause한다. 복구는 출력을 멈추고 마지막 byte offset S를 고정한다. 순서대로 snapshot을 읽고 정확한 restore token/S를 ACK하기 전 uiReady=false로 입력을 거절한다. 표시 초기화는 history를 비우고 새 snapshot을 만들며 shell을 재요청하지 않는다.

입력은 단조 sequence·120회/rolling1초·64KiB/rolling1초·in-flight64KiB를 검사한다. 일반 키 입력은4KiB packet과 단독 Enter를 허용하고 혼합 줄바꿈은 거절하며, 승인된 paste 경로와 구분한다. duplicate sequence는 재전송하지 않는다.10초 쓰기 callback 미확정은 입력 불명과 pause로 처리하되 실제 callback/socket 종료 전 Buffer와 in-flight 소유권을 유지한다. timeout만으로 버퍼를0으로 덮어 전송 중 내용을 바꾸지 않는다. 실제 settlement 뒤에만 참조·byte를 해제하고 복구 ACK 전 미확정 write가 남으면 입력을 재개하지 않는다. 입력 내용과 순서는 영수증에 기록하지 않는다.

216개 단위 검사·타입/build·실제 PTY utilityProcess/SSH 검사가 통과했다. GUI exec와 PTY가 인증된 socket 하나를 공유하고 초기80×24와132×40 변경, 복구 전 입력 거절, input duplicate 거절, Ctrl+C byte와 TERM 구분,256KiB 역압, 고정 snapshot과 history 초기화, 정상 exit0/close, 타 실행 및 control 유지를 확인했다. 실행 GUI/transfer engine 회귀도 통과했다. 기존 POSIX shell 시험은 child exit가 아니라 stdio close 후 결과를 검사하도록 경합을 수정했다. GUI 완료 출력은 서버 세션 종료 시 worker와 renderer에서 해제하고 늦은 byte가 다시 추가되지 않도록 했다. evidence/d09-engine에 실제 출력을 보존했다. 아직 xterm 제품 창·paste 확인·보안 parser·vi/IME/clipboard·지원 OS 수용 통과가 아니다. 다음은 main terminal 권한과 xterm UI다.

## PTY 제품 창·붙여넣기·parser 경계 연결

main 소유 terminal/output/restore capability와 실제 xterm6 DOM 창을 연결했다. 입력은64KiB 유한 큐·4KiB packet·120회/s·55KiB/s pacing과 단조 sequence를 사용한다. 복구 때 새 xterm에 고정 snapshot을 write callback까지 소비하고 정확한 S를 ACK하기 전에는 입력과 DA 응답을 전송하지 않는다. 살아 있는 새 출력의 DA 응답은 허용한다. 최소화는 shell과 출력 소비를 유지하고, 표시 다시 연결/새 표시 시작은 새 shell을 만들지 않는다. resize는 proposeDimensions 결과를2–500열/1–200행으로 제한한 후 적용한다.

붙여넣기는 native 입력1회/1초와 focused BrowserWindow 조건으로 main의 비동기 clipboard read를 승인한다. 원래 terminal capability를 읽기 시작 전에 고정한다. CR/LF 포함 또는4KiB 초과는 서버·터미널·원문 확인을 요구하고60초 일회성 token을 사용한다. CRLF/LF를 변환하거나 Enter를 추가하지 않는다. bracketed paste 모드에서만 경계 byte를 추가한다. paste 동안 기존 키 입력을 먼저 비우고 자동 응답은 뒤에 대기시키며 마지막 authoritative sequence와 동기화한다. renderer 교체·연결 해제는 권한과 미사용 paste buffer를 폐기한다.

public xterm parser로 OSC 제목/링크/클립보드·관련 제어를 소비하고 REP500 초과를 거절한다. WebLinks/Clipboard addon과 proposed API를 사용하지 않는다. 실제 parser fixture에서 OSC0/2/8/52, REP2147483647 차단·REP500 허용, paste 이벤트의 원문 보존과 자동 입력 방지를 확인했다.

타입·227개 단위 검사·build·Electron CSP/parser·actual PTY backend/GUI·기존 실행 GUI 회귀가 통과했다. GUI 검사에서 Ctrl+C byte, 다중 터미널 대상 고정, paste 확인 전 byte0, 정확한 bracketed byte, paste 뒤 DA sequence, reload 중 shell 재요청0·과거 DA 응답0, 최소화 출력 소비, 닫기 확인/결과불명과 정상 exit0를 확인했다. evidence/d09-gui에 실제 출력·화면3장·source hash를 보존했다. native focus와 clipboard read는 test main process의 모의이며 제품 우회 경로는 없다. 실제 vi/IME/OS clipboard와 지원 OS/Ubuntu/OpenSSH 수용은 미검증이다. 다음은 D10의 저장소 복구·종료/절전/crash·응답시간 표시다.

## 활성 실행·PTY의 저장소 재확인 연속성

같은 살아 있는 backend epoch와 main이 알고 있는 실행 ID에 한해 유효 current 영수증의 running 단계를 재확인 중 유지한다. 앱/worker 재시작과 다른 epoch는 기존 보수적 복구 규칙을 적용한다. backup은 같은 worker가 살아 있어도 result_unknown/recoveryUncertain을 우선하며, worker의 후속 exit 관측은 붙일 수 있으나 exited로 승격하지 않는다. main 소유 기록은 재확인 중 자동 prune하지 않는다. 해당 active 기록이 손상/누락되어 읽을 수 없으면 잠금을 해제하지 않는다.

worker barrier는 transfer quiescence와 실행 기록 tail settlement를 기다리고 기존 PTY 입력·원격 프로그램을 강제 종료하지 않는다. JSON 재검증 후 별도 내부 recovery-ACK 구간에서 오류가 있었던 실행/PTY의 최신 metadata만 다시 저장한다. main은 이 구간에 receipt channel만 열고 사용자 신규 변경은 계속 잠근다. ACK 완료 후에만 복구를 마치며 command·shell·input을 재요청하지 않는다. 늦은 channel acceptance도 이미 불명인 단계를 running으로 되돌리지 않는다.

232개 단위 검사·타입/build·actual main/utilityProcess/SSH 저장 fault·backup corruption 검사가 통과했다. 실제 동일 socket에서 실행7 정상 관측, 저장 fault 전후 PTY 입력, backup 불명 후 입력과 exit0/close의 불명 유지, 새 shell0개와 기록 오류 해제를 확인했다. 기존 terminal GUI/transfer engine 및 fault barrier 회귀도 통과했다. evidence/d10-storage-continuity에 출력과 source hash를 보존했다. 실제 disk-full/Windows 잠금·정전·지원 OS 수용은 미검증이며 D10 전체 완료가 아니다. 다음은 worker 재생성·종료/절전·probe다.

## 연결 엔진 교체·화면 충돌 복구

EngineGateway는 실제 worker exit 뒤에만 새 epoch/port/receipt channel로 교체한다. 이전 pending 요청은 거절하고 재전송하지 않는다. 이전 port·epoch의 event/exit가 새 상태를 바꾸지 못하며 이벤트 sequence를 새 epoch에서 초기화한다. main은 영수증/작업 settlement 후 사용자가 ‘연결 엔진 다시 시작’을 눌렀을 때만 utilityProcess를 생성한다. 초기화10초 내 ready가 없으면 해당 새 process를 종료하고 재시작 실패를 표시한다. 기존 프로필/영수증/창 metadata는 유지하되 재인증과 새 generation을 요구한다. 엔진 종료 후에도 session:list는 연결 해제 상태를 읽을 수 있다.

renderer 충돌은 native ‘화면 다시 열기/나중에’를 제공하고 승인하면 이전 BrowserWindow를 닫고 하나의 새 BrowserWindow를 만든다. 교체 중 window-all-closed가 작업을 종료하지 않도록 보호한다. 최대 동시 BrowserWindow는1개이며 internal 작업 창별 BrowserWindow는 만들지 않는다. main/worker와 기존 shell을 유지하고 main snapshot 및 고정 replay barrier로 화면을 복구한다.

renderer·engine 교체는 private-key picker/paste/execution preview 권한을 무효화한다. 늦은 native key 선택과 이전 BrowserWindow 입력으로 새 권한을 발급하지 않는다. engine loss 뒤 대기 중인 decrypt/re-encrypt가 새 generation의 secret을 덮어쓰거나 이전 인증을 재개하지 못하도록 현재 generation과 ciphertext 일치를 JSON writer 안에서 다시 검사한다.

237개 단위 검사·타입/build·실제 renderer crash와 utilityProcess SIGKILL GUI·기존 PTY GUI/저장 복구 회귀가 통과했다. 화면 교체 때 새 shell0개, 엔진 재시작 때 신규 인증0회, 이전 capability 거절, 명시적 재접속의 새 generation/PTY를 확인했다. native 복구 dialog 선택은 test main에서 대체했으며 OS modal 실기 검증은 아니다. evidence/d10-engine-lifetime에 출력·화면2장·source hash를 보존했다. D10의 앱 종료·연결 해제 확인/기한·절전·probe·메모리 제한과 지원 OS 검증은 남아 있다.

## 앱 종료·연결 해제의 확인과 공통 기한

native 확인에는 전송·대기·파일 변경·GUI 실행·PTY·미확인 수와 진행 작업의 서버/대상을 표시한다. 연결 해제는 username@host:port와 세대를 고정한다. 사용자 유지/취소는 자원을 변경하지 않는다. 승인 뒤 해당 세션 capability를 즉시 폐기하고 취소 가능한 전송·실행/PTY 채널 닫기를 요청한다. 최종 확정 중인 전송은 취소하지 않으며 같은 monotonic 기한 안에서 기다린 후 control을 닫는다. 다른 서버와 새 generation을 이전 요청의 늦은 callback으로 닫지 않는다.

앱 close와 before-quit은 동일 확인을 거친다. 승인 뒤 신규 변경/인증을 잠그되 결과 영수증 ACK는 계속 허용한다. 앱 전체는10초 상한의 프로세스 정리 여유를 위해 자원 정리에9.5초를 배정하고 그 시점에 worker 종료와 app.exit를 요청한다. 정상 정리가 먼저 끝나면 즉시 종료한다. 연결 해제의 비종료 절차는10초 공통 예산을 사용하며 취소 RPC가 미응답이어도 socket 닫기 요청을 기한에 발행한다. 종결되지 않은 원격 결과는 재실행하지 않고 기존 durable intent의 복구 규칙을 적용한다. OS 강제 종료나 OS 스케줄러 지연까지 절대 보장했다고 주장하지 않는다.

native 상세는 plain text·제어문자 escape·제한된 길이의 작업 행을 사용하며 생략 행 수를 표시한다. 원격 프로세스 전체 종료를 보장하지 않는 문구를 포함한다. renderer의 종료 중 상태는 저장소 손상 상태와 구별한다. native key/trust 승인 또는 disconnect의 오래된 completion은 새 generation의 상태·secret·연결을 변경하지 못하게 검사한다.

242개 단위 검사·타입/build·실제 app close/disconnect GUI와 Electron/session/file/viewer/renderer-crash/전송 GUI 회귀가 통과했다. 실제 SSH에서 GUI 실행+PTY 유지 선택, 승인 해제의 불명 결과, 전송1+대기1+실행1+PTY1의 종료를 검사했다. 최종 hardlink 응답을 고정 지연하여 deadline 경로를 실행했고 IPC 요청부터 프로세스 close까지 현재 호스트에서9685.775083ms를 관측했다. app 종료 뒤 fixture가 실제 link를 완료해도 재실행한 기록은 result_unknown이며 대기 전송은 cancelled, 신규 인증/명령 재전송은0회다. native 확인 응답·picker는 test main에서 대체했다. 이 관측은 지원 OS 전체10초 수용 판정이 아니다. evidence/d10-shutdown에 실제 출력·화면·source hash를 보존했다. 다음은 절전·probe·PTY 메모리 차단이다.

## 세대 교체의 실제 socket close와 key parser FIFO

worker는 control과 모든 auxiliary의 실제 close를 기다린 뒤 같은 서버의 다음 generation TCP client를 만든다. 닫는 중인 socket과 대기 중 connect reservation도 전역3서버 제한에 포함하며, 닫지 않은 과거 연결을 단순 disconnected 이력으로 prune하지 않는다. 시작 예약은 서버별 하나이며 대기 중 취소/closeAll은 새 client를 만들지 않는다. 이전 generation 재접속은 거절한다. pending 취소는 이전 close 완료 전에 응답할 수 있지만 이전 slot 소유권은 유지한다.

parser는 active1+queued2까지 FIFO로 소유하며 각 thread에5초 기한을 적용한다. terminate 완료 뒤 다음 thread를 시작하고 취소된 queued 요청은 thread를 만들지 않는다. 수락한 private-key Buffer는 완료/실패/취소 때0으로 덮는다. SessionManager가 인증 입력의 clone을 소유하며 들어온 RPC의 password/passphrase/key byte 참조는 outcome 뒤 지운다. 문자열과 OS dump의 물리적 완전 소거 보장은 아니다.

246개 단위 검사·타입/build·실제 session/engine 재생성/held-link 종료/전송 engine 회귀가 통과했다. close 지연·전역 closing3·대기 취소는 제어 가능한 transport fixture, key FIFO는 실제 worker_thread를 사용했다. 실제 서버/지원 OS의 지연 행렬 수용을 대신하지 않는다. evidence/d10-socket-retirement에 출력과 source hash를 보존했다. 다음은 절전·SSH 응답시간·PTY 메모리 차단이다.

## 절전 세대 무효화와 RPC 정리 용량

PowerMonitor의 suspend와 resume 모두 현재 세션 capability를 즉시 폐기한다. resume만 받은 경우에도 이전 연결을 유지하지 않는다. 새 인증/변경을 잠시 잠그고 취소·실행/PTY 닫기 intent를 요청한 뒤 같은 세대의 control disconnect를 즉시 발행한다. OS 절전은 최종 link를 기다릴 수 없으므로 이 경로는 최종 확정 대기를 하지 않으며 결과 불명 규칙을 적용한다. 자동 재접속·전송/입력/프로그램 재실행은 없다. 이미 종료된 engine의 disconnected 이력을 다시 disconnecting으로 만들지 않는다.

일반 RPC는24개, cleanup은28개, session disconnect는32개까지 허용하여 전체32개 상한 안에서 제어 여유를 둔다. main과 worker가 같은 정책을 사용한다. 전송 큐 취소는100개를 한꺼번에 요청하지 않고 동시4개로 처리하며 dispatch 전 REQUEST_BUSY만 제한 시간 안에서 대기한다. worker epoch가 바뀌면 이전 취소 루프를 중단한다.

248개 단위 검사·타입/build·실제 SSH를 사용한 모의 suspend/resume GUI·기한 종료·전송 GUI 회귀가 통과했다. 복귀 뒤 인증/입력/shell 재전송0회, 명시적 재접속의 새 generation, 선행 suspend 없는 resume 무효화를 확인했다. 100행 취소 동시성은 메모리 receipt adapter로 RPC 자체를 검사하며 실제100개 durable 등록 성능을 인증하지 않는다. 실제 OS sleep과 지원 OS 수용은 미검증이다. evidence/d10-power에 출력·화면·source hash를 보존했다. 다음은 SSH 응답시간과 PTY 메모리 guard다.

## Foreground SSH response and genuine channel closure

The main-owned probe measures only the active foreground server using the existing control SSH connection and the literal /bin/true. It does not create a new authentication, PTY, helper or ICMP ping. Samples require exit0 and genuine channel close within5s. Pending/closing probes retain their slot; subsequent attempts wait at least5s after actual close. Focus/selection/generation/epoch changes invalidate old results. Numeric values expire after15s from request start; rejection/output overflow disables this generation's probe without declaring the server disconnected. The header explains that network and server processing both contribute.

Real SSH testing exposed ssh2 1.17.0 paused readable channels withholding public close after protocol close. The version-pinned disposal adapter clears local Node buffers without draining output or fabricating a close event. Execution slots release only at actual channel or transport closure. Transport loss remains result_unknown and does not count its synthetic per-channel event as a known close, even when exit0 had arrived. A closed PTY can release while a sibling PTY stays usable.

263 unit cases, typecheck/build, actual probe GUI and terminal GUI passed. Foreground and native clipboard/disconnect decisions are mocked in test main; native OS focus and supported-target acceptance remain untested. Evidence: evidence/d10-probe. Next: renderer memory circuit breaker and D11-D13 implementation.

## Renderer working-set breaker

Main samples app.getAppMetrics() every1s, selects the current webContents OS PID, and divides memory.workingSetSize KiB by1024. Strictly greater than1536MiB twice consecutively blocks all existing PTY displays. Input capabilities are revoked synchronously; output pause is requested on the worker. Renderer disposes xterm and pending input before acknowledging the current main-issued token. An absent ACK for2s replaces only that UI. Worker execution requests, authentication and input are never replayed. A replaced/reloaded UI sees blocked descriptors and cannot automatically replay their ring. Only explicit New Display clears the ring and restores the existing channel.

265 unit cases, typecheck/build and real Electron memory GUI passed. Metric values are injected rather than allocating gigabytes; the renderer event loop is actually blocked and the UI process replaced. The first responsive path keeps the existing UI; both paths keep the worker epoch and shell count. This is not an OS OOM prevention guarantee or a supported-platform acceptance result. Evidence: evidence/d10-memory. Electron units reference: https://www.electronjs.org/docs/latest/api/structures/memory-info.

## Sequence repair, saved trust and redacted diagnostics

Session snapshots carry the worker event sequence; a late response can repair a missing server without overwriting a newer event for another server. Execution/PTY page resync restarts changing sequences up to3 times, checks monotonic offsets and bounds pages. PTY history is cleared when its owning control generation ends, and late output/restore are refused. Existing renderer text remains readonly until its window is closed.

Settings show endpoint/fingerprint/approval and credential ownership only. Native confirmation locks profile edits/connect/trust approval, closes affected endpoint profiles and pending work, then rechecks state inside the single JSON writer before deletion. Changed confirmation targets or unfinished work preserve trust. Secret ciphertext and reference are deleted together after that profile disconnects. No authentication is replayed; the next connection after trust deletion requires renewed approval.

Default logs accept only known error codes, task UUID, known transition states, time and app version. They have no generic message/stack/debug/body/host/path field, rotate active+2 files at1MiB and bound pending entries to128. Diagnostics include versions, counts and the latest100 validated rows. A60s main-owned one-use preview freezes exactly the JSON exported through the native save dialog, refuses overwrite and rejects stale renderer tokens. Export previews are text, never HTML. Receipt endpoint/path snapshots remain separate local records and are not described as anonymous.

277 unit cases, typecheck/build,45 security cases, actual xterm OSC/DCS/combining/huge-REP CSP fixture and16 integration suites passed on the current host. The initial integration run exposed a test reading the PTY receipt before its pending writer ACK; the harness now waits for recordPending=false and the complete rerun passed. Both reports are preserved in evidence/d11-settings-diagnostics. Native vault, picker/dialog decisions and foreground focus are mocked; all supported-target/signing/network-performance criteria remain untested. Node family fallback is disabled only in the connection utility process using the public setDefaultAutoSelectFamily(false) API: https://nodejs.org/download/release/v24.22.1/docs/api/net.html#netsetdefaultautoselectfamilyvalue.

## Desktop keyboard/window-cap UX and measured coverage gap

A failed window-limit request now opens the actual window list, with explicit select/close actions and no automatic eviction. Active-window Tab moves through visible controls and can leave via its taskbar entry; Enter on that entry returns focus into the selected window. PTY textarea Tab remains remote input. Minimized contents become inert immediately while the150ms fade/scale completes; reduced-motion disables transitions. Actual desktop GUI and PTY minimize/reload regression passed on this host.

The exact MIT @vitest/coverage-v8 5.1.0 provider was added for Vitest5.1.0 (registry integrity sha512-OY9aShBQG5KOIw2zCo9fDoCHI9RHliNHJ//nM7m6jGg41Hyke9JOGWmeMlK74xYErsxMoK8mIB3gAeEyFVA7LA==). Coverage enforces statement90/branch85 per included file. Startup process entrypoints and the separate parser-thread entrypoint are excluded from unit instrumentation and exercised by real process fixtures. No other failing module is excluded to claim success. The initial full measurement was77.79/68.49; added capability/key/diagnostics/profile tests raised the retained measurement to83.13/73.75, still FAIL. Subsequent5 schema/geometry tests have not yet been remeasured.313 unit tests and typecheck pass; this does not close the coverage requirement.

Tests now instrument the parser coordinator source while retaining real compiled parsing threads, rather than measuring only an uninstrumented compiled coordinator. Key IO now maps every filesystem failure to fixed KEY_INVALID and does not forward local paths. New tests include queued parser cancellation/termination, bounded key files, stale file paging, secret ownership, native export generation/expiry/overwrite refusal and profile-key authority. Evidence: evidence/d11-desktop-coverage. Next includes late file mutation acknowledgement metadata, remaining coverage and performance before distribution work.

## Late file-mutation observations and storage reconciliation

A mutation callback arriving after timeout emits at most one immutable observation for mkdir/delete/link/source removal. It carries the original task/server/generation/epoch/operation/paths and UTC observation time. Main validates these against the existing receipt, appends at most2 unique stage observations, and changes only observed metadata; it does not change an unknown/partial result to completed, release restrictions, resend a request or resurrect a forgotten receipt. The strict optional lateObservations field preserves old v1 receipts without inventing observations on load. Task detail labels the late observation separately from its original result.

Pending observation writes count as active metadata work and block record closure. Save failure keeps the observed facts in a main-memory warning overlay. Explicit storage verification waits for writers, compares full immutable receipt identity, retains the verified/recovered disk phase and backup uncertainty, persists matching facts, then clears the warning only after ACK. Missing or changed receipts remain blocked. Ordinary mutation cleanup now stays owned until its finish RPC settles.

318 unit tests, typecheck/build and file GUI regression passed. The late-success fixture uses controlled callbacks plus fake time after15s; it does not claim an ACK can cross a destroyed TCP socket. Gateway routing, main JSON persistence, duplicate/stale identity rejection, no replay, no resurrection and storage failure/reconciliation are separately checked. Actual disk-full/power-loss/target matrix remain user-owned verification. Coverage still fails its recorded thresholds; this implementation does not complete D11. Evidence: evidence/d11-mutation-observations.

## Instrumented SSH lifecycle and remaining coverage

344 unit tests pass. Added real loopback control-session tests exercise the instrumented SessionManager for trust-before-auth, OS/SFTP/home inspection, OS restrictions/confirmation, bad password, changed host key and scoped quarantine. Additional tests cover execution recovery/cleanup/action authority, receipt replay/pending/ACK failure limits, storage timeout, OS-secret failure/rotation shapes, recovered trust retry, slot/ancestor/local-alias locks and asynchronous native-paste lifetime. Physical clipboard/vault and native target behavior remain separate.

Boundary investigation found URL/IDNA reinterpretation accepting127.00.0.1,0x7f000001 and[example.com]. normalizeHost now accepts brackets only around a valid IPv6 literal and refuses a fallback DNS conversion that becomes a legacy IPv4 address. Stored canonical endpoints remain unchanged. The actual session GUI regression passed after this correction.

The retained measurement before the latest2 native gesture tests is statement85.63%,branch76.89%;38 files still fail one or both per-file90/85 thresholds. The coverage command correctly exits nonzero, and evidence/d11-coverage-security retains the failure report. D11 remains incomplete; neither test count nor line coverage is substituted for the statement/branch requirement.


## D12 preparation while target acceptance remains open

The existing packaging script refused all builds until release_ready=true, which prevented creating the development artifacts needed for target verification. package:win/package:mac now prepare development artifacts from a clean committed source tree, with unsigned Windows/ad-hoc macOS labels, no publisher credential discovery, no notarization claim and releaseReady=false in build metadata. The pipeline builds production renderer inputs, applies the six specified fuses before signing, excludes tests and host native accelerators, verifies packaged notices/fuses and macOS ad-hoc signatures, and writes hashes, source revision, lockfile hash and corresponding source archive. Actual package execution/results are recorded separately after the first build; this entry describes implementation only. Supported-target tests and real publisher signing remain untested.

Settings now provides bounded UTF8 license pages through two named IPC methods. Fixed IDs resolve only generated local license files; schema, size, SHA256 and no-symlink checks precede plain-text display. Project AGPL, runtime dependencies, Electron MIT and the complete upstream Chromium/Electron notice are retained. afterPack replaces host notices with the exact target distribution notices before signing. A CycloneDX runtime inventory accompanies the package. Optional cpu-features/nan/buildcheck and sshcrypto.node accelerators are excluded, retaining ssh2's JavaScript fallback. License generation refuses unknown runtime license metadata. Build-tool and bundled-component license/reachability review is still required before public release.

352 unit tests and typecheck/build passed. Actual Electron settings integration passed for project notice, raw upstream HTML shown only as text and next-page navigation, alongside existing trust/secret/diagnostic checks. The first added GUI assertion expected uppercase DOCTYPE while the source uses lowercase; only the assertion was corrected. The retained coverage measurement before license implementation is statement86.68%,branch79.06%; image predecode validation is99.67%/99.67%. The overall per-file coverage gate remains failing.

Primary packaging references inspected: https://www.electronjs.org/docs/latest/tutorial/fuses and https://www.electron.build/tutorials/adding-electron-fuses/ . Installed electron-builder26.18.0 implementation confirms fuse application before signing, pure-JavaScript Windows resource/integrity editing, and target Electron license retention. No package pass is inferred from this source inspection.


The first real macOS cross-architecture build produced ZIPs but archive inspection found199 dependency test files in Zod. The packaging gate correctly rejected this result; these artifacts are not passing packages. Added dependency test/example exclusions and a final source-revision/cleanliness recheck to reject code edits during assembly. The corrected package build is a separate run.


## Real package inspection and local performance measurements

At source80504518a8d6, Windows portable and both macOS ZIP builds completed. Compressed sizes were112384417/120588853/127796632 bytes (Windows/mac-arm64/mac-x64), all below250MiB. macOS ad-hoc verification, six fuses and packaged notices passed. A subsequent stronger static audit compared the embedded ASAR header hash with the actual archive and checked every member hash: macOS passed925 files per architecture with unpacked sizes295191442/302425426 bytes. These are development artifacts, without native target launch, publisher signature, notarization or performance acceptance.

The stronger audit found ssh2/util/pagent.exe in Windows. electron-builder's smart unpacking had consequently placed all SSH JavaScript outside ASAR. The initial limited Windows report is preserved but explicitly superseded by this finding. Added helper exclusion, smartUnpack=false and an empty asarUnpack list; the complete member audit now refuses every unpacked/symlink/unhashed member and native helper. The corrected Windows artifact requires a separate build. Build metadata now distinguishes reproduction commands from actually executed packaging steps.

The old performance placeholder was replaced by an actual local harness:5 independent100-row durable JSON registrations through TransferController (in-process worker RPC adapter),5 warm actual Electron launches to enabled controls,100 trusted UI clicks measured to two renderer animation frames and one whole-app memory snapshot. The command exits2 and records target acceptance as untested because it does not provide the specified native/network/settled-memory/full-load matrix. It never labels the single memory sample a300-sample p95.

Before optimization100-row registration took8842.5–9085.9ms. ReceiptRepository.checkNew repeatedly cloned/sorted every receipt for each batch claim. A revision-bound unresolved-row cache avoids repeated history scans; every save/acknowledgement/deletion invalidates it. The same local harness then measured1041.0–1188.2ms. These observations are not a supported-target performance claim or competing-app comparison. Source hashes and dirty-source status are retained in each report.

367 unit cases passed, including main desktop authority/caps, pinned paused-channel disposal without synthetic close,32-entry viewer FIFO, probe epoch/cancellation/failure and storage reconciliation failure. Coverage improved to87.68% statements/80.22% branches;29 files still fail the per-file gate. Desktop, channel-close, read-pool, engine-gateway, both storage-recovery modules and license reader now pass their individual thresholds. Evidence: evidence/d12-artifacts-and-performance.


## Structured errors and verification handoff

375 unit tests and all17 integration suites pass. A shared error-presentation model now provides code, the specification's fixed Korean userMessage, confirmedPhase, affectedTarget, actions and allowlisted technicalDetails. Profile, file, viewer, mutation/transfer/exec confirmations, execution/PTY output, task details and settings use the same plain React error panel. Task summaries carry the actual recorded lastConfirmedPhase; unknown/partial outcomes take priority over a generic transport/storage message. Absent confirmed metadata is shown as absent rather than inferred. Raw bridge exception text and generic SSH debug are not rendered. Additional fixed local codes cover executable-bit refusal, input queue limit and clipboard failure. The technical-detail summary has an explicit tab stop for the internal window focus manager.

The first two integration attempts failed only on obsolete viewer/memory wording assertions. They now verify the fixed specification wording; the viewer also checks the exact error code and target. The complete third run passed with sourceUnchanged=true. A security smoke run exposed a test sampling window bounds during the150ms minimize/restore animation; the assertion now waits for the exact original coordinates, with no coordinate tolerance or weakened product requirement. Its corrected rerun is recorded separately.

Latest instrumented coverage is88.02% statements/80.71% branches;26 files still fail the per-file90/85 gate. It remains an explicit failure. CONTRIBUTING.md, SECURITY.md, NOTICE, native-validation and G0/G2/G3 evaluation status describe contribution, artifact verification and user-owned target tests. No user study has been performed and no demand claim is made. Static corrected Windows inspection now passes the embedded header hash and923 ASAR member hashes with no smart-unpacked SSH code. Evidence: evidence/d11-structured-errors.


The corrected security rerun passed49 focused unit cases and the actual Electron/xterm CSP/OSC/REP/clipboard fixture. A missing expect import in the amended smoke script caused one intermediate ReferenceError; the import was added before the passing rerun. Both intermediate failures and the passing report are retained. No product requirement, geometry tolerance or security assertion was removed.


## Windows launcher notices and security toolset pin

The launcher review found an old implicit NSIS default outside npm audit's inventory. Pinned toolset1.2.1 (vendor NSIS3.12 bundle) addresses the legacy pre3.11 temporary-plugin-directory issue and the3.12 elevated-temp correction. The exact archive SHA256 and actual Mac compiler build string are checked. portable.useZip selects electron-builder's direct-file/built-in-zlib template branch, eliminating Nsis7z/nsisunz from this launcher.

Official StdUtils1.14 binary/source assets were downloaded for read-only review inside the workspace. The Unicode DLL hash matches both bundled toolsets exactly. Original notices and the full corresponding source archive are committed, added to Windows resources before signing, and included in SBOM component records. Windows package preparation rejects changed source/notice/DLL hashes. Owned review downloads were removed after the reviewed copies were preserved. The complete corrected portable build is the next verification; no native Windows launch or public-release claim is made.


## Protocol error boundaries and measured per-file coverage

An actual SFTP FAILURE description could become a persisted app error code when the description matched an uppercase pattern. A failing regression demonstrated the issue. Transfer status codes now own classification; untrusted descriptions such as AUTH_FAILED or SENTINEL_REMOTE_TEXT map to INTERNAL_ERROR for generic protocol FAILURE. Shared allowlisted app codes are preserved only for internal failures without a protocol/native status. Worker receipt/RPC boundaries use the same allowlist. Real loopback SFTP transfer tests confirm the description is absent from stored receipts and the control connection remains usable.

Transfer snapshot repair now checks backend epoch, strictly increasing offsets, at most100 pages and3 attempts. An incomplete bounded snapshot never removes a job by inferred absence. PTY paste validation counts its separately specified64KiB UTF8 body independently from JSON escaping and enforces the64KiB control metadata limit. Actual Electron accepts exactly64KiB ASCII, newline and Korean combinations for preview, refuses excess bytes and sends none of the preview text to SSH. Ordinary key input remains bounded to4KiB frames.

A second failing regression showed a15s timer retained after a synchronous SFTP inspection exception. The timer is now cleared in that exception path. Added tests cover read cancellation, late callbacks, storage replacement/recovery, native file identity, worker launch/cleanup, queue staging, unknown outcomes, record confirmation, paste/input ownership and socket retirement. All534 cases and all configured per-file statement90/branch85 gates pass: aggregate statement96.06%,branch91.55%. No threshold was reduced and no additional failing module was excluded. This closes the recorded unit-coverage gap; it does not certify the152 compound target acceptance rows. Typecheck and61 focused security cases plus actual Electron/xterm pass. The current-source17-suite integration result is recorded after that run finishes. Evidence: evidence/d11-boundaries.

The pinned NSIS development portable build at eb777ee7c25e completed with20 verified notices,925 hashed ASAR files, matching embedded integrity, six configured fuses, no unpacked SSH/helper/test code and a verified StdUtils source archive. Its162142176-byte unsigned EXE is below250MiB. Read-only extraction confirmed the embedded StdUtils DLL matches the official hash and neither Nsis7z nor nsisunz is present. This is a historical build before the current runtime fixes; final artifacts require rebuilding. Evidence: evidence/d12-windows-launcher.


The complete current-source17-suite integration rerun passed with sourceUnchanged=true. It includes real main/worker/SSH/SFTP and PTY GUI flows, exactly64KiB paste preview boundaries, storage/engine/suspend/shutdown recovery, probes, display-memory guard, local-license/settings/diagnostics and desktop keyboard/window-limit behavior. The security rerun passed61 focused cases and actual Electron/xterm. Native dialog/vault/focus substitutions and current-host limitations are preserved in each report.


## App-owned Chromium networking policy

Final startup audit found the security harness supplied background-networking/component-update flags while the application entrypoint did not. The app now sets both switches before ready and disables the spellchecker on the live default Session and each BrowserWindow. The security harness removes its private flags and asserts actual app switches and Session state. Electron documents default spellcheck and Google-CDN dictionary downloads on Windows/Linux: https://www.electronjs.org/docs/latest/tutorial/spellchecker . This closes a configuration gap without claiming a native packet capture or that a dictionary request was observed on the current Mac.

The first amended assertion inspected getLastWebPreferences().spellcheck, which macOS omits even with the explicit option. It failed with undefined; the assertion now checks the public live Session.isSpellCheckerEnabled() API. The final61-case security/Electron run and all17 integration suites pass with unchanged source during each run. The534-case per-file coverage inputs are byte-identical to their passing measurement; only the separately process-tested main entrypoint and security smoke changed. The comparison is retained in evidence/d11-network-policy. The v6 document consistency check also passes with38 requirements/13 tasks/152 checks and unchanged approved scope digest.

A separate implementation-traceability document maps all38 R IDs to actual code, local evidence and remaining target/human gates. Historical planning status text is not silently rewritten as acceptance evidence. Development packages created at e9a13b3 precede this networking correction and are superseded for final handoff by the next committed-source rebuild.


## Final development artifact and CI handoff

All three development artifacts were rebuilt from clean commit da5cb45d59f6a6943bbd885cfd7960961b9625c4 after the app-owned networking correction. Windows EXE162143407bytes, macOS arm64ZIP120592058bytes and x64ZIP127799838bytes pass250MiB compressed/750MiB unpacked limits. All925 ASAR members per target have verified hashes, embedded header integrity matches, six fuses pass, test/native helper code is absent, notices are verified, and macOS ad-hoc signatures pass deep/strict verification. Source revision, lock hash, SHA256SUMS and corresponding source archives are retained. Native launch, publisher signatures and notarization remain untested/unavailable. Evidence: evidence/d12-final-development.

GitHub CI for da5cb45 failed the documentation validator because the final README edit retained its old artifact/status hashes. The local validator had last run before that README edit. The README artifact hash, spec file hash and planning status now agree; the approved scope digest is unchanged and the corrected local validator passes. The original CI failure is retained in evidence/d13-handoff. No product check or protected workflow was weakened.

The existing PR description still described the initial15-test foundation and said SSH was unimplemented. A repository-local human metadata wrapper was added because the supplied global wrappers have no PR edit operation. It runs the existing server guard, validates canonical repository/current head/base/head refs/human author/assignee, repeats checks immediately before writing only title/body, and verifies the result. It cannot review, merge, delete branches, change protection or modify global configuration. Five standalone boundary tests pass. Final current-head independent review remains required.
