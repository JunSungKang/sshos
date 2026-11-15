# sshOS(시오스) 개발 계획서 v5

기준일: 2026-11-14. 제품 버전: 0.1.0. 방법론: SDD. 실행 대상: GPT-6.1-sol High 또는 같은 계약을 준수하는 개발자. 현재 단계는 계획·명세 작성이며 제품 구현은 시작하지 않았다. 이 문서의 필수 계약을 바꾸려면 v5를 덮어쓰지 않고 다음 판본과 영향 분석을 작성한다.

## 1. 범위와 정본

[제품 계획서](01-product-plan.md)의 사용자 동작을 Electron 한 경로로 구현한다. [검수 체크리스트](06-quality-security-checklist.md)의 필수 검사와 [기계 명세](spec-v5.json)의 R–D–A–C 연결을 유지한다. [구현 인계서](07-implementation-handoff.md)는 작업 순서를 안내하며 기능을 추가하지 않는다. [조사](03-research-and-positioning.md)와 [기술 비교](05-framework-comparison.md)는 근거 자료이고 규범 동작을 변경하지 않는다. docs/history는 읽기 전용 이력이다.

이번 버전에 온라인 오류 검색·검색 API·숨은 브라우저·AI 요약·모델 SDK·에이전트를 추가하지 않는다. ‘나중에 사용’할 stub, 메뉴, 설정, 기능 플래그, 네트워크 권한도 만들지 않는다. 오류 표시는 §13의 고정 문구만 사용한다. 임의 shell·터미널·원격 helper·DB·자동 복구도 제외한다.

모든 현재 작업 파일·캐시·임시 출력의 허용 루트는 `/Users/kkkk/Desktop/jskang/03.workspace/01.project/sshOS`다. 경로를 resolve하여 루트 안임을 확인한 뒤 쓴다. 작업용 캐시는 `.local/`에 둔다. HOME·CODEX_HOME을 재지정하지 않는다. 제품 사용자 데이터 경로는 §11과 다르며, 개발 환경에서 제품을 실행할 때는 테스트 전용 주입으로 `.local/runtime/`를 사용한다. 실제 배포물의 기본 경로 시험은 별도로 허가된 시험 PC·계정에서만 수행한다.

## 2. 용어와 공통 수치

| 용어 | 정확한 정의 |
| --- | --- |
| serverId | 프로필을 생성할 때 발급한 UUID v4. 현재 선택 탭의 index나 hostname으로 대체하지 않음 |
| endpoint | 정규화한 host + port. host trust의 키이며 username은 포함하지 않음 |
| sessionGeneration | 해당 serverId에서 새 제어 SSH 연결 시도마다 증가하는 정수. SSH rekey에서는 변경하지 않음 |
| backendEpoch | utilityProcess를 시작할 때마다 새로 발급한 UUID. 이전 worker 이벤트 폐기 기준 |
| taskId | 파일 하나 또는 단일 mutation에 부여한 UUID v4. 재시도는 새 ID |
| control | 탐색·단일 mutation·capability 탐지·probe용 SSH 연결 |
| transfer | 한 파일의 업로드·다운로드·해시 대조에 사용하는 별도 SSH 연결 |
| ACK | 해당 SFTP 요청에 성공 status를 수신한 사실. 전원 손실 뒤의 영구 저장 보장이 아님 |
| intent | 변경 요청을 보내기 전에 로컬 디스크에 성공적으로 저장한 실행 예정 단계 |
| 완료 | §8의 내용 대조·최종 목적지 확인·영수증 저장이 끝난 상태 |
| 결과 확인 필요 | 변경을 보냈을 가능성이 있으나 실행 결과 ACK를 확정하지 못한 상태 |
| 임시 파일 정리 필요 | 최종 목적지 성공은 확인했으나 앱이 만든 임시 경로의 제거를 확인하지 못한 부가 상태 |
| ms, KiB, MiB, GiB | ms는 1/1000초, KiB=1024byte, MiB=1024²byte, GiB=1024³byte |

| 항목 | 고정값 |
| --- | --- |
| 프로필 / 연결 / 파일 탭 | 최대 10 / 3 / 6 |
| worker | 앱당 utilityProcess 1개. worker 사망 시 자동 재시작하지 않음 |
| 서버별 socket | control 1개 + 실제 전송 시 transfer 최대 1개 |
| 전송 슬롯 | 전체 2개, 서버별 1개. 준비부터 검증·확정·최종기록까지 슬롯 점유 |
| 대기 전송 | 전체 최대 100개, 한 선택에서 최대 100개. 상한 초과 시 요청 전체 거절 |
| 단일 파일 크기 | 0byte 이상 64GiB 이하. byte·offset은 안전 정수 Number, JSON도 정수 |
| SSH 연결 기한 | socket 시작부터 인증 ready까지 20초. 사용자 호스트 승인 대기는 별도 연결을 닫은 상태 |
| SFTP/탐색/단일 변경 요청 기한 | 요청 dispatch 후 15초. 디렉터리 전체 읽기는 60초 추가 상한 |
| 전송 무진행 기한 | 유효 read/write ACK 또는 검증 read가 30초 없으면 중단. 전체 파일 시간 상한 없음 |
| 로컬 저장 요청 기한 | 5초. 기한 이후 늦은 성공도 generation 확인 없이 새 상태로 적용하지 않음 |
| 취소 처리 기한 | 수락 후 5초 내 stream/transfer socket을 종료. 최종 목적지 확정 단계에서는 취소 불가 |
| 종료 처리 기한 | 사용자 종료 승인 후 최대 10초. 불확정 작업은 그대로 기록하고 종료 |
| probe | 이전 probe 종료 후 5초, 요청 기한 5초, 신선도 15초, pending 최대 1/서버 |
| 진행 이벤트 | 최대 4Hz/작업, terminal 이벤트는 즉시. 정상 UI 반영 지연 1초 이하 |
| 목록 상한 | 폴더당 10,000항목, 최대 10MiB 직렬화 데이터. 초과 시 일부 목록임을 표시 |
| 작업 기록 | 종결 영수증 30일 또는 최근 1,000개 중 먼저 도달한 보관 한도. 미해결 기록은 자동 삭제 금지 |
| unresolved 한도 | 100개. 초과 시 새 변경 작업을 막고 작업 화면의 기록 정리를 요구 |

## 3. 기술 기준과 프로세스 경계

직접 의존성의 정확한 초기 버전은 [dependency-baseline-v5.json](dependency-baseline-v5.json)에 고정한다. 이는 공식 배포 metadata를 확인한 기준선이며 조합 시험 통과 기록은 아니다. D01에서 설치·license·보안·target 호환성 검사를 수행한다. `latest`, `^`, `~` 범위로 manifest를 작성하지 않는다. lockfile과 실제 Electron 내부 Node·Chromium 버전을 결과에 남긴다. 보안 수정이나 빌드 불가로 버전을 바꾸면 변경 이유·새 exact version·회귀 범위를 새 명세 개정에 기록한다.

| 구성 | 선택과 책임 |
| --- | --- |
| Renderer | React + TypeScript + Vite. 로컬 UI와 상태 표시. SSH, 파일시스템, 암호문 복호화 권한 없음 |
| Preload | TypeScript로 작성하여 CommonJS 번들 1개. contextBridge에 명시한 함수만 노출 |
| Main | Electron. 창·OS dialog·프로필·신뢰·safeStorage·단일 JSON writer·IPC 권한검사 |
| Worker | Electron utilityProcess + TypeScript + ssh2. SSH·SFTP·전송 큐·hash·probe. main과 MessagePort 통신 |
| 검증 | Zod strict schema. 알 수 없는 필드와 잘못된 enum을 거절 |
| 테스트 | Vitest 단위/상태/장애주입, Playwright Electron UI, 실제 OpenSSH target 시험 |
| 배포 | electron-builder portable Windows x64, macOS app ZIP arm64/x64. OS별 native runner에서 생성·서명 |

실제 IPC는 `renderer → preload → main → worker` 방향이다. worker가 main writer에 intent 저장을 요청하고 성공 응답을 받은 뒤 원격 변경을 수행한다. renderer와 worker는 state JSON을 직접 쓰지 않는다. worker가 받은 로컬 파일 권한은 main의 OS dialog 결과로 만든 capability로 제한한다. 파일 byte·비밀번호·개인키를 상태 snapshot에 넣지 않는다.

예정 소스 책임은 고정한다: `src/main/`은 창·저장·비밀·권한, `src/preload/`는 bridge, `src/renderer/`는 UI, `src/shared/`는 순수 type/schema/state reducer, `src/worker/`는 연결·SFTP·전송·probe, `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/fixtures/`는 해당 검증이다. shared에서 Electron·fs·net을 import하지 않는다. renderer에서 main/worker 모듈을 import하지 않는다.

## 4. IPC와 앱 보안

BrowserWindow는 `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true`를 명시한다. UI는 패키지에 포함한 `app://ui/`의 파일만 읽는다. custom protocol은 host=`ui`와 package root 하위 경로만 허용하고 URL decode 후 traversal, symlink 탈출, 알 수 없는 MIME을 거절한다. shell.openExternal, eval, Function 생성자, 임의 HTML 삽입을 bridge에 노출하지 않는다.

