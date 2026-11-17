# User Guide

The application UI currently uses Korean labels. English descriptions below explain actions without changing those labels.

## Connect

Open Connect to see saved servers as cards. Choose `서버 추가` to open the registration popup, enter a display name, host, port, username and authentication method, then save. Use a password or a supported private-key file; enter its passphrase when connecting if encrypted. Credential storage is off by default. The grid shows four compact cards per row, each about one third the previous height; scroll to reach additional rows. Name, connection state and account/endpoint stay visible. The pencil and trash icons edit/delete the profile. Choose `상세` to expand authentication, OS/SFTP information and Disconnect. When confirmation or error information needs attention, the same toggle reads `확인` or `오류`. Expanding details increases only that card's height. Up to ten profiles can be saved. `목록 새로고침` rereads local saved profiles and does not connect to a server.

Each card identifies its endpoint, account, authentication method and observed connection state. Choose Connect on a disconnected card; a connected card offers `열기` for its workspace and a separate Disconnect action inside its details. Edit opens the same popup with saved values. Cancel or Escape discards the popup draft without changing saved information. Save errors retain the draft; an in-progress save must finish before the popup closes. While connected, only the display name can be edited. Deleting a profile requires confirmation and never deletes remote files; live connections and unresolved work continue to restrict profile changes.

For a new endpoint, compare the displayed SHA-256 host fingerprint with a trusted source before approving. sshOS closes the observation socket before authentication, saves approved trust and reconnects to verify it. A changed host key blocks authentication. Review and remove old trust in Settings only after confirming why it changed; there is no ignore-key-change connection mode.

The initial supported server is Ubuntu 24.04. If the OS cannot be read, a session-specific confirmation is required before write/execute features. A detected unsupported OS stays read-only. SFTP-only and exec/PTY-only restrictions are reported independently.

## Desktop and Files

Use Connect, sFTP and Settings in the left sidebar. Choose Desktop or Console at the top right. Select a server in the sidebar's `작업 공간` list; its button highlights and the header identifies the current account and endpoint. The clear button deselects the workspace while retaining connections and existing work. Switching servers retains the current mode and existing terminals/transfers; it does not connect, inject shell input or retarget accepted operations. The bottom-left area identifies the selected server and its SSH response state.

After authentication, Desktop shows the actual account home contents as icons. Double-click a folder or select it and press Enter to open an explorer window. Inside that explorer, activate a folder to navigate. Desktop remains at home. A denied or unmappable home lookup explains the failure and offers an explicit SSH-start-directory fallback, labeled as such. Use the task strip to restore file/viewer/output windows. Minimizing a view does not cancel its operation.

Show hidden files defaults off. Change it in Settings to update Desktop and all explorers after the preference is saved. The preference survives restart; hiding an item clears its selection without stopping accepted work. A failed save retains the previous setting.

The file explorer combines tree and list. Open folders to navigate; double-clicking a regular file opens a supported read-only viewer or a format choice. It never runs the file. Text is UTF-8, at most 2 MiB; static PNG/JPEG/WebP images are at most 20 MiB compressed and 40,000,000 pixels with each edge at most 16,384 pixels. Text opens read-only and offers explicit Edit/Save; see the editing section below.

Desktop lists, properties and confirmed file/folder changes use SSH commands. Opening file contents, HTML resources, saving text and transferring files require SFTP separately. Unavailable SFTP does not disable command-backed browsing.

Use Refresh to see external changes. Viewers require an explicit reread; they do not watch the server. The last listing/content can remain visible read-only after disconnect, with its read time.

## Transfers and File Changes

Select upload files or a download folder using the native dialog, review the server/path/conflict preview and confirm. A conflicting destination offers another name, skip or cancel. The app never overwrites it.

The persistent shelf separates byte transfer from full content verification. Upload read-back adds download traffic and time. A completed byte bar does not mean finalization has finished. At most two transfers run globally and one per server; at most 100 wait. Closing the explorer does not stop an accepted transfer.

