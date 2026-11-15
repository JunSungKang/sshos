# v6 구현과 검증 연결

승인된 v6 요구사항을 현재 구현 경로와 검증 근거에 연결한다. 계획서의 착수 전 상태 문구는 승인 당시의 기록이며, 현재 진행 상태는 [구현 상태](../implementation-status.json)가 관리한다. 승인된 범위·수치·152개 복합 수용 검사 상태는 이 문서로 변경하지 않는다.

아래의 구현 경로는 코드가 존재한다는 근거다. 로컬 자동 검증은 현재 macOS26 arm64와 loopback ssh2 fixture 결과다. 지원 대상 Windows11/macOS14·Ubuntu/OpenSSH, OS 암호화·IME·접근성·지정 성능·서명·공증 결과로 대신하지 않는다. 해당 수용 결과는 사용자 시험 전까지 untested다.

로컬 기준 증거는 [553개 단위 검사와 파일별 커버리지](../../evidence/d11-review-corrections/coverage-summary.json), [17개 통합 시나리오](../../evidence/d11-review-corrections/integration-report.json), [Electron/xterm 보안 검사](../../evidence/d11-review-corrections/security-report.json)다. 이후 변경의 재검증은 구현 상태와 개별 증거에 기록한다.

| 요구 | 구현 또는 준비된 절차 | 연결된 로컬 검증과 남은 판정 |
| --- | --- | --- |
| R01 제품 범위 | [DesktopShell](../../src/renderer/DesktopShell.tsx), [main](../../src/main/index.ts) | desktop·viewer·exec·PTY 통합. 제외 기능은 소스 검토, 배포 전 재검토 필요 |
| R02 지원/portable | [package](../../scripts/package.mjs), [설정](../../electron-builder.json) | 3종 정적 패키지 검사. native 실행·서명은 미검증 |
| R03 추가 의존성/DB | [worker](../../src/worker/index.ts), [JSON 저장](../../src/main/persistence/store.ts) | 실제 main/worker/SSH 통합. clean OS·서버 무설치 판정은 미검증 |
| R04 OS형 작업 공간 | [DesktopShell](../../src/renderer/DesktopShell.tsx), [TransferShelf](../../src/renderer/TransferShelf.tsx) | desktop-ui·transfer-gui 시나리오 |
| R05 프로필 | [profiles](../../src/main/profiles.ts), [ProfileManager](../../src/renderer/ProfileManager.tsx) | 프로필/입력 단위 검사, session GUI |
| R06 호스트 신뢰 | [host-verifier](../../src/worker/connection/host-verifier.ts), [connections](../../src/main/connections.ts) | 실제 handshake·변경 키 거절·trust-before-auth |
| R07 인증/서명 | [single-key-agent](../../src/worker/connection/single-key-agent.ts), [key-parser](../../src/worker/connection/key-parser.ts) | 실제 키 파싱 thread·RSA/Ed25519·한 번 인증. native vault는 미검증 |
| R08 연결/세대 | [session-manager](../../src/worker/connection/session-manager.ts), [auxiliary-sockets](../../src/worker/connection/auxiliary-sockets.ts) | socket retirement·stale generation·shared socket/isolated close |
| R09 기능별 판정 | [session-manager](../../src/worker/connection/session-manager.ts), [probes](../../src/main/probes.ts) | OS unknown/unsupported·SFTP 거절·exec/PTY 거절·probe 분리 |
| R10 경로/type | [files 계약](../../src/shared/files.ts), [browser](../../src/worker/files/browser.ts), [local](../../src/worker/transfers/local.ts) | Unicode·symlink·special·canonical parent·inode·Windows 이름 정책. Windows 실기는 미검증 |
| R11 탐색 | [FileExplorer](../../src/renderer/FileExplorer.tsx), [files](../../src/main/files.ts) | file GUI: 탐색·명시 갱신·캐시·UI reload |
| R12 새 폴더 | [mutations](../../src/worker/files/mutations.ts) | mkdir0700·ACK 뒤 type 재검증·지연 ACK |
| R13 이름/삭제 | [mutations](../../src/worker/files/mutations.ts), [controller](../../src/main/mutations.ts) | hardlink→별도 unlink, 충돌·partial·unknown·비재귀 |
| R14 큐/동시성 | [coordinator](../../src/worker/transfers/coordinator.ts), [queue](../../src/worker/transfers/queue.ts) | FIFO·2 global/1 server·100개 원자 등록·경로 잠금 |
| R15 업로드 | [runner](../../src/worker/transfers/runner.ts), [ports](../../src/worker/transfers/ports.ts) | 실제 SFTP copy·SHA256 readback·배타 link·제한 READ·temp 변조 |
| R16 다운로드 | [local](../../src/worker/transfers/local.ts), [ports](../../src/worker/transfers/ports.ts) | 실제 no-follow/exclusive0600·readback·목적지 경합 보존 |
| R17 진행/무결성 | [progress](../../src/worker/transfers/progress.ts), [TransferShelf](../../src/renderer/TransferShelf.tsx) | 전송/검증 byte와 속도, 전량 해시 비교 |
| R18 취소/기한 | [scope](../../src/worker/transfers/scope.ts), [channels](../../src/worker/execution/channels.ts) | 기한·늦은 채널/ACK·취소 소유권·finalization 취소 거절 |
| R19 부분 결과/복원 | [receipts](../../src/main/persistence/receipts.ts), [recovery](../../src/main/storage-recovery.ts) | result_unknown·partial·백업 불확실성·재전송 금지 |
| R20 응답 지표 | [probes](../../src/main/probes.ts), [ProbeStatus](../../src/renderer/ProbeStatus.tsx) | 실제 control SSH /bin/true, focus·선택·세대·닫힘 cooldown |
| R21 앱 수명 | [shutdown](../../src/main/shutdown.ts), [main](../../src/main/index.ts) | renderer crash·worker SIGKILL·aggregate shutdown·모의 suspend/resume. 실제 절전은 미검증 |
| R22 JSON | [store](../../src/main/persistence/store.ts), [receipt-channel](../../src/main/receipt-channel.ts) | checksum·단일 writer·backup·교체 실패·ACK·future schema 거절 |
| R23 비밀정보 | [secrets](../../src/main/persistence/secrets.ts), [read-private-key](../../src/main/read-private-key.ts) | 비밀 수명·소유권·키 읽기·영수증/진단 제외. 실제 OS 암호화는 미검증 |
| R24 IPC/권한 | [preload](../../src/preload/index.ts), [engine-protocol](../../src/shared/engine-protocol.ts), [security](../../src/main/security.ts) | named API·sender·epoch/generation·token·payload/budget·CSP·sandbox |
| R25 통신/로그 | [main](../../src/main/index.ts), [diagnostic-log](../../src/main/diagnostic-log.ts) | renderer fetch 거절·허용 필드 로그·무출력 저장. native packet capture는 미검증 |
| R26 오류 | [error-presentation](../../src/shared/error-presentation.ts), [ErrorPanel](../../src/renderer/ErrorPanel.tsx) | 고정 한국어·코드·확인 단계·대상·결과 불명 우선, 원격 설명의 코드 위장 거절 |
| R27 품질 | [window 모델](../../src/shared/windows.ts), [성능 harness](../../scripts/performance.mjs) | 로컬 warm/click/등록 부분 측정. 지정 장비·네트워크·300표본·전체 부하·IME/접근성은 미검증 |
| R28 시험 근거 | [검증 실행기](../../scripts/verify.mjs), [native 절차](native-validation.md) | 실행 결과·소스 hash·실패 재현 보존. target 결과는 사용자 시험 필요 |
| R29 공급망 | [고지 생성](../../scripts/prepare-licenses.mjs), [license reader](../../src/main/licenses.ts), [의존성 검토](dependency-review.md) | 패키지 고지 hash·SBOM·대응 소스. DEP-001 moderate 경고 유지, 공개 전 라이선스 검토 필요 |
| R30 사용자 가치 | [평가 절차와 상태](usability-evaluation.md) | G0/G2/G3 미실시·참여자 미확보. 수요·반복 사용 주장 없음 |
| R31 Git/공개 | [저장소 설정](../governance/repository-setup.md), [작업 계약](../governance/full-implementation-v1.json) | 원래 이력 보존·guarded commit/push. 독립 current-head review/merge와 공개 판정은 별도 gate |
| R32 실행 절차 | [개발 기록](full-implementation.md), [상태](../implementation-status.json) | v6 범위 hash·실제 검사·실제 커밋·미검증 분리 |
| R33 내부 창 | [window 모델](../../src/shared/windows.ts), [desktop](../../src/main/desktop.ts), [DesktopShell](../../src/renderer/DesktopShell.tsx) | 이동/resize·min/max/restore·viewport clamp·focus·한도·keyboard taskbar |
| R34 텍스트 | [reader](../../src/worker/viewers/reader.ts), [text](../../src/shared/viewers/text.ts), [ViewerPane](../../src/renderer/ViewerPane.tsx) | UTF8·2MiB·chunk/ACK·line index·가상 스크롤·읽기 중단/다시 읽기 |
| R35 이미지 | [image-header](../../src/shared/viewers/image-header.ts), [viewer-worker](../../src/renderer/viewer-worker.ts) | PNG/JPEG/WebP header·20MiB/40MP/edge 상한·EXIF·canvas bitmap 해제 |
| R36 명시 실행 | [execution-previews](../../src/main/execution-previews.ts), [gui](../../src/worker/execution/gui.ts), [ExecutionPane](../../src/renderer/ExecutionPane.tsx) | 고정 source/cwd/argv/stat·60초 확인·POSIX quoting·stdout/stderr·관측 exit/close |
| R37 PTY | [sessions](../../src/worker/terminal/sessions.ts), [TerminalPane](../../src/renderer/TerminalPane.tsx), [terminal-security](../../src/renderer/terminal-security.ts) | 실제 xterm·입력 sequence·restore ACK·resize·paste·OSC/REP·메모리 차단. native vi/IME는 미검증 |
| R38 실행/창 수명 | [executions](../../src/main/executions.ts), [terminals](../../src/main/terminals.ts), [shutdown](../../src/main/shutdown.ts) | 창만 닫기·출력 재열기·중지/채널 닫힘·단절·모든 자동 재실행 금지 |

서명 자격증명 부재, native 시험, 지정 성능, 사용성 참여자, 공개 전 법률·공급망 검토를 코드 구현 완료와 합산해 완료율로 표시하지 않는다. 공개 준비 상태는 계속 false다.

최종 수정 소스 `8b41e23211fcac17ca40a467cd5c93c7a2d89264`의 개발 패키지3개와 로컬 부분 성능은 [검증 manifest](../../evidence/d12-reviewed-development/artifacts.json) 및 [인계서](development-handoff.md)에 연결한다. 이후 문서·증거만 변경한 커밋의 현재-head 판정은 PR#1이 정본이다.