CSP는 `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`를 기준으로 한다. 운영 빌드에 unsafe-inline/unsafe-eval을 추가하지 않는다. 외부 navigation·새 창·webview·permission request는 모두 거절한다. 외부 HTML·파일 미리보기·원격 스크립트를 앱 창에 싣지 않는다. 운영 빌드에는 remote debugging port와 자동 DevTools를 켜지 않는다.

패키징 후 서명 전에 @electron/fuses로 RunAsNode=false, EnableNodeOptionsEnvironmentVariable=false, EnableNodeCliInspectArguments=false, EnableEmbeddedAsarIntegrityValidation=true, OnlyLoadAppFromAsar=true, GrantFileProtocolExtraPrivileges=false를 적용한다. asar integrity metadata를 생성하고 signed binary에서 fuse 값을 다시 읽어 검증한다. utilityProcess를 사용하므로 child_process.fork에 기대지 않는다. Playwright의 inspector 연결이 필요한 자동화용 빌드는 production과 구분하고 배포하지 않는다. production의 inspector fuse를 풀어 테스트를 통과시키지 않는다. 실제 signed production package의 실행·보안·서명·수명 smoke는 native target 검사로 별도 수행한다.

각 IPC 호출은 senderFrame이 살아 있는 앱 main frame이고 URL이 `app://ui/` 출처인지 확인한다. 유효하지 않은 sender는 payload 검증 전에 거절한다. renderer→main 요청은 최대 64KiB다. 문자열·배열 개수 제한을 schema에 넣고 알 수 없는 키는 허용하지 않는다. native file dialog를 여는 요청은 renderer frame당 하나만 허용한다. 한 frame의 요청은 초당 30개, burst 60개로 제한하며 취소·연결 해제 요청을 별도 우선 큐에 둔다.

허용 API는 다음 이름과 역할만 제공한다. 자유로운 `invoke(channel,payload)`·`exec(command)`·`readFile(path)`는 제공하지 않는다.

| API 그룹 | 허용 요청 |
| --- | --- |
| profile | list, create, update, delete. saveSecret boolean과 transient 인증 입력은 별도 schema |
| trust | approveObservedKey(challengeId), rejectObservedKey, removeTrust(endpoint). 변경 키 바로 승인 없음 |
| session | connect(serverId), disconnect(serverId), confirmUnknownOS(serverId,generation) |
| file | list(directoryToken), mkdir(directoryToken,name), rename(entryToken,newName), delete(entryToken,confirmationToken) |
| transfer | pickUploadFiles, pickDownloadDirectory, enqueueUpload(fileTokens,directoryToken), enqueueDownload(entryTokens,directoryToken), cancel(taskId) |
| task | list, inspectLocation(taskId), acknowledgeUnknown(taskId), discardQueued(taskId), forgetRecord(taskId) |
| settings | get, update(허용 필드만), exportRedactedDiagnostics, showLicenses |
| lifecycle | getSnapshot, subscribe, requestCloseDecision |

entryToken/directoryToken은 main이 보관한 UUID이고 `{serverId,generation,canonicalParent,rawName,type,listedAt}`에 바인딩한다. 재접속 뒤 token은 무효다. Renderer가 임의 경로나 serverId를 token 내용과 조합하여 바꿀 수 없다. mutation 시 main·worker에서 다시 lstat/부모 확인을 한다. confirmationToken은 특정 task preview의 서버·경로·종류·작업에 묶이고 60초 뒤 만료하며 1회만 소비한다. 기존 목적지를 지우는 권한으로 재사용하지 않는다.

main→worker 인증 메시지는 최대 1MiB, 나머지 요청은 64KiB다. 응답·event는 최대 256KiB이며 목록은 최대 256항목씩 나누고 byte 상한도 지킨다. task list는 100개씩 페이지를 나누며 전체 영수증 내용을 snapshot에 싣지 않는다. main→worker envelope는 requestId, backendEpoch, serverId, sessionGeneration, action, validatedPayload를 포함한다. event는 동일 식별자와 단조 증가 sequence를 포함한다. 틀린 epoch/generation은 폐기하고 sequence gap은 main snapshot으로 복구한다. GUI에서 서버 선택이 바뀌었다는 이유로 작업의 serverId를 다시 결정하지 않는다. 중복 requestId는 같은 응답을 반환하거나 ‘처리 중’으로 응답하고 side effect를 두 번 보내지 않는다. in-memory 중복 방지는 프로세스 재실행 뒤 자동 재시도 허용이 아니다.

## 5. 프로필과 호스트 신뢰와 인증

프로필 입력은 name 1–64 Unicode scalar, hostname/IP 최대 253byte, port 정수 1–65535, username UTF-8 1–256byte다. 이름·계정에 NUL/제어문자를 허용하지 않는다. host에는 URL scheme, 경로, 사용자정보, 공백을 허용하지 않는다. DNS 이름은 domainToASCII 결과를 소문자로 정규화하고 끝의 점 하나를 제거한다. IPv4/IPv6는 IP parser로 검증하며 IPv6의 UI 괄호를 storage에서 제거한다. DNS를 바꿔가며 다른 주소를 시도하는 무제한 재시도는 없다. connect 한 번에 OS resolver 결과로 한 번 연결하며 실패하면 사용자가 다시 시도한다.

endpoint를 바꾸거나 username을 바꾸면 새 serverId로 복제하고 기존 profile을 유지한다. 연결 중이거나 미해결 작업이 있는 profile은 endpoint·인증 방식 변경과 삭제를 막는다. 표시 이름 변경은 허용하되 이미 생성한 task의 이름 snapshot은 그대로 둔다. 인증 실패는 입력한 방식으로 한 번만 시도하고 비밀번호↔키 자동 fallback은 없다.

hostVerifier는 control·transfer 모두 필수다. 공개 호스트 키 blob으로 SHA-256 지문을 계산하고 endpoint별 저장된 blob과 byte 단위로 비교한다. 신규 endpoint면 첫 socket에서 지문을 수집하고 verifier=false로 종료한 후 확인창을 연다. 인증 정보는 보내지 않는다. 확인창은 120초 후 만료한다. 승인된 지문을 JSON에 저장한 뒤 새 연결을 열고 다시 일치 검사한다. 그 사이 키가 바뀌면 차단한다. 저장 실패면 연결하지 않는다.

불일치는 `HOST_KEY_CHANGED`로 종료하며 무시·자동 교체·자동 known_hosts 삭제 버튼은 없다. 사용자가 연결이 종료된 설정 화면에서 기존 endpoint 신뢰를 삭제하고 다음 연결의 신규 지문을 다시 승인할 수는 있다. 신뢰 삭제 시 해당 endpoint의 모든 profile 연결·대기 작업을 먼저 종료하고 비밀정보를 재전송하지 않는다. 시스템 `~/.ssh/known_hosts`와 `~/.ssh/config`를 자동 읽거나 수정하지 않는다.

인증 지원은 password, OpenSSH v1 개인키(Ed25519, RSA 2048bit 이상), PKCS#1 RSA PEM이다. 각 형식의 암호화/비암호화 파일을 검사한다. key 최대 크기는 512KiB다. password/passphrase 입력은 최대 1,024 UTF-8 byte다. PPK, PKCS#8 입력 파일, DSA, ECDSA 사용자키, SSH 인증서, FIDO key, 외부 agent, keyboard-interactive/MFA는 `AUTH_UNSUPPORTED`로 설명하고 변환·다른 방식 fallback을 하지 않는다. public key `.pub`를 개인키로 받지 않는다.

RSA 인증은 SHA-2 서명을 사용한다. ssh2의 기본 privateKey 경로는 SHA-1 fallback이 있으므로 그대로 사용하지 않는다. 공개 `BaseAgent` API를 구현한 프로세스 내부 단일키 서명 adapter를 사용한다. getIdentities는 선택한 공개키 하나만 반환하고 sign은 요청 pubKey가 선택키와 같은지 검사한다. RSA에서는 options.hash가 sha256 또는 sha512인 경우에만 Node crypto.sign과 RSA_PKCS1_PADDING으로 raw signature Buffer를 생성한다. sha1·undefined·다른 값은 서명 없이 callback(error)다. Ed25519는 Node crypto.sign(null,data,key)로 처리한다. callback은 정확히 한 번 호출한다. authHandler는 이 adapter 한 번만 제시하고 소진 뒤 false를 반환한다. 이것은 내부 서명 API 사용이며 외부 ssh-agent·Pageant·agent socket·forwarding 지원이 아니다. D01에서 server-sig-algs 미제공/sha1-only fixture에 서명된 SHA-1 인증이 전송되지 않는지 검사한다.

