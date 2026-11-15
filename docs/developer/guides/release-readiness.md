# Release Readiness

Status as of 2026-11-15: **development implemented; public-release readiness false**. This documentation migration changes neither application behavior nor prior test results.

| Area | Evidence and limit |
| --- | --- |
| Feature implementation | Profiles/trust, desktop/files/viewers/transfers, GUI exec, PTY, lifecycle/probe/settings/diagnostics/licenses exist |
| Units/coverage |553 cases,101 configured coverage targets, all per-file 90%/85% gates; aggregate 96.08%/91.63% |
| Integration/security |17 actual Electron/main/worker/loopback SSH suites; 61 focused security cases plus Electron/xterm; native adapters/limits recorded |
| Development artifacts | Windows x64/mac arm64-x64, source/hash/integrity/fuse/notices/size verified; unsigned/ad-hoc |
| Independent review | Previous two major defects resolved; code/artifacts approved at exact PR1 head before merge |
| Repository | PR1 merged as9018ee7ab81d014184f759f464128536147992af; original root preserved; its work branch cleaned |
| Native acceptance | Windows 11/macOS 14×Ubuntu 24.04 six-combination OpenSSH, vault, IME/accessibility and controlled performance untested |
| Publisher trust | Credentials unavailable; Windows signing/macOS Developer ID/notarization/stapling untested |
| Research | G0/G2/G3 unperformed; no demand/repeat-use claim |
| Supply chain | Dated audit retained 6 moderate build-tool findings, high 0/critical 0; public-release review remains separate |
| Compound product acceptance |152 rows remain untested, including 149 required technical and 3 nonblocking research |

Original detailed [implementation status](../architecture/history/pre-english-20261115/docs/implementation-status.json) and [current-code evidence](../../../evidence/d11-review-corrections/integration-report.json) are dated sources. Review approval and local code coverage do not pass native tests or legal/publication gates. See [Artifact Handoff](development-handoff.md),[Dependency Review](dependency-review.md) and [Usability](usability-evaluation.md).
