# sshOS(시오스) v5 기능·품질·보안 체크리스트

기준일: 2026-11-14. 대상: 0.1.0. **제품 구현 미착수이며 아래 모든 검사는 `untested`다.** 이 문서는 [제품 계획서](01-product-plan.md)와 [개발 계획서](02-development-plan.md)의 계약을 검사 단위로 연결한다. 새로운 정책·지원 범위·수치를 추가하지 않는다. 수치·알고리즘의 규범은 개발 계획서, G0·G2·G3의 규범은 제품 계획서 §9다. 충돌 시 해당 검사를 임의 완화하지 않고 명세 충돌로 기록한다.

## 검사와 실행 환경

- `F`는 기능·상태 계약, `Q`는 품질·환경·공개 판정, `S`는 신뢰·보안 계약이다. 한 행이 독립 검사 단위다. 행 안의 열거는 같은 계약을 검증하는 fixture 집합이며 일부 사례만 통과해서 행 전체를 pass로 바꾸지 않는다.
- 방법은 `automatic`(자동화된 단위·통합·UI·장애 주입), `visual`(이미지·화면 검수), `manual`(기록된 사람의 절차), `target`(실제 지원 OS·파일시스템·SSH 서버·배포물 검사) 중 하나다. `target`과 `manual`을 mock만으로 대체하지 않는다.
- 기본 서버 fixture는 개발 계획서 §14의 보안 업데이트가 적용된 Ubuntu 24.04 LTS·OpenSSH·ext4·일반 사용자다. 서버 CPU 두 종류와 클라이언트 세 target을 구분한다. 제한·장애 서버는 격리된 시험 환경에만 만든다. 실제 사용자 서버를 기본 시험 대상으로 삼지 않는다.
- 성능 행은 §14의 RAM·SSD·CPU·네트워크 기준, 5회 반복과 nearest-rank 계산을 공통으로 적용한다. 테스트 파일·캐시·증거는 승인된 작업 루트 또는 별도로 허가된 시험 PC에만 저장한다.
- 모든 행의 `필수=yes`는 해당 납품 단계에서 통과해야 한다는 뜻이다. 사용자 검증 행 Q019–Q021은 G0·G2·G3의 해당 시점에 수행하며 기술 검사의 대체 근거가 아니다. 외부 pilot 전 기술 검사와 정식 공개 판정의 순서는 제품 §9 및 개발 §15를 따른다.

## F — 기능과 상태 계약