협상 allowlist: KEX는 curve25519-sha256, curve25519-sha256@libssh.org, ecdh-sha2-nistp256, ecdh-sha2-nistp384, ecdh-sha2-nistp521, diffie-hellman-group16-sha512; 서버키는 ssh-ed25519, rsa-sha2-512, rsa-sha2-256, ecdsa-sha2-nistp256, ecdsa-sha2-nistp384, ecdsa-sha2-nistp521; cipher는 aes256-gcm@openssh.com, aes128-gcm@openssh.com, aes256-ctr, aes128-ctr; MAC는 hmac-sha2-512-etm@openssh.com, hmac-sha2-256-etm@openssh.com, hmac-sha2-512, hmac-sha2-256; compression은 none이다. 라이브러리에서 지원하지 않는 이름은 빌드 검증 실패로 처리하며 구현자가 allowlist를 줄이거나 약한 알고리즘을 추가하지 않는다. 고정 버전 API에서 협상과 public-key signature를 실검증한다.

main은 OS dialog로 선택한 key를 열고 fstat로 512KiB 상한을 먼저 확인한다. 같은 handle에서 최대 512KiB+1byte만 비동기로 읽으며 상한 초과는 즉시 거절한다. 파일 전체 readFile 이후 검사하는 구현은 금지한다. 원본 bytes를 worker로 전달하고 키 복호화·parse·KeyObject 생성은 worker가 소유한 별도 worker_thread에서 실행한다. 동시 key parser는 1개, 기한은 5초이며 초과 시 그 thread만 terminate한다. 기존 SSH event loop를 막거나 모든 연결을 죽이는 timeout 구현은 금지한다. OpenSSH bcrypt rounds는 1–100을 지원하고 초과는 KEY_INVALID다. parser thread는 ssh2 parsed key의 공개 getPrivatePEM 결과를 Node KeyObject로 읽어 PKCS#8 PEM으로 export한다. 이 PEM은 내부 전달에만 사용하고 worker가 KeyObject로 만든다. parsed-key 클래스 인스턴스를 MessagePort로 보내지 않는다. 원본 PKCS#8 입력 파일 미지원과 내부 표준 PEM 변환을 구분한다.

password/passphrase/key의 메모리 보관은 해당 연결 세션 동안만 허용한다. transfer 연결 재인증에 재사용하고 profile disconnect·worker 사망·앱 종료 때 참조를 폐기하며 Buffer는 가능한 범위에서 덮어쓴다. JavaScript 문자열·OS dump의 물리적 완전 소거는 보장하지 않는다. saveSecret=false는 디스크 저장 금지이며 세션 메모리 보관 금지가 아니다. 비밀번호 폼은 제출 후 비우고 저장된 비밀을 renderer에 다시 보내는 API는 없다.

## 6. 연결 수명과 기능 탐지

연결 상태는 `idle → connecting → authenticating → connected → disconnecting → disconnected`다. 새 호스트는 connecting에서 socket을 닫고 `awaiting_host_trust`, 승인 후 새 connecting으로 간다. 취소는 disconnected, 실패는 failed이며 사용자가 connect를 누르면 새 generation을 만든다. 연결된 상태의 rekey는 같은 generation을 유지한다. 하나의 connect 요청이 인증 실패 후 스스로 반복되지 않는다.

연결 ready 후 control SFTP 하나를 연다. 실패하면 연결 정보는 남기되 파일 앱만 잠근다. SFTP가 열리면 realpath('.')를 초기 폴더로 저장하고 `/etc/os-release`를 최대 16KiB 읽는다. 데이터를 shell source로 실행하지 않는다. ID/VERSION_ID 두 키만 문자 parser로 읽고 중복키·용량 초과·형식 오류는 OS 미확인이다. chroot의 접근 가능한 root는 SFTP가 제공한 root이며 호스트 전체 root로 추정하지 않는다.

OS 확인은 Ubuntu/24.04일 때 supported, 다른 값은 unsupported, 읽기·형식 실패는 unknown이다. unsupported는 탐색 조회만 허용하고 전송·mutation을 막는다. unknown은 사용자 세션별 확인 전 탐색 조회만 허용한다. 확인 뒤에도 UI는 ‘OS 미확인 · 사용자 확인’으로 유지하고 자동검증으로 표시하지 않는다. capability는 OS, sftp, execProbe, hardlink를 별도 상태로 보관한다. 권한은 실제 경로 요청의 결과로 판정하고 ‘서버 쓰기 가능’이라는 전역 boolean으로 추정하지 않는다.

control은 SFTP 채널 1개와 probe 채널 최대 1개를 사용한다. 파일 목록·mutation·OS읽기는 control SFTP에서 직렬화하고 사용자의 mutation을 probe보다 먼저 처리한다. transfer는 task 시작 시 열고 인증·호스트 검증·SFTP 시작을 다시 수행한다. 한 task가 끝나면 transfer socket을 닫는다. transfer 접속이 서버 접속 제한으로 거절되면 해당 task만 실패한다. control을 전송용으로 전환하거나 다른 서버의 socket을 닫지 않는다.

keepaliveInterval=15000ms, keepaliveCountMax=3을 사용하며 keepalive를 응답시간 값으로 표시하지 않는다. control 종료는 같은 서버 transfer를 닫고 queued task를 `interrupted`로 옮긴다. transfer만 종료되면 control은 유지한다. 다른 서버 작업에는 영향이 없어야 한다. 연결 종료 원인이 불명확하면 `CONNECTION_LOST`로 표시하고 서버 장애·방화벽 문제로 단정하지 않는다.

## 7. 파일 경로와 탐색과 단일 변경

원격 경로는 POSIX 절대경로다. Windows path.join으로 원격 경로를 만들지 않는다. 로컬 경로는 해당 OS API를 사용한다. 원격 표시 이름과 실제 rawName을 별도 값으로 보관하고 HTML escape 결과를 요청 경로로 재사용하지 않는다. basename은 1–255 UTF-8 byte, 전체 원격 경로는 최대 4096byte다. 단일 이름에 `/`, NUL, `.`와 `..`, U+0001–001F, U+007F, U+FFFD, U+202A–202E, U+2066–2069를 허용하지 않는다. 원격의 정규화(NFC/NFD)·대소문자를 임의 변경하지 않는다. 변환이 손실되는 항목은 escape 표시 후 모든 파일 동작을 비활성화한다. ssh2가 이미 replacement character로 decode한 경우 원래 byte를 복원했다고 주장하지 않는다.

목록의 `.`와 `..`는 항목으로 사용하지 않는다. 부모 이동은 별도 버튼으로 canonical parent를 구한다. symlink·FIFO·socket·device·알 수 없는 type은 조회 정보만 표시하고 열기·전송·변경을 비활성화한다. 로컬 dialog에서도 lstat로 식별되는 symlink·Windows junction을 거절한다. Node fs만으로 모든 reparse tag나 cloud placeholder를 식별하거나 Windows 파일시스템 이름을 확정한다고 주장하지 않는다. 해당 위치는 지원 범위 밖이며 dialog에 로컬 일반 파일·폴더만 지원함을 표시한다. network UNC 경로는 거절한다. 최종 exclusive link 성공이 해당 목적지 기능의 실행 기준이며 실제 검증 환경은 APFS/NTFS로 한정한다. 일반 파일 handle을 연 뒤 fstat하여 다시 확인한다. 원격은 mutation 직전 lstat와 parent realpath를 다시 확인한다. SFTP의 path 기반 API는 외부 동시 경로 교체를 원자적으로 막을 수 없으므로 그 범위를 보장하지 않는다.

목록은 opendir/readdir/close로 읽고 상한을 넘으면 handle을 닫는다. 첫 10,000항목을 전체 목록이라고 표시하지 않는다. 폴더 우선, 그 다음 Unicode code point 오름차순 이름 정렬을 기본으로 한다. 숨김 파일 기본 표시이며 토글은 서버별 세션 메모리에 보관한다. 필터는 현재 읽은 목록의 이름 부분 문자열만 대상으로 하며 서버 전체 검색 기능이 아니다. 새로고침은 explicit이며 자동 recursive scan은 없다. 각 directoryToken 요청에 별도 requestId를 붙여 다른 탭으로 늦게 도착한 목록을 덮어쓰지 않는다.

Windows 다운로드 이름은 `< > : " / \ | ? *`, 제어문자, 끝의 공백/점, CON/PRN/AUX/NUL/COM1–9/LPT1–9(확장자 포함)를 거절하고 다른 이름을 입력받는다. macOS에서도 `/`·NUL과 위 공통 금지문자는 거절한다. case-insensitive·Unicode alias 충돌은 사전 문자열 비교만 믿지 않고 최종 exclusive link 결과로 결정한다. 이름을 자동 치환하지 않는다.

새 폴더는 새 이름과 대상 서버·전체 경로 preview를 확인한 뒤 intent 저장→mkdir(mode0700)→ACK→lstat(directory)→receipt로 처리한다. 기존 이름은 충돌이다. 삭제는 preview 확인 후 lstat 일반 파일이면 unlink, 폴더이면 rmdir만 사용한다. root·현재 작업 중 경로·비어 있지 않은 폴더는 거절한다. pre-check empty라도 rmdir의 결과가 최종 기준이다. recursive fallback과 shell rm은 없다.

