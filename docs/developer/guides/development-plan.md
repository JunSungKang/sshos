# sshOS Development Plan

English edition of the approved v6 engineering contract, updated 2026-11-15. Product version: 0.1.0. Method: specification-driven development. Application implementation and local checks now exist; acceptance and public-release gates remain separate. The [preserved original](../architecture/history/pre-english-20261115/docs/02-development-plan.md) fixes the original approval provenance. This edition does not relax its requirements.

## 1. Scope and Authority

Implement the [product plan](product-plan.md) through Electron, the [desktop contract](../architecture/desktop-interaction.md) and the [152 acceptance checks](quality-security-checklist.md). The [English contract index](../architecture/contract-index.json) preserves R/D/check identities and links to the original approved scope digest. Research, mockups and screenshots do not add features or certify implementation.

Exclude online search, hidden browsing, AI/model SDKs, server agents, application databases, remote GUI/X11, local OS terminals, automatic reconnect/resume/replay/update, telemetry and crash upload. Do not add menus, stubs, settings, feature flags or future network permissions for these exclusions. User-requested remote execution and PTY are permitted by section 19. The literal `/bin/true` restriction applies only to section 10.

Resolve task outputs inside the authorized checkout before writing. Developer tools use `.local/` for caches and test profiles; do not repurpose HOME or CODEX_HOME. Packaged user-data defaults are a different contract under section 11. Existing user changes and unowned files remain intact.

## 2. Identity and Fixed Budgets

`serverId` is a profile UUID v4. `endpoint` is normalized host plus port, excluding username, and keys host trust. `sessionGeneration` increases for each new control connection attempt, not rekey. `backendEpoch` is a new UUID for each utility-process start. A file task has its own UUID; retries create new IDs. Window, viewer, execution and terminal UUIDs are distinct resource types. Acknowledgement means an observed successful protocol reply, not remote power-loss durability. Intent means a locally persisted pre-dispatch stage. Completed, unknown outcome and temporary-file cleanup are separate facts.

| Item | Fixed contract |
| --- | --- |
| Profiles / connected servers / file windows | 10 / 3 / 6 maximum |
| Internal windows / viewers | 12 total windows; 4 text/image viewers combined |
| User execution channels | 6 globally, 4 per server; GUI exec and PTY combined; reject before starting instead of silently queuing |
| Viewer reads | 4 globally, 2 per server; FIFO wait beyond capacity; read deadline starts at dispatch |
| SSH worker | One utility process; no automatic restart |
| SSH sockets | Per server: control 1, transfer at most 1, execution at most 1; at most 9 globally, including owned closing sockets |
| Transfers | 2 running globally, 1 per server; slot held through preparation, verification, finalization and final persistence |
| Queued transfers | At most 100 globally and per selection; reject the whole over-limit request |
| File size | 0 through 64 GiB; safe integer Number byte counts/offsets, including JSON |
| Authentication | 20 seconds from socket start through ready; host approval occurs after closing the observation socket |
| Metadata requests | 15 seconds after dispatch; complete directory enumeration additionally capped at 60 seconds |
| Transfer no-progress deadline | 30 seconds without valid read/write ACK or verification read; no whole-file duration limit |
| Storage request | 5 seconds; do not apply late success as a new generation's state |
| Cancellation / approved shutdown | Close owned transfer stream/socket within 5 seconds / total shutdown budget 10 seconds |
| Probe | Next request 5 seconds after prior completion, request deadline 5 seconds, freshness 15 seconds, at most 1 pending per server |
| Progress events | At most 4 Hz per task, terminal event immediately; ordinary UI reflection within 1 second |
| Directory listing | 10,000 entries and at most 10 MiB serialized data; explicitly mark truncation |
| Terminal receipts | Retain at startup for at most 30 days and the newest 1,000; preserve unresolved/live/backup-uncertain records |
| Unresolved records | 100; block new changing operations beyond the limit and request record review |

KiB = 1024 bytes; MiB = 1024²; GiB = 1024³. Use monotonic clocks for deadlines/rates and UTC wall time only for displayed record timestamps.

## 3. Technology and Process Boundaries

Use exact versions and the lockfile; no `latest`, caret or tilde dependency ranges. The [initial baseline](../architecture/dependency-baseline-v6.json) records the selected design versions; current manifests and installed/package reports establish actual versions. Record exact Electron/embedded Node/Chromium and dependency/license/security results. A version change needs rationale and affected regression coverage, not silent weakening.

Renderer owns React desktop/viewers/xterm. Preload is a single CommonJS contextBridge bundle with named methods. Main owns native dialogs, trust, profiles, OS encryption, capability checks and the single JSON writer. The utility process owns ssh2, sockets, remote operations, streams, queues and hashing. Shared code is pure types/schemas/reducers and cannot import Electron/fs/net. Zod schemas reject unknown fields. Vitest covers units/state/faults; Playwright covers actual Electron scenarios; native OpenSSH targets remain a separate matrix.

The authority path is renderer → preload → main → utility process. Worker persistence requests pass through main and receive ACK before remote effects. Renderer and worker never write state JSON directly. Native-dialog results become scoped local capabilities. Content, secrets and command bodies never enter generic state snapshots. File/image/terminal bytes use dedicated bounded ephemeral streams.

## 4. IPC and Application Security