| ID | 요구 | 방법 | 준비와 동작 | 합격 기준 | 필수 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| F001 | R01,R04 | manual | 빈 프로필의 패키지 앱에서 등록→호스트 확인→인증→탐색→전송→결과 확인을 수행한다. | 제품명은 sshOS(시오스)이며 전체 기본 흐름을 콘솔 명령 입력 없이 완료한다. 서버 데스크톱 설치나 화면 전송을 요구하지 않는다. | yes | untested |
| F002 | R05 | automatic | 프로필 10개와 name·host·port·username의 §5 최소·최대·초과·금지문자 경계값을 입력한다. | 11번째 프로필과 범위 밖 입력은 거절한다. 포트 기본값은 22이며 name 1–64 scalar, host 253byte 이하, port 1–65535 정수, username UTF-8 1–256byte를 적용한다. | yes | untested |
| F003 | R05 | automatic | 대소문자 DNS·IDN·끝점·IPv4·괄호 IPv6·scheme·경로·공백을 가진 host를 등록한다. | DNS는 domainToASCII 후 소문자·끝점 하나 제거, IPv6는 저장 시 괄호 제거다. IP parser 실패·scheme·경로·사용자정보·공백은 거절하며 serverId는 UUID v4다. | yes | untested |
| F004 | R05 | automatic | 연결 중·미해결 작업 보유·미연결 프로필 각각에서 이름·endpoint·username·인증 방식·삭제를 요청한다. | endpoint 또는 username 변경은 새 serverId 복제이며 기존 프로필 유지다. 연결·미해결 상태에서는 규정된 수정·삭제를 막고, 표시 이름 변경 후 기존 task snapshot은 유지한다. | yes | untested |
| F005 | R07 | target | password와 암호화/비암호화 OpenSSH v1 Ed25519·RSA 2048bit 이상·PKCS#1 RSA PEM으로 실제 인증한다. 잘못된 암호도 입력한다. | 지원 형식의 정상 인증과 passphrase 처리가 성공한다. 실패는 입력 방식 한 번으로 끝나며 password↔key fallback·자동 반복이 없다. | yes | untested |
| F006 | R08 | automatic | 연결 성공·취소·인증 실패·새 호스트 승인·rekey·수동 재접속 이벤트를 상태 reducer에 전달한다. | §6의 연결 전이만 발생한다. 연결 시도마다 새 generation, rekey는 기존 generation 유지, 승인 대기는 socket이 닫힌 awaiting_host_trust다. | yes | untested |
| F007 | R08,R14 | target | 프로필 3개를 연결하고 4번째 연결을 요청한 뒤 실제 전송을 시작·종료한다. 프로세스와 socket을 관측한다. | 앱당 utilityProcess 1개, 동시 연결 최대 3개, 서버별 control 1개와 전송 중 transfer 최대 1개다. 유휴 transfer를 미리 열지 않고 task 종료 후 닫는다. | yes | untested |
| F008 | R08,R18 | target | 서버 접속 제한으로 transfer만 거절하거나 종료하고, 별도 사례에서 control을 종료한다. 다른 서버 작업도 실행한다. | transfer 실패는 해당 task만 영향받는다. control 종료는 같은 서버 transfer를 닫고 queued를 interrupted로 바꾼다. 다른 서버는 유지하며 control 전송 전용 전환·자동 재접속이 없다. | yes | untested |
| F009 | R09 | target | SSH 인증은 되지만 SFTP subsystem이 없는 서버에 연결한다. | 연결 정보는 유지하고 파일 앱만 잠근다. SFTP_UNAVAILABLE을 표시하며 셸·SCP·helper 방식으로 파일 기능을 우회하지 않는다. | yes | untested |
| F010 | R09 | automatic | SFTP realpath와 os-release fixture에 Ubuntu 24.04·다른 OS·읽기 실패·중복키·형식 오류·16KiB 초과를 제공한다. | realpath('.')가 초기 폴더다. /etc/os-release는 최대 16KiB만 읽으며 정상 ID/VERSION_ID로만 판정한다. 읽기·형식 실패는 unknown이며 내용을 실행하지 않는다. | yes | untested |
| F011 | R09 | target | supported·unsupported·unknown 및 chroot/SFTP-only fixture에서 조회·전송·변경을 요청하고 unknown 확인 후 재접속한다. | unsupported는 조회만 허용한다. unknown은 세션별 사용자 확인 후 기능을 열되 ‘OS 미확인 · 사용자 확인’을 유지하고 재접속 시 확인을 상속하지 않는다. exec 제한은 probe만 제한한다. | yes | untested |
| F012 | R10 | automatic | 원격 POSIX 절대경로·basename 255byte/초과·전체 4096byte/초과와 §7 금지문자·NFC/NFD·대소문자 fixture를 처리한다. | 범위 밖·손실 이름은 동작을 막는다. rawName과 표시명을 분리하고 escape·정규화·Windows path.join으로 실제 원격 이름을 변형하지 않는다. | yes | untested |
| F013 | R10 | target | remote symlink·FIFO·socket·device·미확인 type, local lstat 식별 symlink/junction·UNC와 선택 후 type 변경을 시험하고 미지원 위치 설명을 확인한다. | 링크·특수파일 동작과 UNC를 거절하고 fstat·mutation 직전 lstat/parent realpath를 재확인한다. 모든 reparse tag/cloud placeholder·volume 종류를 자동 탐지한다고 주장하지 않으며 지원 범위는 로컬 일반 파일·폴더로 설명한다. | yes | untested |
| F014 | R11 | automatic | 점 항목·숨김 파일·폴더·동명이형 이름 및 10,000항목/10MiB 경계 목록을 읽고 필터·토글·새로고침한다. | 점 항목 제외, 폴더 우선 code-point 정렬, 숨김 기본 표시다. 상한 초과는 handle을 닫고 일부 목록을 명시한다. 필터는 읽은 이름만 대상으로 하며 재귀 스캔이 없다. | yes | untested |
| F015 | R04,R11 | automatic | 서버 A/B의 파일 탭을 바꾸면서 이전 directory request의 응답을 늦게 전달하고 7번째 탭을 연다. | 최대 6탭이며 늦은 응답은 다른 탭 목록을 덮지 않는다. 서버·경로는 탭에 귀속되고 화면 전환이 실행 중 task의 대상을 바꾸지 않는다. | yes | untested |
| F016 | R10,R16 | target | Windows 금지문자·예약명·끝 공백/점, macOS 금지 이름, case-insensitive·Unicode alias 충돌 목적지를 다운로드한다. | 이름을 자동 치환하지 않고 다른 이름을 요구한다. 실제 최종 exclusive link가 충돌을 판정하며 기존 파일의 bytes와 이름을 보존한다. | yes | untested |
| F017 | R12 | target | 없는 단일 이름·기존 이름·중간 부모 없음 fixture에서 새 폴더 preview를 승인한다. | intent 저장→mkdir(0700)→ACK→lstat(directory)→receipt 순서다. 기존 이름은 충돌, 중간 부모 자동 생성은 없으며 결과 target이 승인 preview와 일치한다. | yes | untested |
| F018 | R13 | target | 일반 파일·빈 폴더·삭제 직전 항목이 생긴 폴더·루트·진행 중 경로를 삭제한다. | 파일 unlink와 폴더 rmdir만 사용한다. 루트·작업 중 경로·비어 있지 않은 폴더는 삭제하지 않으며 rmdir 최종 결과를 따른다. 재귀·shell rm fallback이 없다. | yes | untested |
| F019 | R13 | target | 같은 폴더의 일반 파일을 없는 이름·기존 이름으로 바꾸고 폴더·링크·다른 폴더 이동도 시도한다. | 허용 사례는 intent→hardlink(source,newName)→ACK 기록→unlink(source)→ACK 기록이다. 기존 목적지를 보존하고 폴더·링크·이동은 거절한다. | yes | untested |
| F020 | R13,R19 | automatic | rename에서 hardlink 성공 뒤 source unlink 실패 또는 ACK 유실을 주입한다. | 확정 실패는 partial과 두 경로, ACK 유실은 단계가 붙은 result_unknown이다. source 자동 재삭제와 새 이름 rollback 삭제가 없다. | yes | untested |
| F021 | R13,R14 | automatic | 같은 경로/조상의 삭제·rename, 전송 source 변경, 같은 parent의 다른 자식 생성·전송과 읽기를 동시에 요청한다. | 보호 중 경로·조상을 바꾸는 mutation만 대기한다. 같은 parent의 다른 자식 생성·전송과 조회는 허용한다. terminal·receipt·늦은 요청 정리 전 lock을 풀지 않으며 외부 writer 통제 보장은 없다. | yes | untested |
| F022 | R14 | automatic | A 서버 작업 여러 개를 먼저 넣고 B/C 작업을 넣은 뒤 취소와 enqueue를 경합시킨다. | 전체 슬롯 2·서버별 1이며 준비부터 검증·확정·최종기록까지 점유한다. 실행 가능한 가장 오래된 (enqueuedSequence,taskId)를 선택하고 A 대기가 B/C를 막지 않는다. | yes | untested |
| F023 | R14 | automatic | 100개/101개 선택·대기 상한 초과 및 유효·충돌·미지원 파일 혼합 선택을 제출한다. | 상한 초과 요청은 전체 거절한다. 혼합 preview는 모든 항목을 나열하고 유효 항목 진행/전체 취소를 받으며 조용히 누락하거나 자동 이름 접미사를 만들지 않는다. | yes | untested |
| F024 | R15,R16 | automatic | 0byte·5GiB·64GiB·64GiB 초과 파일과 enqueue 후/전송 중 size·mtime 변경을 주입한다. | 허용 크기는 0–64GiB이며 offset은 안전 정수다. 같은 source handle을 유지하고 시작·마지막 fstat 변화는 SOURCE_CHANGED로 중단한다. 시점 snapshot 보장을 표시하지 않는다. | yes | untested |
| F025 | R15,R16,R19 | automatic | `.sshos-<taskId>.part` 기존 충돌, 생성 ACK 유실, created 저장 실패를 업로드·다운로드에 주입하고 순서를 기록한다. | 양 방향 모두 durable intent 성공→wx/0600 생성→durable created 성공 후 byte 전송이다. 충돌 temp 보존, ACK 유실 result_unknown, created 실패는 전송 없이 socket 종료다. 패턴만으로 소유권을 추정하지 않는다. | yes | untested |
| F026 | R15,R17 | automatic | 지연·역순 write ACK와 느린 source를 제공하여 업로드 요청·메모리·진행량을 관측한다. | 32KiB chunk·미완료 write 최대 16개와 backpressure를 적용한다. ACK 받은 byte만 진행에 반영하고 전체파일 Buffer·임의 동일 offset 재전송을 만들지 않는다. | yes | untested |
| F027 | R15,R17 | target | 0byte·일반·실제 5GiB 파일을 업로드하며 source hash·EOF·write ACK·remote close·temp lstat·read-back 결과를 수집한다. | 모든 write/close와 size 확인 뒤 같은 transfer SFTP에서 temp 전량 read-back의 SHA-256·byte를 대조한다. 빈 파일도 empty hash·close·size 검사를 생략하지 않는다. | yes | untested |
| F028 | R15,R17 | target | 업로드 후 READ 금지 또는 temp byte 변조 fixture로 검증을 실패시킨다. | 각각 VERIFY_READ_DENIED 또는 VERIFY_MISMATCH다. final link를 보내지 않으며 원격 checksum 명령·검증 생략으로 우회하지 않는다. | yes | untested |
| F029 | R15,R19 | target | 업로드 검증 뒤 finalize_intent_pending·durable intent·hardlink 사이에 기존 destination을 만들고 정상 사례도 수행한다. | intent 저장 성공 후 finalizing에서만 hardlink(temp,destination)를 보낸다. 충돌 보존, 정상은 ACK→destination 일반파일·size 확인→생성 기록→temp 정리→완료 기록 후 completed다. | yes | untested |
| F030 | R09,R15 | target | hardlink 확장 미지원·EXDEV·권한 오류를 사용자 업로드/rename에서 발생시키고 로그인 통신도 관측한다. | 해당 기능은 실패·제한된다. rename/posix-rename/copy/destination unlink/helper fallback이 없고 로그인 시 지원 탐지용 임의 파일을 만들지 않는다. | yes | untested |
| F031 | R15,R16,R19 | automatic | final destination 확인 후 temp 제거 실패·ACK 유실·완료 receipt 저장 실패를 각각 주입한다. | 정리 실패는 completed+needed, 정리 ACK 유실은 completed+unknown이다. destination rollback 삭제는 없다. 기록 실패는 목적지 생성 확인 경고와 새 mutation 잠금이며 재시작 시 남은 finalizing은 result_unknown이다. | yes | untested |
| F032 | R16 | automatic | 5GiB 이상 원격 파일의 short read·short local write·지연 read를 주입하며 다운로드한다. | 32KiB chunk·미완료 read 최대 16개, 실제 길이에 따른 잔여 처리를 지킨다. offset을 32bit로 절단하지 않고 동일 source handle에서 전체 bytes를 순서대로 저장한다. | yes | untested |
| F033 | R16,R17 | target | 로컬 APFS·NTFS에서 실제 5GiB 다운로드 및 local sync·close·read-back 실패를 주입한다. | source 마지막 fstat·remote close·local sync/close·temp 재개방 hash/size 확인 후 finalize_intent_pending→durable intent 성공→finalizing→fs.link 순서다. 검증 실패는 final 생성으로 넘어가지 않는다. | yes | untested |
| F034 | R16 | target | 다운로드 최종 확정 직전에 destination을 만들거나 fs.link를 실패시키고 UNC·hardlink 미지원 목적지도 선택한다. | existing/alias 충돌·UNC·hardlink 미지원은 실패한다. local rename·COPYFILE·기존 파일 삭제 fallback이 없고 기존 destination을 보존한다. 미지원 volume 전체를 자동 탐지한다고 주장하지 않는다. | yes | untested |
| F035 | R12,R15,R16 | target | 실행권한·mtime·소유자·ACL·xattr가 있는 파일을 전송하고 새 파일·폴더의 요청 mode와 설명을 확인한다. | 새 upload 파일 요청 0600·mkdir 요청 0700이다. 원본 mode/owner/ACL/mtime/xattr를 복제하거나 동일하게 보존했다고 표시하지 않는다. 다운로드가 원격 실행권한을 복제하지 않는다. | yes | untested |
| F036 | R17 | automatic | 0byte·일반 파일의 ACK/로컬 write와 검증 read 진행 이벤트를 전송 완료 경계에 전달한다. | byte는 단조 증가하고 total을 넘지 않는다. 0byte는 byte단계 끝 전 0%, 이후 100%다. 검증은 별도 verifiedBytes와 ‘내용 확인 중’이며 200%·조기 완료가 없다. | yes | untested |
| F037 | R17 | automatic | monotonic 시간으로 3초 창·첫 sample·3초 정지·terminal·고빈도 이벤트를 재생한다. | 최근 3초 실제 처리량/경과시간으로 속도를 계산한다. 첫 sample 전·3초 무진전은 —, 검증은 검증 속도, terminal은 속도 없음이다. 최대 4Hz·terminal 즉시·UI 1초 이내이며 ETA가 없다. | yes | untested |
| F038 | R18 | automatic | 아직 슬롯을 얻지 못한 queued 전송을 취소한다. | cancelled로 종료하고 socket·temp를 생성하지 않는다. 다른 queued/실행 task의 상태와 순서를 임의 변경하지 않는다. | yes | untested |
| F039 | R18 | target | preparing/transferring/verifying에서 취소하고 소유 temp 확인 가능/parent 변경/불명 socket 사례를 만든다. | 수락 즉시 cancel_requested·새 I/O 중지, 5초 내 해당 stream/socket만 닫는다. 소유·세션·연결 조건이 맞을 때만 1회 정리 가능하며 불명 경로는 자동 삭제하지 않는다. | yes | untested |
| F040 | R18 | automatic | 취소와 finalize_intent_pending 진입을 양 순서로 경합시키고 durable intent 저장 지연·실패를 주입한다. | cancel_requested가 먼저면 link 없음이다. pending이 먼저면 저장 대기 중에도 CANCEL_TOO_LATE·취소 비활성이다. 메모리 pending 동안 디스크에는 phase=finalizing·dispatchAllowed=true를 저장한다. 저장 성공 ACK 뒤에만 link를 보내며 실패는 STORAGE_FAILED·link 없음이다. pending은 디스크에 저장하지 않고 문구는 §8.4와 일치한다. | yes | untested |
| F041 | R08,R18 | automatic | 인증 ready·SFTP 응답·readdir·전송 ACK/검증 read를 각 고정 기한 전후로 지연시킨다. | SSH 20초, 요청 15초, 디렉터리 전체 60초, 전송 무진행 30초를 적용한다. 유효 진행은 전송 기한을 갱신하며 전체 파일 시간 상한을 추가하지 않는다. | yes | untested |
| F042 | R19 | automatic | mkdir/delete/rename/temp 생성/final link의 ACK를 유실하고 종료·timeout 후 늦은 callback을 전달한다. | 변경 가능성이 남으면 단계별 result_unknown이다. 명시적 실패와 단절을 구분하며 늦은 성공은 관측 기록만 남기고 terminal task를 completed로 승격하지 않는다. | yes | untested |
| F043 | R19 | automatic | 유효한 current의 queued·created·생성 불명·finalizing·잘못 저장된 pending·dispatched·completed receipt를 가진 앱을 재실행한다. | §8.4 복원 규칙대로 interrupted/needed/result_unknown/기존 completed를 복원한다. 잘못 저장된 pending도 result_unknown이다. 자동 실행·이어받기·재접속·이전 temp 검색 및 삭제가 없다. backup 복원 판정은 F060을 따른다. | yes | untested |
| F044 | R19 | manual | result_unknown 작업의 위치를 열고 현재 size/hash가 일치하는 파일을 관찰한 뒤 ‘확인 후 기록 닫기’를 선택한다. | 위치 열기는 읽기만 수행한다. 일치해도 과거 성공을 소급 확정하지 않고 acknowledgedAt만 추가하며 원래 result_unknown을 보존한다. | yes | untested |
| F045 | R20 | target | 인증된 제어 SSH에서 정상 /bin/true를 실행하고 exec 직전·exit·close·로컬 대기 시각을 기록한다. | 고정 명령만 실행하며 code=0·signal/error 없음·5초 이내 close를 모두 충족해야 실제 exec 직전부터 sample을 만든다. 로컬 큐 대기·keepalive·전송 속도는 값에 넣지 않는다. | yes | untested |
| F046 | R20 | automatic | exec 거절·nonzero·signal·exit 누락·channel error·stdout+stderr 4KiB 초과 fixture를 반환한다. | 해당 세션을 unavailable로 표시하고 반복 probe를 중지한다. 출력은 최대 4KiB만 소비하고 저장하지 않으며 SFTP 기능을 함께 끊지 않는다. | yes | untested |
| F047 | R20 | automatic | exec callback을 5초 이후 반환하거나 영원히 반환하지 않고 시간과 timer를 진행한다. | timeout은 delayed이며 숫자를 저장하지 않는다. 미정리 callback 동안 새 probe를 누적하지 않고 늦게 온 channel은 닫으며 sample 폐기다. 측정 때문에 제어 연결을 강제 종료하지 않는다. | yes | untested |
| F048 | R20,R04 | automatic | active 서버 전환·blur/minimize·복귀·15초 노후 sample·1ms 미만 값·사용자 채널 대기를 재생한다. | 활성·foreground에서 측정하며 종료 5초 뒤 다음 요청, pending 최대 1/서버다. epoch와 서버에 맞지 않거나 15초 지난 숫자는 제거하고 제품 §7의 문구·tooltip만 표시한다. | yes | untested |
| F049 | R21 | manual | 실행·대기·미확인 작업이 있는 상태에서 탭 닫기·프로필 해제·앱 닫기를 각각 선택한다. | 탭 닫기는 전송 유지다. 해제·종료는 작업 수와 정해진 선택지를 보여준다. 종료 승인 후 최대 10초 내 불확정 상태를 기록하고 종료하며 숨은 트레이 실행은 없다. | yes | untested |
| F050 | R21 | automatic | 전송 중 renderer crash와 worker crash를 별도 주입하고 UI 복구·엔진 다시 시작을 요청한다. | renderer crash는 main/worker를 자동 종료하지 않고 snapshot을 복원한다. worker crash는 연결 종료·단계별 분류이며 자동 worker 재시작이 없다. 사용자 재시작은 재인증·새 generation이다. | yes | untested |
| F051 | R21,R20 | target | 정상 suspend 및 이벤트 없는 강제 suspend 후 복귀하고 OS wall clock을 앞뒤로 바꾼다. | probe 폐기·가능한 interrupt 기록·socket 종료, 복귀 시 이전 generation 폐기다. 자동 연결·전송 재개가 없고 monotonic timeout/속도는 역전되지 않는다. | yes | untested |
| F052 | R22 | target | 같은 userData로 앱 두 개를 실행하고 여러 저장 요청을 동시에 제출한다. | single instance lock 소유 main만 JSON을 쓴다. 두 번째 앱은 기존 창 활성화 후 종료한다. data와 runtime cache가 분리되고 실행파일·키 원본·시스템 SSH 파일을 덮어쓰지 않는다. | yes | untested |
| F053 | R22 | automatic | key 순서·배열 순서·checksum 변조·unsafe revision·금지 값·state 1MiB/receipt 64KiB 경계의 JSON을 읽고 쓴다. | 재귀 code-point key 정렬·배열 순서 유지로 SHA-256을 계산한다. parse 전 상한·strict schema·checksum·안전 정수를 검사하고 undefined/NaN/Infinity/bigint를 거절한다. | yes | untested |
| F054 | R22 | automatic | JSON writer의 temp 작성·sync·backup 교체·current 교체마다 중단시키고 Windows replace 잠금을 주입한다. | 동일 폴더 wx/0600→sync→close→검증 backup copy/sync/replace→current replace 순서다. current 선삭제가 없다. 100/200/400ms 최대 3회 재시도와 5초 기한을 적용하고 새 writer를 겹치지 않는다. | yes | untested |
| F055 | R22,R06 | automatic | current 유효·backup만 유효·둘 다 손상·높은 schemaVersion 상태로 시작한다. | 유효 current를 우선한다. backup 복구는 사용자에게 알리고 trust 재승인 전 인증하지 않는다. 둘 다 손상이면 연결/변경 잠금이며 자동 빈 초기화·덮어쓰기·downgrade가 없다. | yes | untested |
| F056 | R22,R19 | target | 디스크 부족·권한 거절·읽기 전용·파일 잠금으로 intent 전/원격 ACK 후 저장을 실패시키고 ‘저장소 다시 확인’을 선택한다. | intent 실패는 dispatch 금지다. ACK 후 실패는 원격 실패가 아니라 기록 경고다. fault 중 새 mutation/enqueue/trust 변경을 잠그고 조회·해제는 허용한다. 검증 완료 전 잠금을 풀지 않는다. | yes | untested |
| F057 | R22,R23 | automatic | 30일/1,000개 경계 terminal·unresolved 100개 초과·손상 receipt·orphan secret을 로드하고 기록/프로필을 삭제한다. | terminal만 시작 시 1회 보관 한도로 정리한다. unresolved 자동 삭제 금지·초과 시 새 변경 차단이다. 손상은 해당 receipt만 표시하고 다른 secret 대체·원격 파일/계정 삭제가 없다. | yes | untested |
| F058 | R26 | automatic | §13의 모든 오류 코드 및 미확인 errno/SFTP FAILURE·결과 불명 조건을 UI에 전달한다. | code/userMessage/confirmedPhase/affectedTarget/actions/technicalDetails가 규정과 일치한다. 원인을 지어내지 않고 결과 불명 우선, 원문 stack·credential 제외, 검색·AI·sudo/chmod 제안이 없다. | yes | untested |
| F059 | R08,R18,R19 | automatic | control SFTP 조회·mutation 응답을 15초 넘게 지연하고 같은 서버 transfer·다른 서버 작업과 늦은 callback을 관측한다. | control quarantine·새 요청 차단·socket 종료와 같은 서버 transfer 종료다. 조회는 IO_TIMEOUT, mutation은 result_unknown이며 미해결 경로는 사용자 확인 전 mutation 금지다. 새 generation은 이전 callback 폐기, probe timeout은 별도 처리다. | yes | untested |
| F060 | R19,R22 | automatic | current receipt를 손상시키고 queued·verifying·종결 상태가 각각 담긴 유효 backup으로 복원한다. | 모두 recoveryUncertain=true와 result_unknown으로 복원한다. backup 종결 관측은 과거 기록으로만 남고 최신성 불명을 표시한다. 자동 실행·정리·완료 복구 추정이 없다. | yes | untested |