일반 파일 이름 변경은 같은 폴더에서만 한다. lstat source 일반 파일 확인→intent 저장→ext_openssh_hardlink(source,newName)→ACK 저장→unlink(source)→ACK 저장 순서다. newName이 있으면 실패하고 source를 유지한다. hardlink 미지원이면 변경하지 않는다. 새 이름 성공 후 source 제거 실패는 `partial`이며 두 경로를 표시한다. source 제거 ACK 유실은 `result_unknown`에 단계 정보를 붙인다. 이전 source를 자동 제거하는 재시도와 새 이름 rollback 삭제는 하지 않는다.

모든 task가 source·destination canonical 경로에 앱 내부 lock을 잡고 parent는 존재 보존 대상으로 등록한다. 같은 경로 또는 그 조상 경로를 삭제·이름 변경하는 mutation은 대기시킨다. 같은 parent의 서로 다른 자식 생성·전송끼리는 충돌시키지 않는다. 전송 source의 삭제·이름 변경도 대기시킨다. read-only 탐색은 허용한다. lock은 terminal 상태와 receipt 기록 처리 뒤 해제하며 socket이 살아 있는 늦은 요청을 방치한 상태에서 해제하지 않는다. 앱 밖의 동시 작업을 lock으로 통제한다고 주장하지 않는다.

control SFTP 요청이 15초 deadline을 넘기면 control을 quarantine으로 지정해 새 요청을 막고 socket을 종료한다. 같은 서버 transfer도 §6 규칙으로 종료한다. 변경 요청은 result_unknown, 조회는 IO_TIMEOUT이다. close 확인 또는 destroy 처리 후 runtime lock을 해제하되, 결과 불명 source/destination은 unresolved-path 제한으로 보존하여 사용자 ‘확인 후 기록 닫기’ 전 같은 경로 mutation을 막는다. 재접속은 새 generation이며 이전 callback은 폐기한다. probe timeout은 이 규칙의 예외로 §10에 따라 probe만 정리한다.

## 8. 비동기 전송의 상태와 확정 알고리즘

전송 task에는 taskId, direction, endpointSnapshot, hostKeyFingerprint, serverId, generation, source, destination, tempPath, sourceInitialStat, totalBytes, transferredBytes, verifiedBytes, streamSha256, phase, cleanupState, lastConfirmedPhase, createdAt, updatedAt를 저장한다. source/destination/서버는 생성 이후 불변이다. 인증 정보는 포함하지 않는다. 작업별 값과 서버·프로필 snapshot을 영수증 안에 완결해 다른 JSON 파일과의 transaction을 요구하지 않는다.

작업 큐는 `(enqueuedSequence, taskId)` 순서의 실행 가능한 가장 오래된 작업을 선택한다. 서버당 1개 슬롯과 경로 lock을 만족하지 못한 작업은 다른 서버 작업을 막지 않는다. 동시 추가와 취소는 worker event loop의 단일 reducer가 처리한다. 대기 작업을 userData에서 복원해 자동 실행하지 않는다.

| 상태 | 진입 조건 | 허용 다음 상태 |
| --- | --- | --- |
| queued | 사용자 enqueue와 intent 기록 성공 | preparing, cancelled, interrupted, skipped |
| preparing | 슬롯과 lock 획득, source/destination·인증 확인 | transferring, cancel_requested, failed, interrupted, result_unknown |
| transferring | 임시파일 생성 확인 후 byte 전송 | verifying, cancel_requested, failed, interrupted, result_unknown |
| verifying | byte 전송 종료, source 확인, temp read-back | finalize_intent_pending, cancel_requested, failed, interrupted, result_unknown |
| finalize_intent_pending | reducer가 최종화 선택, 취소 잠금, intent 저장 대기 | finalizing, failed, interrupted |
| finalizing | finalization intent 저장 성공, link dispatch 허용 | completed, failed, result_unknown |
| cancel_requested | 취소 가능한 상태에서 reducer가 요청 수락 | cancelled, result_unknown |
| completed | 내용·목적지 생성·receipt 저장 확인 | terminal |
| failed | 실패가 확정됐고 목적지 생성이 확인되지 않음 | terminal |
| interrupted | finalization 전 연결·worker·앱 중단. 실행된 최종 생성 요청 없음 | terminal |
| cancelled | finalization 전 취소를 수락하고 task socket이 종료됨 | terminal |
| result_unknown | temp 생성·목적지 생성 등 변경의 결과가 불명 | terminal |
| skipped | 충돌 preview에서 사용자가 해당 항목 건너뜀 | terminal |

단일 mkdir/delete/rename에는 `prepared`, `dispatched`, `completed`, `failed`, `partial`, `result_unknown`을 사용한다. 위 전송 상태에 의미 없이 끼워 넣지 않는다. terminal은 같은 task의 자동 재실행 금지를 뜻한다. 사용자 새 시도는 새 preview와 새 taskId다. 상태를 수동으로 completed로 바꾸는 버튼은 없다.

`cleanupState`는 none, confirmed, needed, unknown이다. completed+needed는 ‘완료 · 임시 파일 정리 필요’, cancelled+needed는 ‘취소됨 · 임시 파일 정리 필요’로 표시한다. 최종 목적지 성공과 temp 정리 실패를 동일 실패로 합치지 않는다. finalization ACK 후 영수증 저장이 실패하면 메모리상 ‘목적지 생성 확인 · 기록 저장 실패’ 경고를 유지하고 신규 mutation을 잠근다. 재실행 후 디스크에 finalizing만 남아 있으면 result_unknown으로 복원한다.

### 8.1 공통 준비와 충돌

사용자가 OS dialog로 업로드 파일 또는 다운로드 폴더를 선택하면 main이 실제 경로와 local identity를 capability에 저장한다. renderer에는 표시명과 token만 반환한다. 여러 파일의 preview는 유효·충돌·미지원 항목을 모두 나열한다. 선택한 파일 일부가 잘못돼도 조용히 누락하지 않는다. 사용자가 유효 항목만 진행하거나 전체 취소를 선택한다. 존재하는 목적지는 다른 이름, 건너뛰기, 요청 취소만 허용한다. 사용자가 기존 파일 삭제 후 다시 전송하도록 자동 안내하지 않는다.

작업 시작 시 source를 다시 열고 일반 파일임과 64GiB 이하임을 fstat로 검증한다. 크기·mtime가 enqueue preview와 달라졌으면 SOURCE_CHANGED로 중단하고 새 선택을 요구한다. 전송 도중 같은 source handle로 끝까지 읽고 마지막 fstat를 처음 값과 비교한다. 같은 size/mtime를 유지한 외부 동시 수정을 완전히 탐지하거나 source snapshot을 보장하지 않는다. 지원하지 않는 local volume·hardlink 오류는 명확히 실패시키며 일반 rename/copy fallback을 쓰지 않는다.

임시 basename은 `.sshos-<taskId>.part`다. 기존 파일을 열지 않도록 local `open('wx',0600)` 또는 SFTP `open('wx',0600)`를 사용한다. 충돌 시 task 실패이며 기존 temp를 삭제하지 않는다. taskId/tempPath/endpoint/hostKey/intent를 먼저 저장한다. 생성 ACK 후 created 사실을 다시 기록한다. 이 기록이 실패하면 데이터 전송을 시작하지 않고 task socket을 닫는다. 생성 ACK 유실은 result_unknown이다. basename 패턴만으로 소유권을 추정하지 않는다.

### 8.2 업로드

1. source handle을 열고 fstat, 목적지 parent의 realpath와 lstat를 확인한다. parent가 바뀌었거나 source/parent가 미지원 type이면 중단한다.
2. temp 생성 intent를 저장하고 같은 원격 parent에 `wx`로 생성한다. ACK 후 created 기록을 저장한다.
3. 32KiB chunk, 최대 16개 미완료 SFTP write로 bounded pipeline을 실행한다. write ACK를 받은 byte만 transferredBytes에 합산한다. 같은 offset 재전송은 라이브러리 요청 수준에서 임의 구현하지 않는다. source read-backpressure를 적용하고 전체파일 Buffer를 만들지 않는다.
4. source bytes의 SHA-256을 계산한다. EOF와 모든 write ACK, remote handle close ACK를 확인한다. source fstat가 바뀌면 SOURCE_CHANGED다. temp의 lstat 크기가 totalBytes와 같아야 한다.
5. 같은 transfer SFTP에서 temp를 다시 read하여 SHA-256과 총 byte를 대조한다. 검증 read는 임의 checksum 명령을 실행하지 않는다. 읽기 권한이 없으면 VERIFY_READ_DENIED로 실패한다. 0byte도 empty SHA-256·close·size를 검사한다.
6. 검증 성공 뒤 reducer가 cancel 요청보다 먼저 finalize_intent_pending으로 진입하면 즉시 취소를 잠근다. 메모리 상태는 pending이어도 durable receipt에는 `phase=finalizing, dispatchAllowed=true`를 저장한다. 이 저장 성공 ACK 이후에만 메모리를 finalizing으로 전환하고 link를 보낸다. 디스크에 finalize_intent_pending은 저장하지 않는다. 저장 실패는 STORAGE_FAILED이고 link를 보내지 않는다. 저장 성공 후 dispatch 전 crash도 보수적으로 result_unknown이다.
7. `ext_openssh_hardlink(temp,destination)`을 호출한다. 성공 ACK를 받은 뒤 목적지가 일반 파일이고 크기가 맞는지 lstat한다. 기존 목적지가 있으면 실패하며 제거하지 않는다. ext 미지원·EXDEV·권한 오류는 실패이고 일반 rename·posix-rename·destination unlink로 우회하지 않는다. 확장 지원을 확인하려고 로그인 때 임의 probe 파일을 생성하지 않는다. 지원 여부가 unknown이면 이 최초 사용자 작업의 실제 결과로 판정한다.
8. 목적지 생성 확인을 영수증에 저장한다. 그 뒤 temp unlink를 요청하고 결과를 별도로 저장한다. unlink 실패여도 destination을 rollback 삭제하지 않는다. 완료 기록을 저장한 뒤 UI completed를 내보낸다.