Set `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true` and `webSecurity:true`. Serve only packaged `app://ui/` resources with host/path/MIME validation after decoding; reject traversal and symlink escape. No generic invoke, local exec/readFile, openExternal, eval, Function or arbitrary HTML bridge.

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; worker-src 'self'; form-action 'none'
```

The style exception supports pinned xterm DOM styles and validated numeric window geometry only. It does not permit remote/user CSS or CSS URLs. Block external navigation, new windows, webviews, permission requests and remote resources. Render remote text literally; do not execute Markdown/HTML/SVG or expose remote content through static app/file URLs. Decode allowed images only through the isolated bitmap path. Production enables neither debugging ports nor automatic DevTools.

Before signing, apply and re-read six fuses: RunAsNode=false, EnableNodeOptionsEnvironmentVariable=false, EnableNodeCliInspectArguments=false, EnableEmbeddedAsarIntegrityValidation=true, OnlyLoadAppFromAsar=true, GrantFileProtocolExtraPrivileges=false. Verify ASAR metadata/member integrity. Use utilityProcess rather than depending on child_process.fork. Automation's inspector-enabled development executable is not the distributable; never weaken production fuses to pass automation.

Validate live main-frame sender and `app://ui/` origin before payloads. Ordinary renderer requests are at most 64 KiB with strict field/array bounds, 30 requests/second and burst 60 per frame. Native dialogs have one shared per-frame gate. Cancellation/disconnect retain cleanup priority/capacity. Viewer/output/PTY streams use their own budgets. Dragging stays local rather than emitting remote calls per pointer update.

Named API groups cover profiles, trust, sessions, file capabilities, transfers, task records, settings/diagnostics/licenses, desktop metadata, viewers, confirmed GUI execution and PTY. IDs cannot be exchanged between resource kinds. Messages bind serverId/generation/epoch/resource/request/sequence; stale, duplicate or foreign events never retarget current work. Timeout does not prove a dispatched request was never executed. A repeat requires a new explicit request and ID, not implicit replay.

## 5. Profiles, Trust and Authentication

Profile names are 1–64 Unicode scalars; hosts at most 253 bytes; ports integers 1–65535; usernames 1–256 UTF-8 bytes. Reject NUL/control characters, schemes, paths, userinfo and host whitespace. Normalize DNS with domainToASCII, lowercase and one trailing-dot removal. Validate IP literals without legacy octal/hex/short IPv4 reinterpretation; remove UI brackets only for valid IPv6. A connect attempt uses one resolver/connection attempt and does not rotate addresses indefinitely.

Changing endpoint or username clones a new serverId and retains the original profile. Live connections, unresolved/active work and damaged-record restrictions block identity/auth changes and deletion. Recheck busy state inside the serialized mutation; reserve new connect/trust/OS-confirm operations until profile writes settle. Display-name edits are permitted; existing task snapshots keep their original names. Authentication tries only the chosen method once.

Every socket verifies the full observed host-key blob against endpoint trust and displays its SHA-256 fingerprint. For an unknown key, collect it then reject/close without authentication; the challenge expires after 120 seconds. Persist approval before a fresh verified connection. Any intervening key change blocks authentication. No ignore/replacement shortcut or automatic known_hosts deletion. Removing trust in Settings first quiesces all affected profiles/tasks. Do not auto-read/modify system SSH config or known_hosts.

Support password, OpenSSH v1 Ed25519/RSA (RSA at least 2048 bits), and PKCS#1 RSA PEM, encrypted or unencrypted. Private-key input is at most 512 KiB; passwords/passphrases at most 1,024 UTF-8 bytes. Reject PPK, PKCS#8 input files, DSA/ECDSA user keys, SSH certificates, FIDO, external agent, keyboard-interactive/MFA and public `.pub` files without conversion or fallback.

Use an in-process one-key BaseAgent adapter. Return exactly the selected public key; sign only matching-key requests. RSA requires sha256/sha512 with RSA_PKCS1_PADDING; reject SHA-1/undefined/other hashes without signing. Ed25519 uses crypto.sign(null, ...). Each callback fires once; exhausted authHandler returns false. This is not ssh-agent/Pageant/forwarding support.

Negotiation allowlists:

- KEX: curve25519-sha256, curve25519-sha256@libssh.org, ecdh-sha2-nistp256/384/521, diffie-hellman-group16-sha512.
- Host keys: ssh-ed25519, rsa-sha2-512/256, ecdsa-sha2-nistp256/384/521.
- Ciphers: aes256-gcm@openssh.com, aes128-gcm@openssh.com, aes256-ctr, aes128-ctr.
- MACs: hmac-sha2-512-etm@openssh.com, hmac-sha2-256-etm@openssh.com, hmac-sha2-512, hmac-sha2-256; compression none.

Do not silently reduce the allowlist or add weak fallbacks. Exercise the pinned version's public APIs and no-SHA1 fixtures.

Main opens a chosen key handle, checks fstat and asynchronously reads at most 512 KiB+1. Do not read an unbounded file first. A utility-owned parser thread performs decrypt/parse/KeyObject creation, one active parser, 5-second deadline; terminate only that thread on timeout. OpenSSH bcrypt rounds support 1–100. Convert supported parsed keys to internal PKCS#8 PEM/KeyObjects without sending class instances through MessagePort; internal conversion does not enable PKCS#8 input support.

Retain credentials in memory only for the owning connected session and auxiliary authentication. Clear references/buffers on disconnect/worker death/exit where possible; do not promise physical erasure of JavaScript strings or OS dumps. saveSecret=false forbids disk storage, not necessary session-memory use. Clear submitted forms and never return saved secrets to renderer.

## 6. Session Lifetime and Capabilities

States: idle → connecting → authenticating → connected → disconnecting → disconnected; host observation closes into awaiting_host_trust and approval starts a fresh connecting attempt. Failure is failed; explicit reconnect creates a new generation. Rekey retains generation.

