# Security Policy

sshOS 0.1.0 is a development version. Release Readiness (private local material) separates implementation from native/security/public-release acceptance. Existing Windows development binaries are unsigned; macOS is ad-hoc only, without publisher notarization.

## Report a Vulnerability

Use GitHub private vulnerability reporting if enabled for this repository. If unavailable, open a public issue containing only the affected feature category and a request for a private contact path, then agree a channel with the maintainer. Do not publish exploit details, credentials, private keys, passphrases, tokens, real endpoints/usernames/paths, raw terminal/file bodies or full diagnostic dumps.

Where safe, provide source/artifact hash, app version, OS/CPU, isolated reproduction, expected/actual result and affected boundary. Test only systems you own or are explicitly authorized to assess; never apply destructive/disk-full/permission/trust fault fixtures to user production servers. No response-time or remediation SLA is promised.

## Protected Boundaries

Renderer is sandboxed and has only named preload capabilities. Main owns trust/native selection/OS vault/JSON; utilityProcess owns SSH and remote I/O. Every socket verifies the pinned host key before authentication. No external SSH agent, remote helper, management listener or database.

Changing operations and exec/PTY creation await durable intent ACK. Timeout/local close is not proof of remote failure or process termination. Unknown outcomes remain unknown with no automatic replay. No app-origin AI/search/telemetry/crash upload/updater traffic; explicit user-run remote programs have their own behavior.

Default diagnostics use fixed codes and allowlisted metadata. Local receipts contain endpoint/path information and are not anonymous. Redacted export requires preview/native selection; review before sharing. Viewer/terminal bodies, argv and credentials do not belong in default logs.

## Release Blocking Conditions

Applicable unresolved high/critical vulnerabilities, unknown/incompatible distribution licenses and failed required security checks block public release. Exclusions need exact version, reachability, evidence and reviewer; do not arbitrarily lower severity. Missing environments remain untested. The project license does not certify security, and independent code approval is not target/publication approval.