전량 read-back은 원격 데이터를 다시 다운로드하므로 전송량과 시간이 증가한다. 이 비용을 문서와 확인 중 UI에서 숨기지 않는다. SSH transport 무결성과 앱의 read-back 검증을 구분한다. source metadata 변화가 없고 해시가 일치해도 다른 외부 프로세스가 개입하지 않았음을 증명하는 것은 아니다.

### 8.3 다운로드

1. source remote handle을 열어 fstat와 type·size를 확인한다. source를 읽는 동안 그 handle을 유지한다.
2. main이 승인한 로컬 destination parent의 temp 생성 intent를 먼저 durable 저장한다. 성공한 뒤 temp를 `wx`로 만들고 created를 durable 저장한다. 목적지 파일을 먼저 만들지 않는다.
3. 32KiB chunk, 최대 16개 미완료 read의 제한 아래 순서대로 로컬 파일에 쓴다. short read와 short local write는 실제 처리된 길이를 반영하고 나머지 부분을 처리한다. 요청 개수·offset을 32bit 정수 연산으로 자르지 않는다.
4. SHA-256을 계산하고 EOF, byte 수, source 마지막 fstat, remote close를 확인한다. local FileHandle.sync와 close를 확인한다. temp를 재개방해 local SHA-256과 size를 대조한다.
5. 업로드와 같은 finalize_intent_pending 취소 잠금·durable intent·finalizing 순서를 거친 뒤 `fs.link(temp,destination)`으로 최종 이름을 배타 생성한다. existing/case/normalization 충돌이면 실패한다. local rename, COPYFILE fallback, 기존 파일 삭제는 금지한다.
6. destination lstat와 크기를 확인하고 생성 확인 기록을 저장한 뒤 temp를 제거하고 완료 기록을 저장한다. 제거 실패와 destination 성공을 분리한다.

APFS/NTFS의 같은 디렉터리 hardlink를 첫 출시 검사 대상으로 삼는다. 네트워크 share, 지원하지 않는 volume의 결과를 동일하게 보장하지 않는다. 파일 bytes는 동일해도 mode/owner/ACL/mtime/xattr는 원본과 동일하다고 표시하지 않는다.

### 8.4 취소와 중단과 결과 불명

queued 취소는 socket·temp를 만들지 않고 cancelled다. preparing/transferring/verifying의 취소는 reducer가 수락하는 즉시 cancel_requested로 전환하고 새 I/O를 막는다. 5초 내 해당 transfer stream/socket을 닫는다. 다른 task·control·다른 서버를 닫지 않는다. temp 생성 ACK가 확인됐고 같은 세션에서 task 소유 경로라는 기록이 있으면 정상 연결이 유지된 범위에서 한 번 정리를 시도할 수 있다. 경로 type/parent가 달라졌거나 socket이 불명 상태면 자동 정리하지 않는다. socket 종료는 서버가 temp를 제거했다는 증거가 아니다.

finalize_intent_pending 진입 이후 취소는 `CANCEL_TOO_LATE`이며 요청을 수락했다고 표시하지 않는다. 취소와 최종화가 경합하면 worker의 직렬 reducer가 먼저 처리한 전이가 승자다. cancel_requested가 먼저면 link를 보내지 않는다. finalize_intent_pending이 먼저면 저장을 기다리는 동안에도 취소를 거절한다. UI는 pending/finalizing 모두 ‘최종 파일 생성 준비·처리 중’으로 표시하고 취소 버튼을 비활성화한다.

final link ACK가 유실되면 result_unknown이다. link ACK와 destination 확인은 성공했고 temp unlink ACK만 유실되면 completed+unknown이다. mkdir/delete/rename ACK 유실도 해당 단계 result_unknown이다. 실패 코드를 받았다는 사실과 socket이 닫혔다는 사실을 구분한다. timeout 후 늦은 성공 callback은 기존 세대 기록에 관측 사실로만 붙이며 종료된 task를 새로 completed로 승격하지 않는다.

앱 재실행 시 queued는 interrupted, finalization 전 created 작업은 interrupted+needed 또는 result_unknown(생성 여부 불명), finalizing/dispatched는 result_unknown, completed는 기록대로 복원한다. finalize_intent_pending은 디스크에 저장하지 않지만 잘못된 과거 기록에 있으면 result_unknown으로 분류한다. §11의 backup 복원 규칙은 이 정상 current 복원 규칙보다 우선한다. 마지막 기록에 없는 성공을 추측하지 않는다. 이전 task의 temp를 이름 패턴으로 찾거나 자동 삭제하지 않는다. task의 ‘위치 열기’는 현재 상태를 읽기만 한다. 현재 파일 size/hash가 같아도 과거 요청의 성공을 소급 확정하지 않는다. 사용자가 ‘확인 후 기록 닫기’를 선택하면 acknowledgedAt을 추가하고 원래 result_unknown을 보존한다. 이것은 완료 승격이 아니다.

## 9. 진행 표시와 작업 수명

transferredBytes는 ACK/실제 write에 근거한 정수로 단조 증가하고 totalBytes를 초과할 수 없다. 전송률은 `transferredBytes/totalBytes`이며 0byte는 byte단계 종료까지 0%, 그 후 100%로 표시한다. 100% 뒤 검증 중인 경우 큰 상태 문구는 ‘내용 확인 중’이다. verifiedBytes/totalBytes를 별도 표시한다. 검증량을 원래 전송 byte에 더해 200%를 만들지 않는다.

속도는 monotonic clock의 최근 3초 처리 byte 합/실제 경과시간이다. 첫 sample 전과 3초간 진전이 없으면 `—`다. 전송 단계에서는 전송 속도, 검증 단계에서는 검증 속도로 label을 바꾼다. ETA는 v5에서 제공하지 않는다. terminal 상태에는 속도를 표시하지 않는다. connection response sample과 transfer speed를 서로 환산하지 않는다.

상태 변경은 중앙 snapshot에 반영하고 renderer는 taskId별로 표시한다. 타 서버의 같은 파일명으로 결과를 합치지 않는다. 탭을 닫아도 main/worker task를 취소하지 않는다. 프로필 해제는 실행 작업 목록을 보여주고 ‘연결 유지’ 또는 ‘작업 중단 후 연결 해제’를 선택받는다. latter는 취소 가능한 task를 취소하고 finalizing은 기한까지 기다린 뒤 불확정이면 result_unknown으로 종료한다.

앱 close에는 실행·대기·미확인 작업 수를 보여주고 ‘계속 실행’ 또는 ‘작업 중단 후 종료’를 제공한다. 창을 닫으면 트레이에서 조용히 계속 실행하는 모드는 없다. OS 강제 종료를 막을 수 있다고 주장하지 않는다. renderer crash는 main/worker를 자동 종료하지 않고 UI를 다시 열었을 때 snapshot을 복원한다. worker crash는 모든 해당 연결을 종료하고 task 단계를 복원 규칙으로 분류한다. ‘연결 엔진 다시 시작’은 사용자가 누르는 동작이며 재인증·새 generation을 요구한다.

절전 진입 시 probe를 무효화하고 가능한 한 task interrupt intent를 저장하고 socket을 닫는다. 이벤트를 받지 못한 강제 suspend도 복귀 시 기존 generation을 폐기한다. 자동 재접속·자동 전송 재개는 없다. OS clock을 바꿔도 timeout/속도가 역전되지 않게 monotonic clock을 사용한다. UTC wall clock은 기록 시각 표시에만 사용한다.

## 10. SSH 응답시간

probe는 활성 서버가 있고 앱이 foreground이며 control SSH가 authenticated일 때만 실행한다. 사용자 OS확인 여부와 파일 capability는 probe 허용 조건에 포함하지 않는다. exec가 허용된 연결에서만 실행한다. 명령은 byte 단위 고정 `/bin/true`이며 사용자의 파일명·서버명·환경값을 연결하지 않는다. PTY, X11, agent forwarding, env 전달을 하지 않는다.

worker가 실제 exec 호출 직전에 monotonic 시작값을 잡고 exit code=0, signal 없음, channel error 없음, 요청 후 5초 이내 channel close를 모두 확인한 경우에만 sample을 만든다. stdout+stderr는 합계 4KiB까지만 소비하고 보관하지 않는다. 초과·exit 누락·nonzero·exec 거절은 해당 session에서 unavailable이며 반복 probe를 중지한다. ForceCommand가 요청을 바꿀 수 있으므로 서버가 이 요청에 부수효과를 일으키지 않는다는 절대 보장은 하지 않는다.