After ready, open metadata SFTP, canonicalize `.` and read at most 16 KiB of `/etc/os-release` as data. Parse only ID/VERSION_ID; duplicate/malformed/oversized content is unknown. Never source it as shell code. Treat chroot paths as the SFTP-visible root.

Ubuntu/24.04 is supported; a different detected OS is unsupported/read-only. Unknown remains read-only until session-specific user confirmation and continues to display user-confirmed uncertainty. SFTP absence does not prevent a separately permitted PTY after OS confirmation. Keep OS, sftp, execProbe, userExec, pty and hardlink capability observations separate. Probe rejection does not imply execution/PTY denial. Do not run arbitrary test commands or create files at login to infer user permissions/hardlink support.

Serialize metadata enumeration/mutations/OS reads on control SFTP. Separate viewer reads. Open transfer per active task and execution on demand with fresh host verification/authentication; simultaneous execution opens share one promise. If MaxSessions/connection limits reject a new channel/socket, fail that request without closing unrelated work or spawning unlimited substitutes. Close an idle execution socket only after its final channel closes.

Keepalive interval is 15,000 ms and count 3; it is not the response metric. Control loss ends that server generation and retires its transfer/execution ownership. Transfer-only loss preserves control/execution; execution-only loss preserves control/transfers. Other servers remain unaffected. No automatic restart or reconnect.

## 7. Paths, Browsing and Single Mutations

Remote paths are POSIX absolute paths; local paths use native APIs. Keep raw names separate from escaped display strings. Basenames are 1–255 UTF-8 bytes; remote full path at most 4096 bytes. Reject slash, NUL, dot/dot-dot names, U+0001–001F, U+007F, U+FFFD and bidi U+202A–202E/U+2066–2069. Do not normalize remote case/NFC/NFD. Escape lossy names and disable their actions; do not claim to recover bytes already replaced by decoding.

Dot entries are not navigable rows; parent navigation uses canonical parent. Symlinks, FIFO/socket/device/unknown types are metadata only. Reject local symlinks/junctions and UNC paths. Initial local targets are ordinary APFS/NTFS files/directories, excluding network volumes, cloud placeholders and FAT/exFAT. Do not claim Node detects every reparse tag. Open handles then fstat; revalidate remote lstat/parent before mutation. Path-based SFTP cannot atomically prevent replacement by external writers.

Enumerate with opendir/readdir/close and close on limits. Show truncation; sort directories first, then Unicode code-point name order. Show hidden files by default, keep toggle per server session, and filter only the loaded listing. Refresh is explicit, not recursive polling. Bind each listing request to its directory token/requestId so late replies cannot overwrite a different window.

Windows destination names reject `< > : " / \ | ? *`, controls, trailing spaces/dots and CON/PRN/AUX/NUL/COM1–9/LPT1–9 including extensions. macOS rejects slash/NUL/common unsafe names. Do not silently replace characters. Exclusive link decides case/normalization collisions; string checks alone do not.

Create: confirm server/full path/name, persist intent, mkdir 0700, observe ACK, lstat directory, persist receipt. Delete: explicit preview; regular file uses unlink, directory uses rmdir only; refuse root, protected working paths and nonempty folders. No recursive/shell fallback.

Rename regular files only within one parent: lstat source → persisted intent → hardlink(source, newName) → persisted ACK → unlink(source) → persisted ACK. An existing name leaves source intact. Unsupported hardlink makes no change. Created new name plus failed old-name removal is partial; lost removal ACK is unknown. Do not automatically retry source removal or delete the new path as rollback.

Hold source/destination locks and preserve parents until terminal state, receipt settlement and actual resource close. Conflicting same/ancestor path mutations wait; independent siblings do not conflict; reads remain allowed. External users and user exec/PTY commands do not participate in these locks.

Metadata timeout quarantines/ends control and its generation; reads become IO_TIMEOUT and possibly dispatched mutations become result_unknown. Retire resources before releasing runtime locks, while unresolved paths remain restricted until user acknowledgement. Late generation callbacks cannot promote success.

## 8. Transfer State and Finalization

A receipt owns immutable task/server/generation/endpoint/host-key/source/destination/temp identities plus source stat, byte counters/hash, phase/cleanup state, last confirmed phase and timestamps. It is self-contained rather than relying on cross-file transactions. No credentials. Queue ordering is `(enqueuedSequence,taskId)` among runnable tasks; one blocked server/path does not stall another server. Never replay a stored queue on restart.

Transfer phases are queued, preparing, transferring, verifying, finalize_intent_pending, finalizing, cancel_requested, completed, failed, interrupted, cancelled, result_unknown and skipped. Mutations instead use prepared/dispatched/completed/failed/partial/result_unknown. Terminal means that resource cannot restart; a new attempt has a new preview and ID. There is no manual promote-to-completed action.

### 8.1 Prepare and Reserve

Native selection yields main-owned path/identity capabilities; renderer receives tokens/display names. Preview all selected valid/conflicting/unsupported rows and require an explicit subset-or-cancel decision. Existing destinations offer a new name, skip or cancel, not overwrite or advice to delete them first.

Reopen source and fstat regular-file type/64 GiB bound. Reject size/mtime changes since preview with SOURCE_CHANGED. Keep one source handle through EOF and compare final stat; same-size/mtime external edits are not fully detectable. No snapshot guarantee or unsupported-volume fallback.

Persist ownership/intent before creating `.sshos-<taskId>.part` with exclusive `wx` mode 0600. Collision fails without deleting the existing temp. Persist created ACK before transferring. Missing creation ACK is unknown; a filename pattern alone never proves ownership.

### 8.2 Upload