## Q — 품질·시험 환경·공개 판정

| ID | 요구 | 방법 | 준비와 동작 | 합격 기준 | 필수 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| Q001 | R02,R28 | target | Windows 11 x64·macOS 14 arm64·native x64와 Ubuntu 24.04 amd64/arm64의 6조합에서 인증·파일·무결성·trust·단절 smoke를 실행한다. | 6조합 모두 통과하고 OS build·CPU·OpenSSH package·sshd 설정을 남긴다. Rosetta로 native x64를 대체하지 않으며 추가 macOS major는 양 CPU 증거 없이 지원 목록에 넣지 않는다. | yes | untested |
| Q002 | R02,R03 | target | 개발 런타임·DB가 없는 허가된 clean PC에서 target별 0.1.0 배포물을 실행한다. | 이름은 §16의 exe·arm64 zip·x64 zip과 일치하고 mac ZIP 최상위는 sshOS.app 하나다. Windows는 portable/user 권한이며 installer·UAC 관리자·추가 런타임 설치를 요구하지 않는다. | yes | untested |
| Q003 | R02,R31 | target | Windows exe·mac app의 서명과 mac notarization/stapling을 플랫폼 도구로 검증한다. | 유효한 배포자 서명·공증 증거가 있다. 자격증명이 없으면 개발용 패키지로만 기록하고 공개 배포 완료로 처리하지 않는다. 모든 PC 경고 제거를 보장하지 않는다. | yes | untested |
| Q004 | R27 | target | §14 장비에서 cold 5회·warm 5회 앱을 열어 연결 화면을 조작한다. Windows TEMP 해제도 측정한다. | cold 모두 10초 이내, warm 모두 3초 이내 조작 가능하다. 장비·OS·전원·부하·반복별 실제 시간을 남긴다. | yes | untested |
| Q005 | R27 | target | 서명된 각 target 배포물의 압축 크기와 해제된 앱의 크기를 측정한다. | target별 압축 250MiB 이하·해제 앱 750MiB 이하이며 양 수치를 별도로 기록한다. | yes | untested |
| Q006 | R27 | target | 미연결·3서버 연결·2전송+검증에서 각각 60초 안정화 후 5분간 1초 간격으로 앱 전체 프로세스를 측정한다. | working set/RSS 합의 p95가 각각 500/650/800MiB 이하다. main/renderer/utility/GPU/helper를 포함하며 공유 page 중복 가능성·계산법을 기록한다. | yes | untested |
| Q007 | R27 | target | 3개 연결·활성 probe 1개·사용자 입력 없음 상태를 5분 측정한다. | 평균 CPU가 한 logical CPU의 3% 이하이며 전체 앱 프로세스를 대상으로 계산한다. | yes | untested |
| Q008 | R27 | target | 기준 장비에서 버튼·탭·취소를 반복 조작하며 입력부터 시각 피드백까지 기록한다. | p95 100ms 이하·최대 300ms 이하이며 원격 응답 완료 시간과 구분한다. | yes | untested |
| Q009 | R11,R27 | target | 100Mbps·RTT 40ms·loss 0에서 10,000항목 폴더를 열고 가상 목록을 스크롤한다. | 첫 완전 표시 10초 이하이며 이후 스크롤에 100ms 초과 UI long task가 없다. | yes | untested |
| Q010 | R14,R27 | target | 서로 다른 서버로 1GiB 두 파일을 전송하면서 기준 네트워크의 1,000항목 폴더를 연다. | 목록이 5초 안에 표시되고 두 전송의 대상·진행 기록이 유지된다. | yes | untested |
| Q011 | R27 | target | 10MiB 파일로 연결/전송/취소 100cycle을 실행하고 전체 앱 메모리를 수집한다. | 마지막 10cycle p95가 최초 안정화 10cycle p95보다 50MiB 이상 증가하지 않는다. | yes | untested |
| Q012 | R18,R21,R27 | target | 반복 task 종료·취소·연결 종료 뒤 열린 handle·socket·timer를 수집한다. | 안정화 후 기준치로 복귀하고 반복 증가가 없다. 종료되지 않은 I/O를 숨긴 채 정리 완료로 표시하지 않는다. | yes | untested |
| Q013 | R04,R27 | visual | 1120×760·1600×1000 및 OS 배율 100/150/200%에서 다섯 화면·대화상자·하단 선반을 검수한다. | 필수 조작이 가려지지 않는다. 상단 56px·좌측 88px·하단 112px 예약과 중앙 스크롤을 지키고 하단은 숨길 수 없으며 진행 최대 2개·대기/오류 수를 표시한다. | yes | untested |
| Q014 | R04,R27 | manual | 키보드만으로 기본 흐름과 대화상자를 수행하고 label·focus·aria-live·대비를 점검한다. | 전체 경로 조작, visible focus, dialog focus trap/복원, 입력 label, 상태 aria-live가 있으며 일반 텍스트 대비 4.5:1 이상이다. 색만으로 상태를 구분하지 않는다. | yes | untested |
| Q015 | R04,R10,R27 | target | Windows/macOS 한글 IME 조합 중 Enter를 누르고 한글·emoji 이름을 목록·전송·변경 요청에서 사용한다. | 조합 중 Enter가 전송·삭제를 실행하지 않으며 지원 이름이 손실 없이 표시·요청된다. | yes | untested |
| Q016 | R09,R18,R28 | target | 격리된 SFTP-only/chroot·exec 차단·SFTP 없음·READ 제한·hardlink 미지원·MaxSessions·읽기 전용·quota/full과 RTT 500/2000ms·loss 1%·완전 단절 fixture를 실행한다. | 각 실제 fixture에서 해당 F/S 계약을 통과하고 제한 기능을 구분한다. 실제 서버 설정과 장애 주입 조건·관측을 남기며 사용자 서버를 시험 대상으로 수정하지 않는다. | yes | untested |
| Q017 | R28,R32 | automatic | 고정 package script·TS compiler option·핵심 모듈 coverage와 실제 실행 report를 검사하고 TEST_HOST 없이 integration을 호출한다. | §15의 여덟 script가 실제 대상을 실행한다. strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes가 true다. 지정 핵심 모듈 statement≥90%·branch≥85%이며 TEST_HOST 누락은 미준비로 기록하고 pass/skip 합격 처리하지 않는다. | yes | untested |
| Q018 | R28 | manual | 각 실행 행의 결과 레코드와 첨부 원자료를 §17 schema에 대조한다. | build hash·revision·환경·fixture·절차·actual/expected·evidence·defectId가 있다. bytes/trust/egress를 screenshot만으로 합격 처리하지 않으며 미실행은 untested다. | yes | untested |
| Q019 | R30 | manual | 제품 §9의 G0로 최근 3개월 SSH 파일 작업 경험자 6명을 인터뷰하고 실제 경험을 기록한다. | 4명 이상이 첫 연결·전송 대기·화면 전환 후 대상 파악의 실제 불편을 설명해야 문제 가설을 유지한다. 미달·미실행을 통과로 기록하지 않는다. | yes | untested |
| Q020 | R30 | manual | 제품 §9 G2의 12명에게 평소 도구와 시오스의 정상·두 장애 과업을 수행시킨다. 순서는 각 6명씩 반대로 배정한다. | 정상 독립 완료≥10/12, 두 장애 모두 서버·확정/미확정 결과 설명≥9/12, 잘못된 서버 변경·거짓 완료 0건이다. baseline 기능을 제한하지 않고 시간·전환·이해도 차이와 범위 제약 수용 여부를 보고한다. 기존 파일 갱신·폴더 전달은 미지원으로 기록하며 삭제 후 재업로드를 성공 우회로 인정하지 않는다. | yes | untested |
| Q021 | R30 | manual | 제품 §9 G3의 6명·4주 pilot에서 작업 기회와 자발적 사용을 기록한다. | 기회≥2인 적격자≥4명 중 ≥3명이 강제 없이 총≥2회 사용한다. 기회 부족은 관찰 부족이며 성공·수요 입증으로 바꾸지 않는다. | yes | untested |
| Q022 | R31 | manual | 후속 개발의 실제 Git 원격·권한·guard·PR/review/merge·branch 정리 증거를 검토한다. | 원격 없는 push 완료·무단 worktree/remote가 없다. GitHub origin은 사용자 AGENTS 흐름·current-head APPROVED·guard·양쪽 branch 정리를 지키며 미충족 선행조건을 우회하지 않는다. | yes | untested |
| Q023 | R31,R28 | manual | 공개 후보의 필수 검사·미해결 결함·서명·G0/G2/G3 결과를 제품 §9와 개발 §16에 대조한다. | P0/P1 및 필수 수용 기준 위반 P2는 차단한다. 외부 pilot 전 기술 검사, 정식 공개 전 사용자 검증 결과를 갖추며 기준 완화·결함 등급 하향으로 합격 처리하지 않는다. | yes | untested |
| Q024 | R32 | manual | 구현 착수 지시·v5 scope digest·D01 결과·의존성 manifest/lock·D01–D10 인계 기록을 검사한다. | exact baseline과 실제 Electron Node/Chromium 버전을 기록한다. latest/^/~ 및 Tauri 우회가 없고 변경은 새 판본·회귀 범위로 남긴다. 계획 작성·프레임워크 선택을 구현 완료로 기록하지 않는다. | yes | untested |