5초 timeout이면 숫자를 기록하지 않고 delayed를 표시한다. 늦은 exec callback이 미정리인 동안 새 probe를 만들지 않는다. 나중에 반환된 channel은 즉시 닫고 sample을 버린다. 영원히 callback이 오지 않아도 해당 세션에서 새 요청을 누적하지 않는다. 연결을 측정 때문에 강제로 끊지 않는다. 사용자 파일 작업으로 채널을 확보할 수 없으면 waiting이다. 전송 중 측정은 transferActive=true로 tooltip에 표시한다.

sample={serverId,sessionGeneration,backendEpoch,probeEpoch,probeId,elapsedMs,measuredAt,transferActive}이며 메모리만 사용한다. 탭 전환·blur·minimize·suspend·reconnect 시 probeEpoch를 변경한다. 복귀 시 기존 값 없이 새 sample을 요청한다. timeout timer뿐 아니라 callback 도착 시 경과시간을 검사한다. keeper debug text나 ssh2 private field를 파싱하여 RTT를 만들지 않는다. 표시 문구는 제품 계획서 §7의 표를 그대로 사용한다.

## 11. JSON 저장과 장애 복구

production userData는 Electron app name을 `sshOS`로 고정한 OS별 기본 사용자 데이터 경로다. runtime cache는 그 하위 `runtime/`, 기능 데이터는 `data/`로 분리한다. 앱 package·실행파일·키 원본을 덮어쓰지 않는다. 요청하지 않은 시스템 SSH 파일을 수정하지 않는다. 같은 userData에 대해 `app.requestSingleInstanceLock()`을 확보한 프로세스 하나만 writer가 된다. 두 번째 실행은 기존 창을 활성화하고 즉시 종료한다.

`data/state.json` 하나에 schemaVersion=1, revision, profiles, hostTrust, encryptedSecrets, settings를 저장한다. 참조되는 secret과 profile을 같은 파일 교체로 반영한다. receipts는 `data/receipts/<taskId>.json`으로 분리하며 operation마다 endpoint·hostKey·경로 snapshot이 자체 완결된다. 한 번의 JSON 교체가 원격 요청과 transaction을 이룬다고 주장하지 않는다.

각 파일 envelope는 schemaVersion, revision(안전 정수), payload, payloadSha256이다. checksum은 payload의 JSON key를 재귀적으로 code-point 오름차순 정렬하고 UTF-8 JSON 직렬화한 값의 SHA-256이다. 배열 순서는 보존한다. undefined, NaN, Infinity, bigint를 허용하지 않는다. checksum은 손상 탐지이며 악의적 로컬 수정의 인증 코드가 아니다. state 최대 1MiB, receipt 최대 64KiB다. parse 전에 byte 상한을 확인하고 strict schema·checksum·revision을 검사한다.

단일 writer의 저장 순서: 새 내용을 동일 디렉터리 UUID `.tmp`에 `wx/0600`으로 작성→FileHandle.sync→close→기존 유효 current를 검증한 backup temp로 복사·sync·backup atomic replace→새 temp를 current에 atomic replace→지원되는 경우 parent directory fsync. 기존 current를 먼저 unlink하지 않는다. Windows 파일 잠금으로 replace가 실패하면 100/200/400ms 간격으로 최대 3회 재시도하고 이후 실패한다. 전체 5초 deadline을 넘긴 저장은 writer를 fault 상태로 잠그고 진행 중 I/O의 정리 결과를 기다리며 새 writer를 겹쳐 만들지 않는다. 디렉터리 fsync가 지원되지 않는 플랫폼에서는 불가 사실을 기록하고 정전 내구성을 과장하지 않는다.

receipt를 backup에서 복원하면 이전 단계가 queued/verifying였더라도 더 최신 dispatch가 유실됐을 수 있다. 해당 receipt는 recoveryUncertain=true와 result_unknown으로 복원하고 자동 실행·정리를 금지한다. backup의 종결 상태도 과거 관측 기록으로 보존하되 최신성 불명과 result_unknown을 표시한다.

시작 시 current가 유효하면 사용한다. current가 없거나 깨졌고 backup만 유효하면 사용자에게 복구본 사용을 알리고, 복구된 hostTrust는 재승인 전 비신뢰 상태로 둔다. 복원 profile의 비밀은 새 host 검증 전 인증에 쓰지 않는다. 두 사본이 모두 잘못되면 연결과 변경 기능을 잠그고 파일 경로·고정 오류를 표시한다. 자동 빈 초기화·자동 전체 삭제·손상 파일 덮어쓰기는 금지한다. 알 수 없는 높은 schemaVersion은 downgrade로 덮어쓰지 않는다.

원격 mutation 전 intent 저장 실패는 dispatch 금지다. mutation ACK 후 저장 실패는 원격 실패로 변환하지 않고 기록 오류를 별도로 표시한다. 앱 전체 storage fault 동안 새 mutation·transfer enqueue·trust 변경을 잠그지만 읽기 전용 탐색·연결 해제는 허용한다. 저장 재시도는 사용자가 ‘저장소 다시 확인’을 선택하고 writer queue와 파일 검증이 완료된 뒤에만 가능하다. 디스크 부족·권한 거절·읽기 전용·파일 잠금 fixture를 모두 시험한다.

미해결 receipt는 자동 prune하지 않는다. terminal receipt만 시작 시 1회 정리하며 원격 파일을 지우지 않는다. 사용자가 기록을 지우면 로컬 receipt만 제거한다. profile 삭제도 원격 파일이나 원격 계정을 삭제하지 않는다. 손상 receipt 하나는 해당 작업만 ‘기록 손상’으로 표시하고 다른 receipt를 삭제하지 않는다. orphan secret 참조는 인증 실패로 처리하고 다른 profile의 secret을 대체 사용하지 않는다.

## 12. 비밀정보와 로그와 외부 통신

Electron 45 기준 safeStorage 비동기 API를 사용한다: app.ready 이후 isAsyncEncryptionAvailable, encryptStringAsync, decryptStringAsync. 저장 default는 false다. encrypt 실패·OS 잠금·decrypt 실패는 SECRET_UNAVAILABLE이며 평문·고정 비밀번호·다른 crypto library fallback은 금지한다. encrypt 결과 Buffer는 base64로 state에 저장하고 사용자명·endpoint·secretId 연결을 schema로 확인한다.

decryptStringAsync 성공값은 문자열이 아니라 `{result:string, shouldReEncrypt:boolean}`이다. result만 인증 입력에 사용한다. shouldReEncrypt=true면 result를 encryptStringAsync로 다시 암호화하고 같은 secretId를 단일 writer로 교체한 뒤 사용한다. 교체 실패 시 기존 암호문을 유지하고 STORAGE_FAILED를 표시하며 그 저장 비밀을 사용한 새 인증을 중단한다. Promise reject는 SECRET_UNAVAILABLE이고 무한 decrypt 재호출을 하지 않는다. D01에서 정상·재암호화·일시 사용불가·타 PC 복호화 실패를 검사한다. macOS 서명 identity를 업데이트마다 유지하여 Keychain 접근 연속성을 검사한다. Windows DPAPI는 같은 사용자 계정의 악성 프로그램까지 격리하지 못한다.

로그는 errorCode, taskId, state transition, 시간, 앱 버전만 기본 저장한다. password, passphrase, private key, file bytes, 원문 SSH debug, server banner, username, host/IP, 전체경로를 기본 로그에 넣지 않는다. log 1개 최대 1MiB, 3개 rotation으로 제한한다. 사용자 진단 내보내기는 OS save dialog 이후 redacted JSON만 쓰고 내용 preview를 제공한다. 작업 receipt에는 사용자에게 필요한 endpoint/path가 로컬로 저장되므로 비밀 로그와 동일하게 익명이라고 설명하지 않는다.

제품의 자동 네트워크 통신은 사용자가 선택한 SSH endpoint와 그 host 해석에 필요한 OS DNS뿐이다. 검색·AI·analytics·crash upload·자동 업데이트·원격 글꼴·CDN 요청은 없다. Renderer connect-src none과 session webRequest 차단으로 웹 요청을 막고 main에 HTTP fetch 기능을 만들지 않는다. OS의 코드서명 검증·보안 프로그램 자체 통신까지 앱이 차단한다고 약속하지 않는다. app은 listen socket·로컬 관리 HTTP port를 열지 않는다. 개발용 Vite server는 개발 환경에서만 존재한다.

공격 모델은 신뢰하지 않는 원격 파일명·메시지, 조작된 IPC, 경로·세션 혼동, 호스트 키 변경, 저장 손상, dependency supply chain이다. 악성 서버나 OS 계정 전체 장악에 대한 완전 방어는 범위 밖이지만, 그 경우에도 원격 문자열의 코드 실행·외부 전송·자동 shell 실행은 허용하지 않는다.

## 13. 고정 오류 설명과 행동

