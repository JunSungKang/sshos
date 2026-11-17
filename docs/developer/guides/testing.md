# Testing and Evidence

## Available Checks

Run from the repository root after installation:

```sh
python3 -B scripts/validate-docs.py --root .
npm run typecheck
npm run test:unit
npm run test:coverage
npm run build
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:performance
```

Select affected checks rather than treating every command as required for every prose change. Integration/security/e2e launch real Electron and loopback SSH fixtures, require a usable desktop session, and should not run concurrently when focus matters. Reports identify source hashes and adapters replacing native dialogs/vault/focus. Scripts reject source changes during measurement.

Unit coverage enforces per-file statement 90%/branch 85% for configured modules. Preserve documented actual-process entrypoint verification; do not add exclusions or lower thresholds to pass. Meaningful boundary/state/fault behavior matters beyond percentages.

The integration group also includes `remote-desktop-gui-smoke`: actual context menu/properties, nonempty folder rename and one-command recursive delete, zero SFTP READDIR, isolated HTML/CSS/image rendering, JavaScript default/opt-in, root expansion, network/API isolation, native geometry and overlay/close disposal. Its server is a strict command-template adapter, not a real GNU shell.

`connect-ui-smoke` exercises card layout at 1120/1600/1920 px, long names/endpoints, vertical reachability, add/edit popups, keyboard focus/Escape, failed key saving with a retained draft, native-selected key reuse, the actual JSON writer ACK barrier, profile limits and confirmed deletion. It also switches two observed server workspaces while retaining one PTY and its input bytes, checks active identity locks, and verifies that clearing selection keeps connections alive. The native file picker is replaced only in the test main process. Fixture screenshots and a report are stored in ignored `.local/evidence/connect-card-workspaces`; they do not prove native OS or real Ubuntu acceptance.

The integration group includes `text-edit-gui-smoke`: default read-only opening, explicit Edit/Save, editor viewport geometry and padding, unchanged remote bytes before Save, BOM plus leading U+FEFF content/CRLF/mode preservation, durable content-free edit records, conflicting external edits with retained drafts, discard/close/quit confirmation, Desktop PNG/JPG/JPEG/WebP display, and independent terminal-tab closing including the final tab. Unit fault tests cover capability/byte limits, source and staged-file changes, path locks, cancellation before metadata queue admission and during source reads, deferred finalization of active saves, storage ACK failures, unsupported publication and unknown outcomes. No real server fault injection or native target acceptance is inferred from these fixtures.

Packaging runs an additional archived-worker SSH/SFTP regression for each target ASAR. To repeat it for an existing workspace-local artifact, run `node scripts/package-ssh-smoke.mjs <absolute-path-to-app.asar>`. It uses host development Electron, an isolated temporary profile and a loopback fixture, then removes that profile/fixture. It tests the packaged SSH dependencies through host trust, authentication and directory enumeration; it does not establish native target executable acceptance. See [Packaging](packaging.md) for the required portable crypto module and report scope.

`test:performance` measures actual local registration, warm Electron launch and trusted UI clicks. Successful partial measurement deliberately exits 2 when target acceptance remains untested; do not relabel 2 as target pass. One working-set snapshot is not a settled 300-sample p95. Isolated loopback fixtures do not require a real TEST_HOST; this actual implementation is distinct from the original plan's external-target environment check. Missing real target access never passes native acceptance.

## Product Acceptance

The checklist (private local material) has 152 rows:149 technical-required and 3 nonblocking research rows. All remain untested as compound product criteria. Dated553-unit/17-integration/61-security results are separate evidence, not 152 passed acceptance rows.

Native acceptance covers Windows 11 x64 and macOS 14 arm64/x64 with Ubuntu Server 24.04 LTS amd64/arm64. Record hardware, network conditions, repetitions, IME/accessibility and package signature status. Unavailable native targets remain untested. Do not exercise fault fixtures on user servers.

For each executed row record checkId, status, binary SHA256, source revision, app version, client/server OS/CPU/OpenSSH, fixture settings, procedure, expected/actual, evidence and defectId. Keep failures and retests separately. Screenshots cannot prove byte integrity, host trust, egress or native signatures.

## Documentation Checks

The documentation validator checks public links and rejects tracked private planning paths, including ignored paths that were force-added. It runs without private planning archives. It does not certify product behavior, legal compliance or native acceptance.

`node scripts/metadata-benchmark.mjs` compares batched SFTP READDIR against the command-backed FileBrowser using 100/1,000/10,000 entries and 0/50/150 ms server-response delays. It writes ignored `.local/performance/metadata-comparison.json`. This is a single-run adapter comparison, not real GNU process timing, calibrated network RTT, renderer first-paint or target acceptance.

The HTML fixture includes a 17 MiB resource: concurrent reads must reserve the load budget before content IO, repeated denied requests must add zero file-content bytes, and worker tests bound growth verification to one byte. WebRTC checks use owned loopback UDP/STUN and TCP/TURN listeners with an unprotected positive control and explicit local-network permission grants. The protected preview must produce zero packets/connections, including fresh about:blank/srcdoc realms and navigation; debugger detachment must destroy its contents. These are transport-policy checks, not internet canaries or target-platform acceptance.