## S — 신뢰·비밀정보·권한 경계

| ID | 요구 | 방법 | 준비와 동작 | 합격 기준 | 필수 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| S001 | R01,R03,R25 | automatic | 배포 소스·의존성·IPC·메뉴·설정·feature flag를 제품 §2 제외 목록과 대조한다. | 온라인 검색·숨은 브라우저·AI/모델SDK·터미널·원격 helper·DB 기능 저장·자동 복구·자동 업데이트 등 제외 기능이 stub/비활성 경로를 포함해 존재하지 않는다. | yes | untested |
| S002 | R24 | automatic | 운영 BrowserWindow·preload·CSP·navigation·새 창·permission request·DevTools 설정을 점검하고 위반 동작을 시도한다. | nodeIntegration=false, contextIsolation/sandbox/webSecurity=true이며 §4 CSP를 지킨다. unsafe-inline/eval·webview·외부 navigation/새 창/권한·remote debug/자동 DevTools가 없다. | yes | untested |
| S003 | R24 | automatic | app protocol에 다른 host·decode traversal·package 밖 symlink·미확인 MIME과 외부 HTML을 요청한다. | app://ui/ package 내부 허용 파일만 읽고 나머지는 거절한다. 원격 HTML·스크립트를 앱 창에 싣지 않으며 eval/Function/openExternal bridge가 없다. | yes | untested |
| S004 | R24 | automatic | 다른/종료 frame·잘못된 origin, renderer→main 64KiB 초과 요청·unknown key/enum·동시 dialog·초당30/burst60 초과 IPC를 전송한다. | sender를 payload보다 먼저 검사하고 strict schema·상한을 적용한다. frame당 dialog 하나, 취소/해제 우선 큐를 지키며 자유 invoke/exec/readFile API가 없다. | yes | untested |
| S005 | R24,R10 | automatic | token의 serverId·generation·parent·rawName·type을 바꾸고 60초 지난/소비된 confirmationToken을 재사용한다. | main 보관 capability와 불일치·재접속 token·만료/재사용 확인을 거절한다. 삭제 승인을 다른 경로·작업·기존 목적지 제거에 재사용하지 못한다. | yes | untested |
| S006 | R24,R19 | automatic | 이전 backendEpoch/generation·중복 requestId·sequence gap·서버 전환 중 이벤트를 주입한다. | 틀린 epoch/generation 폐기, gap은 main snapshot 복구다. 중복은 같은 응답/처리 중이며 side effect 1회다. 선택 UI로 task serverId를 바꾸지 않는다. | yes | untested |
| S007 | R23,R24 | automatic | renderer가 임의 로컬 경로·dialog 선택 밖 file token으로 업로드/키 읽기를 요청하고 worker 저장을 유도한다. | main OS dialog가 부여한 capability만 허용한다. renderer/worker가 state JSON을 직접 쓰지 못하고 renderer가 fs/net/secret 복호화에 직접 접근하지 못한다. | yes | untested |
| S008 | R06 | target | 신규 endpoint에서 인증 관측 서버로 연결하고 승인·취소·120초 만료·신뢰 저장 실패를 수행한다. | 첫 socket은 지문 수집 뒤 verifier=false로 닫혀 인증 정보가 나가지 않는다. 승인 지문 저장 성공 후 새 연결을 검증하며 만료·취소·저장 실패는 인증하지 않는다. | yes | untested |
| S009 | R06 | target | 저장 키와 다른 host key, 승인 후 재연결 사이 키 변경, transfer에 다른 키를 제공한다. | control/transfer 모두 공개 blob을 byte 비교하고 변경은 HOST_KEY_CHANGED로 종료한다. 무시·자동 교체·약한 지문 비교가 없고 인증 정보 전송을 차단한다. | yes | untested |
| S010 | R06 | target | 동일 endpoint의 복수 프로필과 대기 task에서 설정의 신뢰 삭제를 실행하고 시스템 SSH 파일 변경을 추적한다. | endpoint의 연결·대기 task를 먼저 종료하며 비밀을 재전송하지 않는다. 다음 연결은 신규 승인이고 ~/.ssh/config·known_hosts를 자동 읽거나 수정하지 않는다. | yes | untested |
| S011 | R07 | automatic | 512KiB 초과·.pub·PPK·PKCS#8 입력 파일·DSA·ECDSA 사용자키·인증서·FIDO·외부 agent·MFA·약한 RSA 및 1,024byte 초과 password/passphrase를 제공한다. | 지원 밖 형식·방식·크기를 거절하고 사용자 입력 형식 변환·fallback을 하지 않는다. RSA 2048bit 미만·SHA-1 약화 인증이 없다. 내부 PKCS#8 전달과 내부 서명 adapter를 외부 입력/agent 지원으로 간주하지 않는다. | yes | untested |
| S012 | R07,R23 | target | 입력 비밀을 표시 폼·세션·transfer 재인증에서 관측한 뒤 disconnect·worker 사망·앱 종료를 수행한다. | 폼은 제출 후 비우고 비밀은 해당 세션 메모리 범위만 유지한다. 종료 시 참조 폐기·가능한 Buffer 덮어쓰기를 수행하며 renderer로 저장 비밀을 반환하지 않는다. 완전 물리 소거를 주장하지 않는다. | yes | untested |
| S013 | R07 | target | §5 allowlist의 협상·서명을 실제 고정 라이브러리로 검사하고 약한 알고리즘·server-sig-algs 미제공·sha1-only 서버를 연결한다. | 지정 KEX/server-key/cipher/MAC·compression none을 지킨다. 미지원 지정 이름은 빌드 실패이며 allowlist 축소·약화가 없다. 협상 예외에서도 서명된 SHA-1 인증을 전송하지 않는다. | yes | untested |
| S014 | R23 | target | 저장 기본값·명시적 저장 선택·암호화 사용 불가·OS 잠금·encrypt/decrypt 실패를 시험한다. | 기본 저장은 false다. app.ready 이후 지정 async safeStorage API를 쓰고 실패는 SECRET_UNAVAILABLE이다. base64 암호문과 연결 참조만 저장하며 평문·고정키·다른 crypto fallback이 없다. | yes | untested |
| S015 | R23 | target | 실제 서명된 mac 앱 업데이트와 Windows 같은/다른 사용자 계정·다른 PC의 저장 비밀 복호화를 시험한다. | mac 서명 identity 연속성과 Keychain 접근을 확인한다. 실패는 SECRET_UNAVAILABLE과 재입력이며 다른 사용자/기기의 암호문이 항상 이식 가능하다고 설명하지 않는다. | yes | untested |
| S016 | R23,R24 | automatic | 고유 sentinel 비밀번호·passphrase·개인키·파일 bytes를 사용하고 renderer snapshot·task receipt·saveSecret=false 디스크 산출물을 검사한다. | snapshot·receipt에 비밀/파일 byte가 없고 저장 미선택 secret은 디스크에 없다. profile/endpoint/secretId 불일치를 다른 secret으로 메우지 않는다. | yes | untested |
| S017 | R23,R25 | target | sentinel host/IP·username·전체경로·배너·debug·비밀로 오류를 발생시키고 로그 회전·진단 내보내기를 실행한다. | 기본 로그는 §12 허용 필드만, 1MiB×3개 한도다. 진단은 preview와 OS 저장 대화상자 뒤 redacted JSON이며 receipt의 로컬 endpoint/path를 익명이라고 설명하지 않는다. | yes | untested |
| S018 | R25 | target | 패키지 앱의 첫 실행·연결·인증 실패·전송·오류 보기·설정을 네트워크 capture로 검사한다. | 앱 통신은 선택 SSH endpoint와 필요한 OS DNS뿐이다. 검색/AI/analytics/crash upload/update/font/CDN/HTTP fetch가 없고 renderer 웹 요청은 차단한다. OS 보안 통신과 앱 통신을 구분한다. | yes | untested |
| S019 | R03,R25 | target | clean client/server에서 앱 실행 전후 프로세스·listen socket·서버 패키지/서비스 변화를 대조한다. | 앱의 로컬 관리 HTTP listener와 원격 전용 앱/agent/helper/DB/Python/HTTP 설치가 없다. 승인된 사용자 파일 전송의 .part·결과물과 런타임 캐시는 설치 요구와 구분한다. | yes | untested |
| S020 | R10,R24,R25 | automatic | 파일명·배너·오류에 HTML/script·ANSI·제어문자·URL·shell metacharacter를 넣어 UI와 요청을 관측한다. | 지원 밖 이름은 제한하고 나머지는 문자 데이터로 표시한다. 코드·shell 실행, 외부 navigation/전송, HTML escape 문자열을 실제 경로로 보내는 동작이 없다. | yes | untested |
| S021 | R03,R09,R20 | target | 변조 os-release와 사용자 입력 metacharacter로 OS 탐지·probe를 실행하고 모든 SSH channel 요청을 기록한다. | os-release는 SFTP read만 한다. exec는 인증된 control의 고정 /bin/true뿐이며 PTY/X11/agent forwarding/env 전달·사용자 문자열 결합·원격 checksum/helper가 없다. | yes | untested |
| S022 | R29 | manual | 공개 후보의 LICENSE·copyright·third-party notices·CycloneDX JSON SBOM·전이 의존성·소스/lock/빌드명령을 대조한다. | 프로젝트 AGPL-3.0-only와 실제 dependency license 의무를 이행한다. license unknown/incompatible은 차단하며 exact version·source revision/hash와 binary 버전이 대응한다. | yes | untested |
| S023 | R29,R31 | manual | 고정 버전 보안 scanner 결과와 high/critical 제외 판단 및 공개 판정을 검토한다. | 적용 가능한 미해결 high/critical은 출시 차단이다. false positive 제외는 version·도달 가능성·근거·검토자를 기록하며 severity를 임의 낮추지 않는다. | yes | untested |
| S024 | R24,R28 | target | 서명된 production binary의 @electron/fuses 값을 읽고 Node 환경변수·inspect·대체 app 로드를 시도한다. | RunAsNode/EnableNodeOptionsEnvironmentVariable/EnableNodeCliInspectArguments/GrantFileProtocolExtraPrivileges=false, EnableEmbeddedAsarIntegrityValidation/OnlyLoadAppFromAsar=true다. asar metadata가 유효하고 Playwright용 inspector 빌드를 배포하지 않는다. | yes | untested |
| S025 | R07,R23 | automatic | 큰 key 파일과 느린 key parse·bcrypt rounds 0/1/100/101·동시 키 선택·5초 초과를 주입하며 기존 SSH event loop를 관측한다. | main은 fstat 후 최대 512KiB+1 제한 읽기만 수행한다. parser는 별도 worker_thread 최대 1개이고 5초 초과 시 해당 thread만 종료한다. rounds 1–100만 허용하며 main/event loop를 막지 않는다. 성공 결과는 내부 PKCS#8 PEM이며 클래스 인스턴스를 MessagePort로 보내지 않는다. | yes | untested |
| S026 | R07 | automatic | 내부 BaseAgent에 다른 pubKey, RSA hash sha256/sha512/sha1/undefined/기타와 Ed25519 요청을 전달한다. | 선택 공개키 하나만 제공하며 불일치·허용 밖 RSA hash는 서명 없이 error다. 허용 RSA는 RSA_PKCS1_PADDING raw Buffer, Ed25519는 crypto.sign(null)이고 callback 정확히 1회·authHandler 소진 후 false다. | yes | untested |
| S027 | R23,R22 | automatic | decryptStringAsync의 result/shouldReEncrypt true·false·Promise reject와 재암호화 저장 실패를 주입한다. | result만 인증에 사용한다. true면 같은 secretId를 재암호화해 단일 writer 저장 후 사용한다. 교체 실패는 기존 암호문 유지·STORAGE_FAILED·그 비밀의 새 인증 중지이며 reject는 SECRET_UNAVAILABLE, 무한 재호출 없음이다. | yes | untested |
| S028 | R24,R11 | automatic | main→worker 인증 1MiB/초과·일반 요청64KiB/초과·응답256KiB/초과 및 큰 목록·task list를 전달한다. | 각 방향 byte 상한을 적용한다. 목록은 최대256항목이면서 256KiB 이하로 분할하고 task list는100개 페이지다. 전체 receipt·비밀을 snapshot에 싣지 않는다. | yes | untested |