오류 UI는 `{code, userMessage, confirmedPhase, affectedTarget, actions, technicalDetails}`다. 원문 stack은 기본 화면에 표시하지 않는다. 기술 상세도 credential·raw debug를 제거한다. 네트워크 실패를 추측으로 ‘비밀번호 틀림’이나 ‘방화벽 문제’로 바꾸지 않는다. 아래 표의 행동은 앱에 이미 있는 화면으로 이동하거나 사용자가 명시적으로 새 요청을 시작하는 것뿐이다. 검색·AI·자동 수정은 없다.

| 코드 | 사용자 문구 | 허용 행동 |
| --- | --- | --- |
| INPUT_INVALID | 입력 형식이 올바르지 않습니다. | 잘못된 필드 표시 |
| HOST_TRUST_REQUIRED | 처음 연결하는 서버입니다. 호스트 지문을 확인하세요. | 승인 또는 취소 |
| HOST_KEY_CHANGED | 저장한 서버 키와 현재 키가 다릅니다. 연결을 중단했습니다. | 연결 설정·저장 지문 보기 |
| CONNECT_TIMEOUT | 제한 시간 안에 SSH 연결을 완료하지 못했습니다. | 주소·포트 설정 보기, 다시 연결 |
| CONNECTION_LOST | SSH 연결이 끊겼습니다. | 결과 상태 보기, 새로 연결 |
| AUTH_FAILED | 서버가 로그인을 허용하지 않았습니다. | 계정·인증 설정 수정 |
| KEY_INVALID / AUTH_UNSUPPORTED | 이 개인키 형식 또는 인증 방식은 지원하지 않습니다. | 다른 키 선택, 지원 형식 보기 |
| SECRET_UNAVAILABLE | 저장한 인증 정보를 사용할 수 없습니다. | 다시 입력, 저장 끄기 |
| SFTP_UNAVAILABLE | 이 연결에서 파일 전송 기능을 사용할 수 없습니다. | 연결 정보 보기 |
| OS_UNSUPPORTED | 현재 확인된 서버 OS는 지원 대상이 아닙니다. | 확인된 OS 보기 |
| OS_UNKNOWN | 서버 OS를 확인하지 못했습니다. | 세션별 Ubuntu 24.04 확인 또는 조회 유지 |
| PATH_UNSUPPORTED | 이 이름 또는 파일 종류는 지원하지 않습니다. | 다른 이름 선택, 항목 건너뛰기 |
| PERMISSION_DENIED | 이 경로에서 요청한 작업을 수행할 권한이 없습니다. | 경로 확인, 작업 취소 |
| NAME_CONFLICT | 같은 이름의 항목이 이미 있습니다. | 다른 이름, 건너뛰기, 취소 |
| HARDLINK_UNSUPPORTED | 이 위치에서는 기존 파일을 보존하는 확정 방식을 사용할 수 없습니다. | 다른 위치 선택 |
| SOURCE_CHANGED | 선택한 이후 원본 파일이 변경됐습니다. | 원본 다시 선택 |
| VERIFY_READ_DENIED | 업로드한 내용을 다시 읽어 확인할 권한이 없습니다. | 결과·임시 경로 보기 |
| VERIFY_MISMATCH | 전송한 내용과 목적지 내용이 일치하지 않습니다. | 작업 결과 보기 |
| IO_TIMEOUT | 작업 응답이 제한 시간 안에 도착하지 않았습니다. | 확인된 단계 보기 |
| CANCEL_TOO_LATE | 최종 파일을 만드는 단계여서 취소할 수 없습니다. | 결과 대기 |
| STORAGE_FAILED | 로컬 기록을 저장하지 못했습니다. 새 변경 작업을 중지했습니다. | 저장 위치 보기, 저장소 다시 확인 |
| RESULT_UNKNOWN | 요청 결과를 확인하지 못했습니다. 자동으로 다시 실행하지 않습니다. | 위치 열기, 확인 후 기록 닫기 |
| PARTIAL_RENAME | 새 이름은 생성됐지만 이전 이름의 제거를 확인하지 못했습니다. | 두 경로 보기 |
| INTERNAL_ERROR | 앱 내부 오류로 작업을 중단했습니다. | 고정 오류 코드와 작업 상태 보기 |

알 수 없는 errno/SFTP FAILURE는 INTERNAL_ERROR 또는 요청 종류의 일반 실패로 분류하고 원인을 지어내지 않는다. 에러 코드와 관측 단계가 result_unknown을 요구하면 일반 실패 문구보다 결과 불명 문구를 우선한다. 삭제 권한 오류에 sudo 버튼이나 chmod 명령을 제안하지 않는다. 문구 매핑의 누락은 테스트 실패다.

## 14. 품질 예산과 지원 매트릭스

아래 수치는 목표 수용 기준이며 아직 측정하지 않았다. 실패 시 같은 판본의 기준을 낮춰 통과 처리하지 않는다. 지원 환경은 Windows 11 x64, macOS 14 arm64, macOS 14 x64 세 target이다. 추가 macOS major는 그 major의 두 architecture에서 아래 필수 시험을 통과한 결과를 release support matrix에 추가한 경우만 공식 지원한다. macOS deployment 최소 버전 14.0을 지정한다. Ubuntu 24.04 LTS amd64/arm64 두 서버와 3client의 6조합 모두 인증·기본 파일·무결성·hosttrust·단절 smoke를 통과해야 한다.

서버 fixture는 Ubuntu의 보안 업데이트가 적용된 OpenSSH 패키지·ext4·일반 사용자 계정이며 패키지 버전과 sshd 설정을 증거에 기록한다. 추가 fixture는 SFTP-only/chroot, exec 차단, SFTP 없음, READ 제한, hardlink 미지원, MaxSessions/접속 제한, 읽기 전용 경로, quota/디스크 가득 참이다. 공격/장애 fixture에만 의도적으로 취약하거나 제한된 설정을 사용한다. 사용자 서버에 시험 설정을 적용하지 않는다.

성능 기준 장비는 각 target에서 RAM 8GiB 이상, SSD, 4 logical CPU 이상이다. 장비 모델·OS build·전원 모드·백그라운드 부하를 기록한다. 네트워크 기준은 100Mbps 제한, RTT 40ms, loss 0이며 별도 장애 시험은 RTT 500/2000ms, loss 1%, 완전 단절이다. 같은 환경으로 5회 반복하고 percentile은 정렬 후 nearest-rank를 사용한다.

| 항목 | 수용 기준 |
| --- | --- |
| 배포 크기 | target별 압축 배포물 250MiB 이하, 해제된 앱 750MiB 이하 |
| 시작 | cold launch 5회 모두 10초 이내, warm 5회 모두 3초 이내에 연결 화면 조작 가능. Windows TEMP 해제 시간 포함 |
| 메모리 | 60초 안정화 뒤 5분간 1초 간격 표본의 p95: 미연결 500MiB 이하, 3서버 연결 650MiB 이하, 2개 전송+검증 800MiB 이하 |
| 메모리 측정 | 앱에 속한 main/renderer/utility/GPU/helper process의 working set 또는 RSS 합. 공유 page 중복 가능성을 기록하고 JS heap 하나로 대체하지 않음 |
| 유휴 CPU | 연결 3개·활성 probe 1개·사용자 입력 없음 상태 5분 평균이 한 logical CPU의 3% 이하 |
| UI 반응 | 로컬 버튼·탭·취소 클릭의 시각 피드백 p95 100ms 이하, 최대 300ms 이하. 원격 응답 완료와 구분 |
| 파일 목록 | 기준 네트워크의 10,000항목 폴더 첫 완전 표시 10초 이하, 이후 스크롤 중 100ms 초과 UI long task 없음 |
| 전송 중 탐색 | 1GiB 파일 2개를 서로 다른 서버로 전송 중 기준 1,000항목 목록을 5초 내 표시 |
| 메모리 안정성 | 연결/전송/취소 100cycle, 각 cycle 10MiB 파일. 마지막 10cycle p95 메모리가 최초 안정화 10cycle p95보다 50MiB 이상 증가하지 않음 |
| 자원 정리 | 종료된 task의 열린 파일 handle·socket·timer가 안정화 후 기준치로 복귀, 반복 증가 없음 |
| 기본 UI | 1120×760과 1600×1000에서 필수 조작 가려짐 없음, OS 배율 100/150/200%에서 조작 가능 |
| 접근성 | 키보드 전체 경로, visible focus, dialog focus trap/복원, 입력 label, 상태 aria-live, 일반 텍스트 대비 4.5:1 이상 |
| 한글 | Windows/macOS IME 조합 중 Enter가 전송·삭제를 실행하지 않음. 한글 파일명·emoji가 손실 없이 표시/요청 |

기준을 충족해도 경쟁 앱보다 빠르다고 발표하지 않는다. 비교 성능 주장은 같은 기능·환경의 별도 비교 결과가 있어야 한다. 제품 가치 G0/G2/G3의 숫자는 제품 계획서 §9가 유일한 정본이다.

## 15. 개발 단계와 완료 조건

모든 단계는 관련 R ID, 변경 파일, 실행 검사 C ID, 결과·환경·증거 경로를 남긴다. 각 단계 종료 시 `docs/implementation-status.json`을 향후 생성해 다음 단계와 실제 실패를 기록한다. 미실행을 pass로 바꾸지 않는다. 필수 검사 실패를 후속 기능으로 덮지 않는다.

