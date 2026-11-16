# Troubleshooting

Use the fixed error code, last confirmed phase and affected server/resource. A generic network/SFTP error does not prove a password, firewall or server-health cause. No automatic web search, AI fix, privilege change or replay is performed.

| Symptom | Inspect | Expected next action |
| --- | --- | --- |
| App cannot launch | Artifact CPU/OS, SHA256, publisher-signature status and exact OS message | Record blocked native test; current development artifacts are unsigned/ad-hoc, not publisher-approved |
| Source launch fails | Node 24.22.3, install completion and built dist | Run documented install/build/start from checkout; do not substitute raw Electron home profile |
| HOST_TRUST_REQUIRED | Independently obtained fingerprint | Approve only after comparison, or cancel |
| HOST_KEY_CHANGED | Saved versus observed key and legitimate server replacement | Stop; review out-of-band identity before explicitly removing old trust in Settings |
| AUTH_FAILED/KEY_INVALID | Selected method, supported key format/passphrase, size | Correct input or select a supported key; no hidden method fallback |
| SECRET_UNAVAILABLE | OS vault availability, account/device/signing continuity | Re-enter without saving if needed; never plaintext fallback |
| SFTP_UNAVAILABLE | Server subsystem/account restrictions | Use independently available terminal features; no SCP/helper workaround |
| OS_UNKNOWN/UNSUPPORTED | Observed OS or inaccessible os-release | Read-only until explicit session confirmation if unknown; detected unsupported remains read-only |
| HARDLINK_UNSUPPORTED/VERIFY_READ_DENIED | Actual destination hardlink or read-back permissions | Select a supported location; never skip verification or delete destination |
| SOURCE_CHANGED/VERIFY_MISMATCH | Actual observed stat/hash boundary | Inspect source/task; make a new explicit selection after review |
| CANCEL_TOO_LATE | Finalization intent pending/committed | Wait for observed outcome; no misleading accepted cancel |
| STORAGE_FAILED | Disk space/access/locking and unsettled writer | Preserve files; fix underlying local condition then explicit recheck |
| RESULT_UNKNOWN/PARTIAL_RENAME | Last confirmed phase and both relevant locations | Inspect read-only, then acknowledge after review; do not infer old success or auto-delete |
| STOP_UNCONFIRMED | TERM request and observed exit/close | Keep output or explicitly close channel; remote process may survive |
| Delayed/unavailable response metric | Probe state, app focus and sample age | Wait or use Tasks; metric failure alone does not stop SSH work |
| Terminal input disabled | Backpressure, restore barrier or memory breaker | Let ACK settle or explicitly recover/new display; never replay historical keys |

For a bug report include version, source/artifact hash, OS/CPU, isolated reproduction, expected/actual outcome and redacted fixed codes. Use [Security](../../../SECURITY.md) for sensitive vulnerabilities. Do not publish credentials, real endpoints, usernames, paths or raw outputs.