1. Validate held source, canonical remote parent and type/stat.
2. Persist temp intent, exclusive-create in that parent, then persist created ACK.
3. Stream 32 KiB chunks with at most 16 unacknowledged SFTP writes; count only acknowledged bytes, apply backpressure and never buffer the whole file or invent offset retries.
4. Hash source bytes, observe EOF/all write ACKs/remote close, compare final source stat and temp size.
5. Read the entire remote temp back over the same task SFTP and compare SHA-256 and byte count, including empty-file hash/size/close. Do not execute checksum commands. READ denial is VERIFY_READ_DENIED.
6. The serialized reducer enters finalize_intent_pending and rejects cancellation immediately. Persist `phase=finalizing,dispatchAllowed=true`; only its successful ACK permits memory finalizing and link dispatch. Never persist the pending phase. Storage failure sends no link; crash after durable intent is conservatively unknown.
7. Exclusive hardlink(temp, destination), then lstat regular destination/size. Existing name, unsupported extension, EXDEV or permission failure never falls back to rename, posix-rename or destination unlink. Learn capability from this real requested operation, not login probe files.
8. Persist confirmed destination creation, unlink owned temp, persist its separate result, then emit completed only after final receipt storage. Never delete the successful destination as rollback.

Read-back increases traffic/time and is distinct from transport integrity. Matching bytes/stat do not prove absence of an external writer.

### 8.3 Download

Hold the remote source handle and validate stat. Persist local temp intent, exclusive-create under the approved local parent, then persist created ACK. Stream 32 KiB chunks with at most 16 pending reads, handle short reads/writes by actual counts and avoid 32-bit offset truncation. Hash, EOF/count/final remote stat/close, then local sync/close. Reopen and hash/read back the entire local temp. Apply the same pending/finalizing durable barrier, then `fs.link(temp,destination)` for exclusive creation; no rename/copy/unlink fallback. Validate destination, persist creation, remove temp and persist completion separately. Bytes may match while original mode/owner/ACL/mtime/xattr are not copied.

### 8.4 Cancel, Interrupt and Recover

Queued cancellation creates no socket/temp. Accepted preparing/transferring/verifying cancellation blocks new I/O and closes only that task's stream/socket within 5 seconds. Cleanup may be attempted once only with confirmed ownership and valid same-session parent/type; unknown sockets/paths are not auto-cleaned. Socket closure does not prove temp removal.

After finalize_intent_pending, cancellation is CANCEL_TOO_LATE even while storage is pending. Reducer ordering decides the race; cancelled-first never dispatches link. UI disables cancellation during pending/finalizing.

A lost final link ACK is unknown. Confirmed destination but lost temp-unlink ACK is completed+unknown cleanup. cleanupState is none/confirmed/needed/unknown and is not the primary task outcome. A remote ACK followed by storage failure retains observed facts and locks new changing work; disk recovery never invents missing success.

Restart: queued becomes interrupted; pre-final created work becomes interrupted+needed or unknown when creation is uncertain; finalizing/dispatched becomes unknown; completed restores recorded outcome. A malformed old pending phase is unknown. Backup uncertainty overrides normal-current recovery for every receipt kind. Do not scan/delete old temps, reconnect to clean them or infer original success from a current matching hash. User acknowledgement adds acknowledgedAt and preserves the original unknown outcome. Late success is an observation on the old record, never promotion to completed.

## 9. Progress and Application Lifetime

Counters are monotonic integers not exceeding totalBytes. Transfer percentage excludes verification bytes. Empty files remain 0% until their byte phase finishes, then 100%; verification still displays separately. Rates use processed bytes over the last 3 monotonic seconds; show no rate before a sample, after 3 seconds without progress, or for terminal tasks. Label transfer versus verification speed; no ETA or conversion from response time.

Explorer/window close or minimize does not cancel accepted transfers. Disconnect/exit aggregate active, queued and unresolved transfers/executions/PTYs; require keep-or-interrupt confirmation. Finalization waits within the shared shutdown budget and preserves uncertainty at expiry. Closing the main window is not an implicit tray mode.

Renderer crash preserves main/worker tasks and restores snapshots. Worker crash retires its sockets; execute/PTY survival is unknown. Engine restart is explicit and does not reconnect/replay. Suspend invalidates probes, best-effort persists interrupts and closes sockets; resume invalidates prior generations even if suspend notification was missed. No auto-resume.

## 10. SSH Response Measurement

Only probe an authenticated active control session while the main app is foreground. OS confirmation/file capability are not prerequisites. Send byte-exact `/bin/true` without user interpolation, PTY/X11/forwarding/env. Start monotonic timing immediately before exec. Accept a sample only after observed exit 0, no signal/error and channel close within 5 seconds. Consume at most 4 KiB combined output without retention; excess, rejected exec, nonzero or missing exit makes this session unavailable and stops repeated probes.

At 5 seconds show delayed without a number. Keep ownership of an unresolved callback/channel; close a late-returned channel and discard its sample. Never accumulate replacement probes or disconnect control merely for measurement. A server ForceCommand may change semantics; do not promise zero server-side effects.

Sample identity includes server/generation/backendEpoch/probeEpoch/probeId/elapsedMs/measuredAt/transferActive. Invalidate on active-server change, app blur/minimize, suspend or reconnect; request a fresh sample after return. Check elapsed time in callbacks as well as timers. Wait 5 seconds after actual completion/close before another request; discard values older than 15 seconds. Keep metrics in memory. This is SSH command completion including network/server work, not pure RTT, ICMP or health scoring.

## 11. JSON Persistence and Recovery