| 단계 | 선행 | 구현 산출물 | 단계 종료 조건 |
| --- | --- | --- | --- |
| D01 실행·기술 전제 | 구현 착수 지시, 시험 환경 | exact package/lock, 최소 renderer/preload/main/worker, 배포 설정, dependency/license 목록 | 3target 실행, worker 통신, async safeStorage 저장/복호화, SSH key/hosttrust, SFTP hardlink/read-back 가능 여부, dependency 조합을 실제 확인 |
| D02 저장과 정체성 | D01 | single instance, JSON writer/backup/schema, profile/trust/secret, request schema | 손상·잠금·디스크 부족·backup trust 재승인·중복 instance 시험 통과 |
| D03 연결과 capability | D02 | control/transfer lifecycle, 인증, OS/SFTP/exec 구분 | 인증·hostkey·rekey·SFTP-only·OSunknown/unsupported·socket 상한 시험 통과 |
| D04 작업 공간과 탐색 | D03 | 5영역 UI, tree/list, token, tab, 경로검증 | 탭 서버 귀속, 늦은 목록 폐기, 특수파일/이름, 키보드/IME 검사 통과 |
| D05 파일 변경 | D04 | mkdir, regular rename, nonrecursive delete, durable intent/locks | no-overwrite·partial rename·ACK 유실·확인 대상 일치 검사 통과 |
| D06 비동기 전송 | D05 | 큐, bounded I/O, SHA-256/read-back, exclusive finalize, 진행 shelf | 0byte/일반/5GiB/64GiB경계, 두 서버 동시 전송, collision/cancel/cleanup 검사 통과 |
| D07 응답과 장애 수명 | D06 | probe, sleep/resume, worker/renderer crash, app exit, 기록 복원 | timeout/late callback/중복/오서버 결과/최종화 경계 장애주입 검사 통과 |
| D08 보안과 성능 검수 | D07 | 보안 테스트, 자원 측정, 패키지 네트워크 검사 | R30 사용자 연구를 제외한 필수 기술 F/Q/S 검사 pass, 재현 환경·raw 결과·hash 존재 |
| D09 배포와 기여 문서 | D08 | signed portable/app, SBOM, LICENSE/NOTICE, 대응소스, README/CONTRIBUTING/SECURITY | 3target clean launch·서명/공증·secret update continuity·source build 재현 통과 |
| D10 사용자 검증과 공개 판정 | D09 | G0/G2/G3 보고서, known limitations, release manifest | 제품§9의 공개 기준 통과, 외부 공개는 실제 사용자 지시 범위에서 실행 |

D01에서 WebView2 설치를 추가하거나 Tauri로 바꾸지 않는다. hardlink/read-back 불가를 원격 helper나 overwrite로 우회하지 않는다. prerequisite가 실패하면 해당 실패와 최소 수정안을 보고하고 관련 단계만 멈춘다. 독립적인 문서·검사 작업은 계속할 수 있다.

테스트 명령의 package script 이름을 `typecheck`, `test:unit`, `test:integration`, `test:e2e`, `test:security`, `test:performance`, `package:win`, `package:mac`으로 고정한다. 각각 실제 실행 대상과 결과를 가져야 하며 echo만 출력하는 통과 script를 만들지 않는다. integration 대상은 명시한 fixture server만 허용하고 사용자 실서버를 기본값으로 사용하지 않는다. TEST_HOST 누락은 명시적 환경 미준비이며 pass/skip으로 합격 처리하지 않는다. typecheck strict=true, noUncheckedIndexedAccess=true, exactOptionalPropertyTypes=true를 사용한다.

state reducer, path/IPC validation, hosttrust, finalize, persistence 복구, probe lifecycle 모듈에는 statement 90%·branch 85% 이상의 단위 coverage와 체크리스트의 장애 시나리오를 모두 요구한다. coverage 숫자가 의미상의 검증을 대신하지 않는다. UI 스타일·상수 값을 그대로 복사한 의미 없는 테스트를 추가하지 않는다. 필수 수동/target 항목은 단위 mock으로 대체할 수 없다.

## 16. 배포와 라이선스와 Git 운영

배포물 이름은 `sshOS-0.1.0-win-x64.exe`, `sshOS-0.1.0-mac-arm64.zip`, `sshOS-0.1.0-mac-x64.zip`이다. mac ZIP 최상위에는 sshOS.app 하나를 둔다. Windows는 portable target, requestExecutionLevel=user이며 관리자 권한과 installer를 요구하지 않는다. TEMP 해제와 사용자 데이터 생성을 허용하며 강제 종료 뒤 임시 실행 파일이 항상 0개라고 약속하지 않는다. 제품 데이터와 executable extraction을 구분한다.

배포 Windows exe와 mac app은 유효한 배포자 서명을 사용하고 mac app은 notarization/stapling을 검증한다. 서명 인증서·공증 계정이 없으면 개발용 패키지만 만들고 공개 배포 완료로 표시하지 않는다. SmartScreen/Gatekeeper 경고가 모든 PC에서 사라진다고 보장하지 않는다. macOS x64 binary는 arm64 Rosetta 시험만으로 native x64 합격을 대신하지 않는다. bundle에 없는 runtime을 사용자에게 설치하도록 요구하지 않는다.

AGPL-3.0-only 원문, copyright, third-party notices, SBOM(CycloneDX JSON), dependency exact versions, license review, 해당 source commit/hash·lockfile·빌드명령을 릴리스와 함께 제공한다. 소스와 binary의 버전 대응을 확인한다. high/critical의 적용 가능한 미해결 보안 취약점은 출시 차단이다. scanner 경고를 false positive로 제외하려면 해당 version·도달 가능성·근거·검토자를 기록해야 하며 severity를 임의 낮추지 않는다. license unknown 또는 incompatible dependency도 출시 차단이다.

로컬 Git 초기화·commit·push·merge는 후속 개발 지시 범위에서 수행한다. 현재 문서 작성은 Git 초기화를 포함하지 않는다. 원격이 없으면 push 완료를 주장하지 않고 실제 원격 경로·URL 확보를 선행 조건으로 기록한다. 무단 worktree·외부 bare remote를 만들지 않는다. GitHub origin이면 사용자 AGENTS의 sprint-planner → human commit/push/PR·assignee → pr-code-review → App current-head APPROVED → human merge·양쪽 branch 정리 흐름과 plan-aware guard를 따른다. 해당 스킬·wrapper가 없거나 guard가 실패하면 우회하지 않고 정확한 선행 조건만 보고한다. read-only 검사는 계속할 수 있다.

변경마다 build/test 결과를 남기고, 미해결 P0/P1은 merge/release 차단이다. P0는 기존 파일 손상·비밀 유출·임의 코드 실행·잘못된 서버 변경·호스트 신뢰 우회, P1은 필수 기능 불가·거짓 완료·복구 불명 은폐·앱 종료/전송 무기한 정지, P2는 필수 동작을 막지 않는 UI/설명 결함이다. P2도 필수 수용 기준을 위반하면 출시 차단한다. 결함 등급만 낮춰 검사를 통과시키지 않는다.

## 17. 완료 증거와 문서 검사

체크리스트 각 행은 독립 검사 단위이며 mode·fixture·행동·기대값·출시 차단 여부를 가진다. 결과 레코드는 checkId, status(pass/fail/untested), build SHA-256, source revision, OS/CPU/server versions, fixture configuration, command/수동 절차, actual outcome, expected outcome, evidence path, defectId를 포함한다. screenshot만으로 bytes·호스트 검증·네트워크 차단을 통과 처리하지 않는다. 단위시험은 raw test report, 전송은 hash와 byte 결과, egress는 capture, 서명은 플랫폼 검증 결과를 첨부한다.

앱 코드가 없는 현재 단계에서 제품 검사는 모두 untested다. 문서 구조·링크·hash·요구사항 추적 검사만 planning-validation에 기록한다. SDD validator는 draft 구조를 확인하며 사용자 승인·무결함·구현 완료를 인증하지 않는다. 전체 코드 승인은 v5의 scope digest와 실제 사용자 구현 착수 지시를 연결할 때 기록한다. 프레임워크 선택이나 이번 계획 작성 지시를 제품 구현 완료 승인으로 기록하지 않는다.

주요 근거는 [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [프로세스](https://www.electronjs.org/docs/latest/tutorial/process-model), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [ssh2](https://github.com/mscdex/ssh2), [고정 v1.17.0 SFTP API](https://raw.githubusercontent.com/mscdex/ssh2/v1.17.0/SFTP.md), [OpenSSH rename/hardlink 구현](https://raw.githubusercontent.com/openssh/openssh-portable/V_9_6_P1/sftp-server.c), [Node fs](https://nodejs.org/api/fs.html), [SSH exec RFC4254](https://datatracker.ietf.org/doc/html/rfc4254#section-6.5)다. 문서의 수치·단계·제외 범위는 시오스 설계 결정이며 이 출처들이 시오스 품질을 검증했다는 뜻이 아니다.
