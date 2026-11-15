# User Guide

The application UI currently uses Korean labels. English descriptions below explain actions without changing those labels.

## Connect

Open the connection manager, register a display name, host, port, username and authentication method, then connect. Use a password or a supported private-key file; enter its passphrase if encrypted. Credential storage is off by default.

For a new endpoint, compare the displayed SHA-256 host fingerprint with a trusted source before approving. sshOS closes the observation socket before authentication, saves approved trust and reconnects to verify it. A changed host key blocks authentication. Review and remove old trust in Settings only after confirming why it changed; there is no ignore-key-change connection mode.

The initial supported server is Ubuntu 24.04. If the OS cannot be read, a session-specific confirmation is required before write/execute features. A detected unsupported OS stays read-only. SFTP-only and exec/PTY-only restrictions are reported independently.

## Desktop and Files

Double-click a desktop launcher, or select it and press Enter. Windows belong to their original server; focus changes the active-server indicator without retargeting existing work. Use the taskbar to restore windows. Minimizing a window does not cancel its operation.

The file explorer combines tree and list. Open folders to navigate; double-clicking a regular file opens a supported read-only viewer or a format choice. It never runs the file. Text is UTF-8, at most 2 MiB; static PNG/JPEG/WebP images are at most 20 MiB compressed and 40,000,000 pixels with each edge at most 16,384 pixels. There is no GUI Save action.

Use Refresh to see external changes. Viewers require an explicit reread; they do not watch the server. The last listing/content can remain visible read-only after disconnect, with its read time.

## Transfers and File Changes

Select upload files or a download folder using the native dialog, review the server/path/conflict preview and confirm. A conflicting destination offers another name, skip or cancel. The app never overwrites it.

The persistent shelf separates byte transfer from full content verification. Upload read-back adds download traffic and time. A completed byte bar does not mean finalization has finished. At most two transfers run globally and one per server; at most 100 wait. Closing the explorer does not stop an accepted transfer.

The first version supports one-folder creation, same-folder regular-file rename and nonrecursive regular-file/empty-folder deletion. It excludes recursive transfers/deletion, folder rename, permission editing and move/copy between servers. Terminal commands are a separate remote-account facility.

## Run a Program or Terminal

Choose the explicit Run action on a regular file. Confirm server, account, absolute source path, working directory, direct/sh/bash mode and separate arguments. Opening a `.sh` as text does not execute it. The server must already have the selected executable/interpreter and a compatible account environment.

The output window displays bounded stdout/stderr and observed exit information. Exit code 0 is an observed process result, not proof that a business task or file change succeeded. A GUI program's graphical window is not forwarded. Programs needing interactive input belong in a separate PTY terminal.

The terminal runs the remote account's existing login shell and can run installed tools such as `vi`. Multiline or large paste requires confirmation for the fixed target. Closing a terminal channel or requesting TERM does not prove every remote child/daemon stopped.

## Delays and Unknown Outcomes

The top-right response value measures completion of a short `/bin/true` command over the active SSH connection, including server processing. It is not ICMP ping, pure RTT or a server health score. A delayed/unavailable measurement does not by itself cancel file or terminal work.

After a timeout/disconnect, inspect Tasks for the last confirmed phase. `result_unknown` means the app cannot prove the outcome. Opening a location reads current state; it does not retroactively prove the original operation succeeded. Acknowledge/close a record only after reviewing it. Nothing automatically reconnects, reruns a command or resumes a transfer.

## Settings and Exit

Settings manages saved trust and saved credential removal, redacted diagnostics and offline license notices. Review an export before sharing it. Local task records contain endpoint/path information and are not anonymous.

Disconnect and app exit list affected transfers/executions/terminals and offer an explicit keep-or-stop choice. Closing the app is not a hidden tray-background mode. Reopening the app does not replay old work.