Packaged userData uses app name `sshOS` and the OS default. Functional data is `data/`, session data `runtime/`; crash/log paths are also inside userData. One process acquires the single-instance lock; a second activates the existing window and exits.

`data/state.json` schema 1 owns revision/profiles/trust/encryptedSecrets/settings atomically. `data/receipts/<resourceId>.json` uses discriminated file_transfer/file_mutation/gui_exec/pty schemas. Exec/PTY metadata excludes argv/input/output/command hashes. Each receipt includes its own endpoint/path/identity snapshot. A local atomic replacement is not a remote transaction.

Envelope: schemaVersion, safe integer revision, payload, payloadSha256. Hash recursively code-point-sorted object keys as UTF-8 JSON; preserve array order; reject undefined/NaN/Infinity/bigint. It detects corruption, not malicious local editing. Bound state to 1 MiB and receipts to 64 KiB before parsing; validate strict schema/checksum/revision.

Single writer: exclusive UUID temp 0600 in same parent → write/sync/close → verify current and copy/sync backup temp → atomic backup replace → atomic current replace → parent-directory fsync if available. Never unlink current first. Windows replacement-lock retry delays are 100/200/400 ms, at most 3 retries. At the 5-second deadline, fault the writer and wait for outstanding I/O rather than overlap a new writer. Record unavailable directory sync as the fixed diagnostic event without raw details; do not overstate power-loss durability.

Valid current wins. If only backup is valid, report recovery and require renewed trust before using recovered credentials. Every backup-recovered receipt becomes recoveryUncertain/result_unknown even if its stored phase was queued, verifying or terminal. Preserve prior observations without treating them as current success. If both copies fail, lock connections/changes, show fixed error/location, preserve files and do not empty-initialize or overwrite newer schemas.

Storage fault blocks new mutations, transfer enqueue, exec/PTY creation and trust changes. Allow safe reads, existing PTY input, stop and disconnect; do not kill an established PTY just for storage failure. Explicit storage recheck requires worker quiescence, settled writer and validated files. Never auto-prune unresolved receipts. At startup prune terminal records once, after loading enough to distinguish protected records; valid accumulated 5001+ terminal records must not brick reopening. Local record/profile deletion does not delete remote files/accounts. A damaged receipt is isolated and cannot silently remove other records; orphan secrets never substitute another profile's secret.

## 12. Secrets, Diagnostics and Network

Use Electron 45 asynchronous safeStorage APIs after ready: availability, encryptStringAsync and decryptStringAsync. Saving is off by default. Availability/OS-lock/decrypt failure is SECRET_UNAVAILABLE, never plaintext/fixed-key/alternate-library fallback. Persist ciphertext as base64 with secret/profile/endpoint ownership.

Decrypt returns `{result,shouldReEncrypt}`. Use result only; when re-encryption is requested, encrypt and atomically replace the same secret before new authentication. Replacement failure retains old ciphertext and blocks authentication from it. No infinite retry. Native cross-account failure/signing continuity are target checks; DPAPI does not isolate malware running as the same OS user.

Default diagnostic JSONL contains only allowlisted fixed code/task/state/time/version fields, at most 1 MiB each with 3 rotated files. Exclude credentials, content, argv, command/input/output/hash, raw SSH debug/banner, username/host/IP/full paths. Export only after preview and native save selection. Receipts contain local endpoint/path data and are not anonymous.

Automatic app network traffic is selected SSH endpoints and necessary OS DNS only. No HTTP fetch service, listen socket, local management/WebSocket server, remote fonts/CDN, analytics, AI/search/crash upload/updater. Block renderer web requests and Chromium background networking. OS trust/security software and user-run remote programs have separate network behavior. Threats include untrusted remote data, forged IPC, path/session confusion, host changes, corrupt storage and dependency supply chain; full hostile-OS/server compromise resistance is not promised.

## 13. Fixed Errors and Actions

Error presentation contains code, fixed userMessage, confirmedPhase, affectedTarget, allowed actions and sanitized technical details. Do not infer password/firewall causes from generic failures or parse arbitrary server strings into trusted codes. Unknown/partial outcome takes precedence where required. Existing UI messages below intentionally remain Korean: documentation translation does not translate the product.

