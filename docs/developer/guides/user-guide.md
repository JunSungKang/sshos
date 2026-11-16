# User Guide

The application UI currently uses Korean labels. English descriptions below explain actions without changing those labels.

## Connect

Open the connection manager, register a display name, host, port, username and authentication method, then connect. Use a password or a supported private-key file; enter its passphrase if encrypted. Credential storage is off by default.

For a new endpoint, compare the displayed SHA-256 host fingerprint with a trusted source before approving. sshOS closes the observation socket before authentication, saves approved trust and reconnects to verify it. A changed host key blocks authentication. Review and remove old trust in Settings only after confirming why it changed; there is no ignore-key-change connection mode.

The initial supported server is Ubuntu 24.04. If the OS cannot be read, a session-specific confirmation is required before write/execute features. A detected unsupported OS stays read-only. SFTP-only and exec/PTY-only restrictions are reported independently.

## Desktop and Files

Use Connect, sFTP and Settings in the left sidebar. Choose Desktop or Console at the top right. The bottom-left area identifies the selected server and its SSH response state. Select another server explicitly in the header; existing operations retain their original target.

After authentication, Desktop shows the actual account home contents as icons. Double-click a folder or select it and press Enter to open an explorer window. Inside that explorer, activate a folder to navigate. Desktop remains at home. A denied or unmappable home lookup explains the failure and offers an explicit SFTP-start-directory fallback, labeled as such. Use the task strip to restore file/viewer/output windows. Minimizing a view does not cancel its operation.

Show hidden files defaults off. Change it in Settings to update Desktop and all explorers after the preference is saved. The preference survives restart; hiding an item clears its selection without stopping accepted work. A failed save retains the previous setting.

The file explorer combines tree and list. Open folders to navigate; double-clicking a regular file opens a supported read-only viewer or a format choice. It never runs the file. Text is UTF-8, at most 2 MiB; static PNG/JPEG/WebP images are at most 20 MiB compressed and 40,000,000 pixels with each edge at most 16,384 pixels. There is no GUI Save action.

Use Refresh to see external changes. Viewers require an explicit reread; they do not watch the server. The last listing/content can remain visible read-only after disconnect, with its read time.

## Transfers and File Changes

Select upload files or a download folder using the native dialog, review the server/path/conflict preview and confirm. A conflicting destination offers another name, skip or cancel. The app never overwrites it.

The persistent shelf separates byte transfer from full content verification. Upload read-back adds download traffic and time. A completed byte bar does not mean finalization has finished. At most two transfers run globally and one per server; at most 100 wait. Closing the explorer does not stop an accepted transfer.

The first version supports one-folder creation, same-folder regular-file rename and nonrecursive regular-file/empty-folder deletion. It excludes recursive transfers/deletion, folder rename, permission editing and move/copy between servers. Terminal commands are a separate remote-account facility.

## Run a Program or Terminal

Choose the explicit Run action on a regular file. Confirm server, account, absolute source path, working directory, direct/sh/bash mode and separate arguments. Opening a `.sh` as text does not execute it. The server must already have the selected executable/interpreter and a compatible account environment.

The output window displays bounded stdout/stderr and observed exit information. Exit code 0 is an observed process result, not proof that a business task or file change succeeded. A GUI program's graphical window is not forwarded. Programs needing interactive input belong in a separate PTY terminal.

Choose Console for the central terminal workspace. Mode changes keep existing terminal sessions and transfers. Use the Console tabs to select an existing terminal, New Terminal to explicitly open another within channel limits, and Close Terminal for the confirmation flow. Explorer navigation never injects commands into the shell.

The terminal runs the remote account's existing login shell and can run installed tools such as `vi`. Multiline or large paste requires confirmation for the fixed target. Closing a terminal channel or requesting TERM does not prove every remote child/daemon stopped.

## Delays and Unknown Outcomes

The bottom-left response value measures completion of a short `/bin/true` command over the active SSH connection, including server processing. It is not ICMP ping, pure RTT or a server health score. A delayed/unavailable measurement does not by itself cancel file or terminal work.

After a timeout/disconnect, inspect Tasks for the last confirmed phase. `result_unknown` means the app cannot prove the outcome. Opening a location reads current state; it does not retroactively prove the original operation succeeded. Acknowledge/close a record only after reviewing it. Nothing automatically reconnects, reruns a command or resumes a transfer.

## Settings and Exit

Open Settings and use the `테마` selector under `테마와 색상`. The default is dark chocolate. The following presets are available:

| Preset | Appearance |
| --- | --- |
| 다크초코 · 기본 | Dark chocolate and warm gold |
| 아톰 | Graphite and blue |
| 우분투 | Aubergine and orange |
| CentOS | Purple and lime |
| Kali Linux | Navy and blue |
| 윈도우11 | Pale gray and blue |
| 윈도우98 | Gray, navy title bars and square controls |
| 윈도우XP | Blue title bars and green actions |
| 고스트 | Misty white and lavender |
| 도시 | Slate and teal |
| 시골 | Linen and olive |
| 리그오브레전드 | Deep blue and aged gold |
| 스타크래프트 | Metal charcoal and green |
| 드래곤볼 | Cream and orange |
| 도라에몽 | Pale sky blue and blue |
| 자연(강) | Dark river teal |
| 자연(하늘) | Bright white and sky blue |
| 자연(산) | Forest green and earth tones |
| 자연(무인도) | Sand and sea green |

These are original built-in visual interpretations. They require no theme downloads, external images or fonts. A successful save applies the palette to app-owned surfaces and open terminals without closing their SSH channels, then preserves the choice for the next launch. A failed save keeps the last acknowledged theme. Remote programs can still choose their own terminal colors, and native OS dialogs retain OS appearance.

Settings manages saved trust and saved credential removal, redacted diagnostics and offline license notices. Review an export before sharing it. Local task records contain endpoint/path information and are not anonymous.

Disconnect and app exit list affected transfers/executions/terminals and offer an explicit keep-or-stop choice. Closing the app is not a hidden tray-background mode. Reopening the app does not replay old work.
