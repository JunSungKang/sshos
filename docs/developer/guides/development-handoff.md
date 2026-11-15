# Development Artifact Handoff

The existing verified development artifacts were built from clean runtime revision `8b41e23211fcac17ca40a467cd5c93c7a2d89264`, then independently reviewed and integrated through [PR1](https://github.com/JunSungKang/sshos/pull/1). Later documentation relocation does not rebuild or relabel those binaries. Their exact source archive retains the original layout.

| Target | Checkout-relative directory | Artifact | Bytes |
| --- | --- | --- | --- |
| Windows 11 x64 | `.local/packages/8b41e23211fc-win-a24506fe-5390-48b1-a56b-418f3b8fb4d8/` | `sshOS 0.1.0.exe` |162144333 |
| macOS 14 arm64 | `.local/packages/8b41e23211fc-mac-88069be5-6f3d-4e1b-9dae-266fcc49fcd3/` | `sshOS-0.1.0-arm64-mac.zip` |120592957 |
| macOS 14 x64 | Same mac directory | `sshOS-0.1.0-mac.zip` |127800737 |

These paths exist in the original developer checkout, not in a fresh clone. A fresh clone rebuilds using [Packaging](packaging.md). Do not present absent generated binaries as downloadable repository files.

[Artifact manifest](../../../evidence/d12-reviewed-development/artifacts.json) records SHA256/source correspondence; target reports and SHA256SUMS accompany it. Windows unsigned/macOS ad-hoc. Static checks verified 926 ASAR members per target, embedded integrity,6 fuses,20 Windows/14 macOS notices, size and ad-hoc deep/strict checks. Actual supported-target launch remains untested.

Dated local evidence:553 unit cases,17 integration suites,61 security cases, per-file 90/85 coverage gates; aggregate 96.08% statements/91.63% branches. [Partial performance](../../../evidence/d12-reviewed-development/performance-partial.json):100 durable registrations p95=1135.61 ms,5 warm development launches 527.08–951.74 ms,100 UI click feedback p95=30.80 ms, one 586.015625-MiB working-set snapshot. Exit2 preserves untested target acceptance. Registration uses an in-process RPC adapter; UI timing ends at the second animation frame, not OS presentation.

Use [Native Validation](native-validation.md) and [Acceptance Checklist](quality-security-checklist.md) for user testing. Native/vault/IME/accessibility/controlled performance, publisher signing/notarization, usability and public-release decisions remain open.