| Code | Existing Korean UI message | Allowed action |
| --- | --- | --- |
| INPUT_INVALID | 입력 형식이 올바르지 않습니다. | Highlight invalid field |
| HOST_TRUST_REQUIRED | 처음 연결하는 서버입니다. 호스트 지문을 확인하세요. | Approve or cancel |
| HOST_KEY_CHANGED | 저장한 서버 키와 현재 키가 다릅니다. 연결을 중단했습니다. | Review saved trust and connection settings |
| CONNECT_TIMEOUT | 제한 시간 안에 SSH 연결을 완료하지 못했습니다. | Review host/port; explicitly reconnect |
| CONNECTION_LOST | SSH 연결이 끊겼습니다. | Review outcome; explicitly reconnect |
| AUTH_FAILED | 서버가 로그인을 허용하지 않았습니다. | Edit account/authentication |
| KEY_INVALID / AUTH_UNSUPPORTED | 이 개인키 형식 또는 인증 방식은 지원하지 않습니다. | Choose another key; review supported formats |
| SECRET_UNAVAILABLE | 저장한 인증 정보를 사용할 수 없습니다. | Re-enter; disable saving |
| SFTP_UNAVAILABLE | 이 연결에서 파일 전송 기능을 사용할 수 없습니다. | Review connection capabilities |
| OS_UNSUPPORTED | 현재 확인된 서버 OS는 지원 대상이 아닙니다. | Review detected OS |
| OS_UNKNOWN | 서버 OS를 확인하지 못했습니다. | Confirm Ubuntu 24.04 for this session or keep read-only |
| PATH_UNSUPPORTED | 이 이름 또는 파일 종류는 지원하지 않습니다. | Choose another name or skip |
| PERMISSION_DENIED | 이 경로에서 요청한 작업을 수행할 권한이 없습니다. | Review path or cancel |
| NAME_CONFLICT | 같은 이름의 항목이 이미 있습니다. | Rename, skip or cancel |
| HARDLINK_UNSUPPORTED | 이 위치에서는 기존 파일을 보존하는 확정 방식을 사용할 수 없습니다. | Choose another location |
| SOURCE_CHANGED | 선택한 이후 원본 파일이 변경됐습니다. | Select source again |
| VERIFY_READ_DENIED | 업로드한 내용을 다시 읽어 확인할 권한이 없습니다. | Review outcome/temp location |
| VERIFY_MISMATCH | 전송한 내용과 목적지 내용이 일치하지 않습니다. | Review task outcome |
| IO_TIMEOUT | 작업 응답이 제한 시간 안에 도착하지 않았습니다. | Review last confirmed phase |
| CANCEL_TOO_LATE | 최종 파일을 만드는 단계여서 취소할 수 없습니다. | Wait for finalization |
| STORAGE_FAILED | 로컬 기록을 저장하지 못했습니다. 새 변경 작업을 중지했습니다. | Review storage location; explicit recheck |
| RESULT_UNKNOWN | 요청 결과를 확인하지 못했습니다. 자동으로 다시 실행하지 않습니다. | Read location; acknowledge after review |
| PARTIAL_RENAME | 새 이름은 생성됐지만 이전 이름의 제거를 확인하지 못했습니다. | Review both paths |
| INTERNAL_ERROR | 앱 내부 오류로 작업을 중단했습니다. | Review fixed code and task state |

Unknown native/SFTP failure uses a fixed generic code; do not invent causes. Required viewer/execution codes include VIEW_LIMIT, VIEW_FORMAT_UNSUPPORTED, VIEW_DECODE_FAILED, SESSION_LIMIT, EXEC_PERMISSION, EXEC_REJECTED, PTY_UNAVAILABLE, EXEC_RESULT_UNKNOWN and STOP_UNCONFIRMED. Source error mapping tests must continue to verify the original section 13 literals.

## 14. Quality Budgets and Target Matrix

Acceptance targets are Windows 11 x64, macOS 14 arm64 and macOS 14 x64, each against Ubuntu 24.04 amd64/arm64: six combinations. Additional macOS majors need their own two-architecture results. Minimum deployment target is 14.0. Use security-updated OpenSSH/ext4/ordinary-account fixtures and record versions/config. Include SFTP-only/chroot, no SFTP, exec denial, READ denial, unsupported hardlink, MaxSessions/connection limits, read-only paths, quota/full disk. Do not impose fault fixtures on user servers.

Qualifying hardware: RAM≥8 GiB, SSD, ≥4 logical CPUs. Record hardware/OS/power/background load. Baseline network:100 Mbps, RTT40 ms, loss 0; separate faults RTT500/2000 ms, loss 1%, complete loss. Repeat5 times; use nearest-rank percentiles.

| Measurement | Acceptance contract |
| --- | --- |
| Compressed / unpacked size | ≤250 MiB / ≤750 MiB per target |
| Launch | All5 cold launches ≤10 s, all 5 warm ≤3 s until connection controls usable; include Windows extraction |
| Settled memory | After60 s settle,300 one-second samples: p95≤500 MiB disconnected,650 MiB with 3 servers,800 MiB with 2 transfers+verification |
| Memory accounting | Sum main/renderer/utility/GPU/helpers working set/RSS; note shared-page double counting; not JS heap alone |
| Idle CPU | With3 servers and 1 active probe,5-minute mean≤3% of one logical CPU |
| Local UI feedback | p95≤100 ms, max≤300 ms; distinct from remote response completion |
| Listing |10,000 entries fully displayed≤10 s at baseline network; no scrolling UI long task>100 ms |
| Browse during transfer | Two1 GiB transfers to distinct servers plus 1000-entry listing≤5 s |
| Combined load |2 transfers+4 viewers at 40 MP each+6 execution channels+12 windows: memory p95≤1800 MiB, drag feedback p95≤100 ms; include 160 MB RGBA per image |
|100-cycle stability |10 MiB file per connect/transfer/cancel/viewer/PTY cycle; last 10-cycle p95 memory increase<50 MiB over first stabilized 10 |
| Resource return | Owned file handles/sockets/timers return to baseline after settlement, no repeated growth |
| Display |1120×760 and 1600×1000, scales 100/150/200%, essential controls accessible |
| Accessibility/IME | Keyboard paths, visible focus, modal trap/restore, labels, aria-live, contrast≥4.5:1; composition Enter cannot confirm destructive/transfer actions; preserve Korean/emoji names |

Do not claim comparative speed or demand validation from these thresholds. Product research criteria belong to the product plan and remain unperformed.

## 15. Delivery Stages and Completion

Retain D01–D13 and their original dependencies: foundation → storage/trust → session → desktop → files; viewers/transfers branch after files; GUI exec requires session+desktop+files; PTY requires session+desktop; integration follows viewers/transfers/exec/PTY; verification → packaging → usability. The [contract index](../architecture/contract-index.json) records each dependency and R mapping.

D01 includes actual three-target foundations/encryption/key APIs. D02–D10 require their mapped fault/state/lifetime checks. D11 requires executable technical checks through that stage; package-only checks finish in D12. D12 requires all technical acceptance including clean native launch, publisher signatures/notarization, notices/SBOM/source and runtime independence. D13 records G0/G2/G3 evidence or the truthful unperformed state; engineering success is not demand proof.