Download verifies the bytes written to the local temporary file after checking the remote file's reported size and modification time. A detected source change stops the download before it creates the final file. Other users can edit a file during the download, and edits that leave the reported attributes unchanged may go undetected. For a point-in-time copy, select an immutable copy or snapshot provided by the server. The task details distinguish observed source changes, temporary file verification failures and local name conflicts.

Right-click an operable file or folder for Open, Delete, Rename and Properties. Rename stays within the same parent and never replaces an existing destination. Delete permanently removes the item and all descendants after confirmation; there is no trash or undo. It uses one server recursive command, not client-side per-entry deletion. A failed deletion may be partial; a disconnect can leave the result unknown. Basic properties refresh the selected item and show numeric owner/group IDs, permissions, size and times. Folder size is the directory entry size, not recursive disk usage. Recursive transfers, permission editing and move/copy between servers are not provided.

Rename is supported only on verified ext-family, btrfs, tmpfs or XFS mounts with Linux 6.8 or later and unfiltered SSH command processes (`Seccomp: 0`). NFS, FUSE, overlay, filtered containers and unverified environments are refused before renaming, with an explicit error. This restriction does not disable browsing, viewing or transfers. Avoid concurrent parent-directory replacement/remounts; the app does not provide a server-side filesystem sandbox.

## Run a Program or Terminal

Choose the explicit Run action on a regular file. Confirm server, account, absolute source path, working directory, direct/sh/bash mode and separate arguments. Opening a `.sh` as text does not execute it. The server must already have the selected executable/interpreter and a compatible account environment.

The output window displays bounded stdout/stderr and observed exit information. Exit code 0 is an observed process result, not proof that a business task or file change succeeded. A GUI program's graphical window is not forwarded. Programs needing interactive input belong in a separate PTY terminal.

Choose Console for the central terminal workspace. Mode changes keep existing terminal sessions and transfers. Use the Console tabs to select an existing terminal, New Terminal to explicitly open another within channel limits, and the selected tab’s × icon for the confirmation flow. Explorer navigation never injects commands into the shell.

The terminal runs the remote account's existing login shell and can run installed tools such as `vi`. Multiline or large paste requires confirmation for the fixed target. Closing a terminal channel or requesting TERM does not prove every remote child/daemon stopped.

## Delays and Unknown Outcomes

The bottom-left response value measures completion of a short `/bin/true` command over the active SSH connection, including server processing. It is not ICMP ping, pure RTT or a server health score. A delayed/unavailable measurement does not by itself cancel file or terminal work.

After a timeout/disconnect, inspect Tasks for the last confirmed phase. `result_unknown` means the app cannot prove the outcome. Opening a location reads current state; it does not retroactively prove the original operation succeeded. Acknowledge/close a record only after reviewing it. Nothing automatically reconnects, reruns a command or resumes a transfer.

## Settings and Exit

Open Settings and use the `테마` selector under `테마와 색상`. The default is dark chocolate. The following presets are available:

| Preset | Appearance |
| --- | --- |
| 다크초코 · 기본 | Chocolate, warm gold and layered arches |
| 아톰 | Graphite grid and blue atomic orbits |
| 우분투 | Aubergine and folded orange polygons |
| CentOS | Purple/lime diamond mosaic |
| Kali Linux | Navy dotted grid and blue circuit traces |
| 윈도우11 | Soft blue folded ribbons |
| 윈도우98 | Pixel steps, gray bevels and navy title bars |
| 윈도우XP | Original rolling hills, blue title bars and green actions |
| 고스트 | Lavender mist, moon and translucent arches |
| 도시 | Teal skyline and illuminated window pattern |
| 시골 | Linen, curved fields and a small farmhouse |
| 판타지 | Original rune circles, floating crystal and distant citadel |
| 스타크래프트 | Original industrial panels and a green radar schematic |
| 자연(강) | Teal flowing contour lines |
| 자연(하늘) | Cloud banks and soft sunlight |
| 자연(산) | Layered mountain ridges and conifers |
| 자연(무인도) | Sand island, shoreline rings and palm silhouettes |

