# sshOS Product Plan

English edition of approved v6,2026-11-15. Version 0.1.0 now has implementation and local development evidence. [Release Readiness](release-readiness.md) describes remaining acceptance gates; original pre-implementation statements are dated history.

## 1 Purpose and Users

sshOS is a client desktop workspace for Linux servers reached using existing SSH credentials. It helps individual operators who repeatedly inspect/move files and run scripts but find switching tools and entering commands for every basic action burdensome. It does not attempt a separate GUI for every Linux command. Advanced commands remain explicit remote-terminal work.

Core flow: launch → register server → verify host fingerprint → authenticate → desktop → browse → view or explicitly execute → inspect transfer/output/outcome. The desktop is sshOS's client UI, not a streamed GNOME/KDE/Windows session.

## 2 Scope

| Area | Included |
| --- | --- |
| Client | Electron, Windows portable exe, macOS app; no separately installed runtime/browser/DB |
| Server | Existing SSH/SFTP/exec/PTY; no sshOS agent/helper/central server/HTTP port |
| Persistence | Local JSON plus OS-encrypted explicitly saved secrets; no application SQLite/ORM/IndexedDB/LevelDB |
| Authentication | Username+password or supported private key/passphrase; one selected method |
| Workspace | Desktop/launchers/movable-resizable-overlapping windows/min-max-restore/taskbar |
| Files | One tree+list explorer, manual refresh, single-folder create, same-parent regular-file rename, nonrecursive delete, asynchronous regular-file transfers |
| Viewers | Read-only UTF-8 text/static PNG-JPEG-WebP within fixed limits |
| Execution | Explicit selected-file direct/sh/bash execution with bounded stdout/stderr/exit; separate SSH PTY |
| Feedback | Active server/connection/SSH response at top-right; persistent transfer shelf |
| License | AGPL-3.0-only project; MIT-preferred compatible upstream components with their own obligations |

Exclude remote GUI/X11/Wayland/VNC/RDP, server desktop install, local OS terminal, dedicated service/process/package/firewall/Docker/DB management GUI, deployment automation, tunnels/jump hosts/external agents/MFA, plugins/team server. Exclude GUI editing/overwrite/chmod/recursive folder transfer-delete/folder rename/move/server-to-server copy/link-special manipulation/pause-resume and automatic reconnect.

No hidden browser/error search/AI/model SDK/telemetry/crash upload/updater or reserved menus/stubs for them. No external filesystem watcher/auto-sync. Own transfer progress and program output remain live streams. These GUI limits do not prohibit user-typed terminal commands; the remote account's permissions are authoritative.

## 3 Initial Targets and Tradeoffs

Windows 11 x64; macOS 14 arm64 and native x64; Ubuntu Server 24.04LTS amd64/arm64 with existing OpenSSH. Additional macOS majors need actual two-CPU testing. Ordinary local APFS/NTFS only; network/cloud-placeholder/FAT-exFAT excluded. File features need SFTP, execution needs exec/PTY, and hardlink finalization/read-back need corresponding path permissions.

Portable means no installer or separate runtime. Windows may extract internal files; macOS app is a bundle; settings/cache still exist in userData. Electron's memory/size cost is measured against the fixed budgets, never marketed as universally lightest.

Unknown OS permits reads until session-specific Ubuntu confirmation; detected unsupported OS is read-only. SFTP-only and denied exec/PTY remain distinct capabilities. Programs/interpreters must already exist; sshOS never installs or grants them.

## 4 Desktop and File Workflow

One main Electron window contains Connections, Files, Text, Image, Execution Output, Terminal, Tasks and Settings internal windows. A fixed sidebar replacing the whole screen is not the intended desktop. Tree/list are one explorer. Existing work retains its server across focus/top-selector changes; minimize preserves it. Close and stop differ by resource kind; see [Desktop Interaction](../architecture/desktop-interaction.md).

Folder open navigates; regular-file double-click opens a viewer/format choice and never executes. A `.sh` can be read as text. Run is a separate confirmation of server/account/path/cwd/mode/args. Viewers have no Save. Use SFTP for text/list data, not parsing `vi`/`ls`; run real `vi` only inside PTY. Remote graphical windows are not displayed.

## 5 Transfer Safety and Progress

At most 2 active transfers globally,1/server,100 waiting. Accepted work survives explorer close/minimize/reload. Shelf always displays server, direction, name, actual bytes, phase and rate; Tasks shows the rest.

Conflicts allow new name/skip/cancel. Full SHA256 read-back, exclusive final-name creation and final receipt ACK precede completed. Upload read-back costs extra traffic/time. Unsupported hardlink never falls back to deleting/overwriting. Request0600 files/0700 folders; do not clone source metadata. Unknown outcome is neither failure proof nor success; never auto-replay or scan/delete old temp patterns.

## 6 SSH Response and Trust

The top-right metric measures `/bin/true` from actual exec through observed exit 0+close, including server/network work. It is not ping/pure RTT/health scoring and does not restrict user exec/PTY. Display measuring/delayed/unavailable/waiting/paused/disconnected as appropriate. Deadline5 s, next after 5 s, freshness 15 s; pause while app inactive/minimized/suspended. A probe failure alone does not stop files/terminals.

Verify every socket's host blob, block changed keys, require persisted approval before auth. Secret saving defaults off; selected secrets use OS encryption with no plaintext fallback. Local endpoint/path receipts are not anonymous. No automatic privilege elevation. User commands and external writers bypass GUI path locks and may themselves write files or use the network.

## 7 Value Hypotheses and Research

The hypothesis is that one coherent desktop improves context and server/outcome understanding for existing SSH users. Similar tools already have files/viewers/terminals; feature presence is not exclusive differentiation or proven demand. Focus on agentless start, consistent workspace, clear server identity and honest delay/uncertainty rather than every administration feature.

- G0: interview 6 users with relevant SSH file/execute work in the last 3 months; retain problem hypothesis if≥4 describe actual recurring pain.
- G2:12 users perform the same connect/browse/view/transfer/execute/slow-response/disconnect tasks using their usual tools and sshOS; counterbalance order 6/6. Targets:independent normal completion≥10/12, outcome+server identification on both fault tasks≥9/12, wrong-server changes 0, false completion 0. Do not handicap baseline or hide unsupported tasks.
- G3:6 users over 4 weeks; among≥4 with≥2 eligible opportunities, ≥3 voluntarily use it≥2 times supports repeat-use hypothesis. Insufficient opportunity is insufficient observation.

These are design criteria, not paper results. Studies remain unperformed and nonblocking for independent engineering; they do not pass technical release gates or establish universal preference.

## 8 Authority and Stages

Latest explicit user instruction takes precedence. Product scope:this plan; engineering/security/budgets:[Development Plan](development-plan.md); window behavior:desktop contract; actual current evidence:release readiness. English edition and [contract index](../architecture/contract-index.json) preserve the original scope and provenance. Historical artifacts cannot add features. D01–D13 retain original dependency/acceptance mappings while independent implementation proceeds under the user's later instruction.