The user later directed independent implementation to continue while native checks would be performed manually. That changed execution order, not target acceptance. Record actual local development and missing gates separately; do not report stages passed from feature existence alone.

Required package scripts are typecheck, test:unit, test:integration, test:e2e, test:security, test:performance, package:win and package:mac, each executing real checks. Isolated loopback fixtures are local verification, not Ubuntu/OpenSSH certification. TypeScript remains strict with noUncheckedIndexedAccess and exactOptionalPropertyTypes. Covered safety/state/path/IPC/trust/finalization/persistence/probe/window/exec/viewer modules require per-file statement≥90% and branch≥85%, plus meaningful fault cases. Do not lower thresholds, exclude failing modules or replace native/manual criteria with mocks.

## 16. Packaging, Licensing and Repository Workflow

Portable Windows execution is ordinary-user, no installer/admin requirement. macOS ZIP contains the application bundle. Historical planned release names and current builder development names differ; the actual report/manifest is authoritative for an artifact's exact filename. Public distributions require valid publisher signatures and macOS notarization/stapling; absent credentials mean development-only artifacts. Rosetta does not replace native x64 acceptance. Do not require an extra runtime or promise every OS warning vanishes.

Ship AGPL-3.0-only text, copyright, upstream notices, CycloneDX inventory, exact versions, source revision/hash/lock and build instructions. Unresolved applicable high/critical security findings, unknown/incompatible licenses and failed required checks block public release. Exclusions need version/reachability/evidence/reviewer, not arbitrary severity downgrade. Current moderate build-tool findings remain documented, not silently fixed by major override.

Use repository-governed human commit/push/PR/assignee, independent current-head review, App formal APPROVED, human merge and verified removal of the exact remote/tracking/local PR head. Guard failure is not permission for raw-write bypass or protection weakening. Preserve original history and actual work timestamps. Critical data loss/secret exposure/implicit execution/wrong-server/trust bypass and major false-completion/recovery/lifetime failures block integration/release. A lower defect label cannot waive a required criterion.

## 17. Evidence and Documentation Validation

Each check result records checkId, pass/fail/untested, binary SHA256, source revision, client/server OS/CPU/versions, fixture/config, action/command, expected/actual result, evidence path and defect ID. Use raw reports, byte/hash outcomes, packet capture and native signature results where required; screenshots alone do not prove these properties.

The152 compound acceptance rows remain untested; local 553-unit/17-integration/61-security evidence is separately dated. Documentation validation checks structure/links/provenance/mappings, not product quality, approval authenticity or semantic perfection. This English migration retains the original v6 approval digest and byte-preserved source rather than falsely re-signing translated text as the original approval.

## 18. Read-Only Text and Image Viewers

Only regular files. Text≤2 MiB; compressed image≤20 MiB; each edge≤16384; pixels≤40,000,000. Enforce actual bytes as well as metadata. Read at most 4 KiB for initial PNG/JPEG/WebP signature detection; other files offer text/download/cancel. Familiar text extensions may default to text, never execution or decoder based only on extension.

Use per-viewer SFTP,2 per server/4 global,32 KiB reads; verify EOF and first/final size/mtime before display. On observed source change retain the previous view and request explicit reread; unchanged metadata cannot prove immutability. Whole read≤30 s after dispatch, per-read≤15 s, decode≤5 s. FIFO wait is not read time. Cancel/timeout/window-close affects only that read/channel, not metadata/transfers.

Strip UTF-8 BOM and decode strictly; invalid UTF-8/NUL is unsupported. Display CRLF/LF, HTML/Markdown/ANSI literally. Reject a line over 100,000 Unicode scalars; virtualize large line lists. No viewer editing/search/encoding conversion.

Support static PNG/JPEG/WebP only. Reject APNG acTL, WebP ANIM/ANMF, GIF/SVG/PDF/audio/video. Validate header lengths/chunks/dimensions/overflow before decoding. JPEG EXIF orientation 1–8 is validated, default 1; malformed EXIF is rejected. Reject PNG eXIf/WebP EXIF in this version. Decode in renderer Web Worker with createImageBitmap/from-image,5 s terminate deadline, not the SSH event loop. Compare expected orientation-adjusted dimensions (5–8 swap). Transfer one ImageBitmap to bitmaprenderer; never decode again through img/blob/base64. Close abandoned bitmaps and clear canvas/references on replace/close. No URL/resource/script interpretation.

Ephemeral viewer chunks≤64 KiB, unacknowledged bytes≤256 KiB/viewer. ACK consumption before more data and release relay references. No generic snapshot copies or intentional disk cache; OS swap/dumps are outside that guarantee. Images start fit, offer 25/50/100/200% and scrolling. Display path/format/encoding/dimensions/bytes/read time as applicable. Reread has a new requestId; discard stale replies.

## 19. GUI Execution and PTY

### 19.1 Ownership and Channels

Run as the existing remote account, with no local shell, X11, agent forwarding, arbitrary env or server helper/runtime installation. A chosen remote program's own prerequisites remain the user's server prerequisites.

Share4/server and 6/global exec+PTY slots, counting opening/closing ownership. Simultaneous opens share one execution-socket promise. Request deadline 10 s; authentication 20 s. A timed-out late channel is closed, but calling close or receiving a callback does not release a slot; actual channel-close or socket termination does. An unreturned callback retains ownership until socket retirement. No execution-duration or silence timeout; transfer no-progress rules do not apply.