## 결과 증거의 형식

현재 표는 검사 정의다. 실제 실행 시 별도 결과 레코드에 다음 필드를 모두 저장한다. `status` 허용값은 `pass`, `fail`, `untested`이며 실제 실행하지 않은 행은 `untested`를 유지한다. `defectId`는 결함이 없으면 null로 두며, 문서 구조 검사만으로 제품 행을 pass로 바꾸지 않는다.

```json
{
  "checkId": "F001",
  "status": "untested",
  "buildSha256": null,
  "sourceRevision": null,
  "environment": {"os": null, "cpu": null, "serverVersions": null},
  "fixtureConfiguration": null,
  "procedure": null,
  "actualOutcome": null,
  "expectedOutcome": "해당 검사 행의 합격 기준",
  "evidencePath": null,
  "defectId": null
}
```

실행한 결과에는 null인 build·source·환경·fixture·절차·actual·evidence 필드를 실제 값으로 채운다. 단위검사는 raw report, 전송은 hash·byte 결과, 외부 통신 차단은 capture, 서명은 플랫폼 검증 출력을 첨부한다. 화면만으로 파일 무결성·호스트 검증·egress 차단을 입증하지 않는다. 제품 검사 결과와 문서의 구조·링크·추적 검증 결과는 분리한다.