The 17 presets include original bundled artwork and a matching wallpaper scene in Settings. They require no theme downloads, external images or fonts. Desktop file labels have a quiet backing; terminal, editor and list surfaces remain opaque. A successful save applies the palette to app-owned surfaces and open terminals without closing their SSH channels, then preserves the choice for the next launch. A failed save keeps the last acknowledged theme. Remote programs can still choose their own terminal colors, and native OS dialogs retain OS appearance.

Dragon Ball and Doraemon presets have been removed; a saved selection of either opens as default chocolate. The former League of Legends selection opens as the original fantasy preset. No game illustrations, characters, maps or logos are bundled. All other unknown stored IDs remain invalid; invalid requests do not silently choose another theme.

Settings manages saved trust and saved credential removal, redacted diagnostics and offline license notices. Review an export before sharing it. Local task records contain endpoint/path information and are not anonymous.

Disconnect and app exit list affected transfers/executions/terminals and offer an explicit keep-or-stop choice. Closing the app is not a hidden tray-background mode. Reopening the app does not replay old work.

## Editing Text and Viewing Images

Double-click a UTF-8 text file in Desktop or an explorer. It opens read-only. Choose `편집`, change the text, then choose `저장` (or Ctrl/Cmd+S). Typing, changing modes or minimizing the window does not save. Successful saving returns to read-only and rereads the file. `편집 취소` discards the draft only after confirmation when changed. Window close and app exit also warn about editing. Drafts stay in memory and are lost if the app/renderer crashes.

Text is limited to 2 MiB, preserves an existing UTF-8 BOM and uniform LF/CRLF. Mixed or legacy CR line endings stay read-only. Saving requires a writable supported server session, permission to create a temporary file in the same directory, preservation of owner/group/mode, and OpenSSH POSIX rename support. An observed external change stops Save and retains the draft. SFTP cannot make the conflict check atomic with replacement, so avoid concurrent edits. Failed/uncertain Tasks may retain a hidden temporary path for explicit inspection; there is no automatic retry or cleanup. Replacement does not preserve hardlinks, ACLs or extended attributes.

Double-click PNG, JPG/JPEG or static WebP to open the image viewer. Recognition uses file bytes, not only the extension. Use screen-fit or zoom without downloading the file again. Compressed files are limited to 20 MiB, 40 million pixels and 16384 pixels per dimension. GIF/BMP/TIFF/HEIC/SVG and animated formats are not supported by this viewer; download them for a suitable local application.

In Console, use each tab's `×` button to close that specific terminal. An active terminal still asks for confirmation; closing its channel does not prove all remote child processes have terminated.

## Remote HTML Preview

Open an `.html` or `.htm` file to show it in an internal browser window. Relative CSS, images, fonts, JavaScript and JSON resources are read over SFTP; no web server is installed or started. The default resource root is the HTML file’s containing folder. To include parent-folder resources, explicitly set an absolute root that contains the document and choose Apply Root. Root changes reload the page. Symlink files/parents and unsupported resource types remain blocked.

JavaScript is off initially. The per-window checkbox enables it and reloads that preview. The page never receives the sshOS API, Node or local file authority. External internet requests, popups, downloads and embedded frames are blocked. Pages requiring a backend, remote CDN, server routing or external API may therefore be incomplete. This is a static file preview, not a running website.

Each resource is limited to 20 MiB; a load is limited to 64 MiB and 512 requests. Refresh explicitly reloads. Switching to Console or opening Settings hides the browser content; closing its window disposes it. Source HTML and normal image-viewer pixels retain their own colors.