Persist channel-creation intent first. Exec/PTY receipts hold identity/snapshot/path/cwd/times/observed outcomes, never argv/input/output/hash. Do not split PTY input into command tasks or promise to control remote shell history.

### 19.2 Confirmed GUI Execution

Preview defaults direct, canonical source parent cwd and empty argv. Modes are direct, /bin/sh and /bin/bash; use a validated directory capability for cwd. Each argument has its own row; do not split a shell string. At most 64 args,4096 UTF-8 bytes each,16 KiB combined; reject NUL/CR/LF/controls. Free-form shell input belongs only to PTY.

Show server/account/full path/cwd/mode/all args. Bind a single-use 60 s confirmation to all values/stat/generation. Cancel sends nothing. Direct mode requires an executable bit, without chmod; real ACL/noexec/CPU/shebang success is observed only through execution. Interpreter mode passes a readable regular file without granting permissions. Do not infer mode from extension.

Require session-specific POSIX-login-shell confirmation for GUI exec; PTY uses the actual login shell independently. Quote each absolute cwd/path/arg using POSIX single quotes, replacing an internal quote with close-quote/backslash-quote/reopen-quote. Direct command is `cd Q(cwd) && exec Q(path) Q(arg1) ...`; interpreter inserts Q(interpreter) before Q(path). Empty/metacharacter/Unicode arguments cannot become extra commands. Revalidate source/parent immediately before dispatch while acknowledging path TOCTOU limits.

GUI exec has no PTY and no user stdin UI. Keep stdin open so pinned ssh2 signal requests remain possible; sending EOF first breaks that guarantee. A program waiting for stdin may remain silent indefinitely. Display separate bounded stdout/stderr in arrival order, not claimed remote causal order; escape ANSI literally, never HTML. Accepted execution without output remains visibly running.

### 19.3 Exit, Stop and Recovery

States prepared→dispatching→running→exited or result_unknown; pre-dispatch cancel is cancelled_not_sent, explicit request rejection is rejected. Running means request acceptance, not business success. Observe exit code/signal and actual close before exited. Preserve code 0 as code 0, not task success. Exit observed but no verified close, or close without exit, remains unknown with observed details. Parent exit does not prove child/daemon termination.

Confirmed Stop sends TERM once. After5 s without exit, show stop_unconfirmed and continue output; no automatic KILL/search/replay. Confirmed channel close is a local action, not proof of remote termination. Hiding a running output window keeps task/ring and permits reopening. Terminal receipt output is memory only, cleared at session end or explicit record close. Restart never recreates exec/PTY/input; prior running/dispatch/stop becomes unknown. Disconnect/suspend/worker death does not establish remote survival or death.

### 19.4 PTY, Input, Display and Memory

Open term=xterm-256color,80 columns/24 rows, pixels 0, without env/X11/agent. Fit to 2–500 columns/1–200 rows; debounce actual remote resize 100 ms and retain previous dimensions when hidden. Do not allow terminal escapes to change application title/server identity.

Input includes terminal token and monotonic sequence, at most 120 events/s,64 KiB/s and 64 KiB in-flight. Backpressure visibly disables input rather than silently dropping it. Paste≤64 KiB; CR/LF or>4 KiB requires full-content/server/account confirmation bound to terminal/generation/content. Focus changes do not retarget it; disconnect/generation change cancels it. Never add an unapproved newline or duplicate browser/terminal paste.

Output chunks≤32 KiB; unacknowledged live output≤256 KiB/channel. PTY ACK follows xterm.write callback; pause while renderer is absent or loses consumption ACK. Internal minimize retains xterm consumption. Flow-control each channel to 1 MiB/s without unbounded main strings; SSH pause may block a remote producer but is not a stop signal.

GUI output rings:4 MiB/task,16 MiB total. Evict oldest per-task chunks, then old terminal buffers globally, then oldest global arrival chunk including running tasks if necessary; show omission per affected task. PTY scrollback 2000 lines with 500-column cap is not an absolute memory byte guarantee. Worker PTY replay rings:1 MiB/channel,6 MiB total.

Restore pauses live output and freezes last sequence S. Disable input and automatic response forwarding while replaying. After final xterm.write consumption, ACK the exact restore token; resume only live sequence>S and then input/automatic replies. Never resend old keys or DA/CSI replies. Incomplete replay is disclosed; failed restore keeps input locked for explicit retry/close.

Ignore/consume OSC52 clipboard, OSC8 hyperlinks, title/icon, external URI, file-transfer escape and bell automation. No automatic clipboard/weblink addons. User copy/paste requires explicit gesture. Consume REP(final b) above 500; test long OSC/DCS, combining accumulation and huge numeric values in actual pinned xterm.

Main polls renderer workingSetSize once per second, converting KiB/1024 to MiB. Two consecutive samples>1536 MiB pause all PTY output, revoke input and request xterm disposal; unresponsive UI may be recreated without replaying remote commands. Recovery never auto-replays the problematic ring; explicit new display clears it. This is not a guarantee to beat OS OOM.

PTY close ends its local channel without promising process-tree termination. Ctrl+C sends input byte 0x03, not the GUI TERM action. Native vi/IME/clipboard/escape behavior requires the target matrix, not fixture-only evidence.

### 19.5 Required Failure Coverage

Cover quoting/empty/Unicode args, source symlink replacement, permission/noexec/wrong CPU/interpreter, long silent jobs, ignored signals/missing exit, high output during transfers/drag, duplicate filenames on multiple servers, renderer crash, URI/clipboard escapes, IME/paste target binding, sequence and no input replay. Do not add local shells, remote helpers, external browsing or automatic execution to pass a test.
