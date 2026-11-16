# Desktop and Console Architecture

The application renders its own GUI in one Electron BrowserWindow. Remote programs use SSH exec or PTY channels; remote graphical windows are not forwarded.

## Common shell

A persistent 184 px sidebar contains Connect, sFTP and Settings. Its bottom area shows the explicitly selected server and SSH command-response state. A 48 px central header contains the server selector and Desktop/Console control. The 60 px transfer shelf remains visible across modes and navigation panels. Desktop also uses a 48 px task strip for explorer, viewer and execution-output windows.

DesktopShell owns presentation state and WindowManager geometry. Main retains an in-memory shell mode/selected-server snapshot for renderer recovery, without restoring SSH sessions after an application restart. Window, socket, channel and process lifetimes are independent. Focus does not retarget a resource or select another server.

## Files

After a supported connection, the worker reads the account UID/NSS home record using one fixed bounded metadata command and verifies the directory through SFTP. Invalid, denied or unmappable responses produce an unavailable state. Explicit SFTP-start fallback is identified separately from account home.

The home resource is an icon grid backed by structured bounded SFTP metadata. Desktop folder activation opens a separate explorer for that server/generation/canonical folder. Explorer folder activation navigates that explorer. Main-owned directory/entry capabilities authorize actions; names are displayed as text and never evaluated as markup or shell input. Symlinks and special files remain metadata-only under the existing policy.

The hidden-files preference defaults false, uses the main JSON writer and is broadcast after a successful write. All loaded file views apply it, clearing a newly hidden selection. Preferences do not authorize file access. Accepted tasks and open viewers survive a filter change. Explicit refresh observes external changes; there is no server watcher or periodic directory scan.

## Console and resources

Console attaches real xterm instances to main-owned PTY resources. Each tab has separate sibling select and close buttons. Closing an inactive tab remains bound to that terminal and does not select another terminal. The close icon reuses active-channel confirmation; there is no standalone current-terminal close button. Opening and closing terminals are explicit actions. Changing mode, opening a navigation panel or hiding a tab retains the channel and bounded output. Hidden terminals stop local user input and do not resize to a zero viewport. No directory-synchronizing command is injected into a shell.

Terminal paste confirmations render outside a hidden tab through a DOM portal. The confirmation and eventual paste remain bound to the original terminal resource, even if selection changes while a native clipboard read is pending. Existing paste size, gesture, sequence and restore-ACK barriers remain enforced.

Text initially opens read-only; Edit explicitly creates an in-memory draft and Save alone writes remote content. The 2 MiB UTF-8 limit, BOM and homogeneous LF/CRLF are preserved; mixed or legacy CR line endings remain read-only. Cancel/window-close confirms discarding edits, and app exit warns about open editing sessions. Save failure/conflict retains the draft. Drafts are not persisted and cannot survive a renderer/app crash. Image viewers remain read-only and support PNG, JPEG (including JPG/JPEG extensions) and static WebP by content signature, including misleading or unknown extensions, within the existing limits. Explicit execution-output windows use the existing limits. A regular-file double-click never executes it. Run confirms the fixed target, working directory, mode and individual arguments. Closing or hiding a view does not establish remote process termination.

## Explicit text saving

A completed worker text read retains its SHA256 and source metadata, not the file contents. Main binds editing and Save to that viewer/server/session generation and backend epoch. A bounded named IPC carries at most 2 MiB of UTF-8; no generic filesystem or shell bridge is added. Main durably registers a `file_mutation` / `edit` receipt before dispatch. The worker shares existing path locks and control metadata serialization with other file operations, requests main JSON ACK before temporary creation and before publication, writes an exclusive `.sshos-edit-<task-id>.tmp`, preserves POSIX owner/group/mode where permitted, and verifies the temporary bytes. It rechecks the original digest/stat and publishes only through OpenSSH `posix-rename@openssh.com`, then verifies the final bytes. Unsupported publication never falls back to truncation or shell execution.

This is optimistic conflict detection, not atomic compare-and-swap: an external writer can still race the final check/publication. Replacement changes inode identity and does not preserve hardlink relationships, ACLs or extended attributes; special-permission files are refused. There is no remote fsync/power-loss durability claim. Failed staging can leave the task-owned temporary path, shown in Tasks. Partial/uncertain receipts restrict new mutations until explicit review/acknowledgement; no automatic cleanup, retry or replay occurs. Existing create/transfer/rename no-overwrite behavior remains unchanged. [OpenSSH protocol extensions](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL) define the publication operation.

## Appearance and accessibility

Dark chocolate is the default. The Settings theme selector exposes sixteen additional original themes, including light and dark options. Every preset has a distinct static wallpaper composition and a matching Settings scene preview. SVG masters and 1600×1000 PNG renders are stored in `src/renderer/assets/themes`; CSS references bundled PNG assets with Vite's `?no-inline` suffix so the existing same-origin PNG policy serves them without data URLs or SVG execution. The original bow SVG is stored in src/renderer/assets; a local PNG is served through the restricted app protocol. ICO/ICNS resources are in build/icons. Native file dialogs follow OS appearance and source image pixels retain their original colors.

The shared spacing rhythm is 8/12/16/24/32/40 px. Controls use 12–16 px gaps; sections use 24–32 px padding and separation. Settings groups appearance, file display, saved trust, saved credentials and diagnostics into separate sections. Desktop uses 144 px cells containing 120 px icon targets, leaving 24 px between neighboring targets. Explorer rows use 42 px and tree rows use 36 px; virtualization calculations and DOM geometry use the same dimensions.

Routine buttons use filled surfaces without accent outlines. Quiet separators define panes, while neutral input outlines identify editable fields. The selected palette's accent marks primary actions, selected labels, file icons, progress and keyboard focus. The Windows 98 preset deliberately adds classic beveled controls. Text controls and window titles have explicit inner padding; xterm input geometry remains independently owned.

`src/shared/themes.ts` owns the finite theme IDs, trusted color definitions, derived readable foregrounds and terminal palettes. Main validates `settings:setTheme`, serializes the preference through the existing JSON writer and broadcasts `settings:changed` only after success. Missing legacy IDs default to chocolate. Disk loading alone maps retired `dragonball`/`doraemon` to `chocolate` and `league` to `fantasy`; the next normal JSON write persists the active ID. The store still verifies the checksum of the original payload before accepting the load. All other invalid saved IDs and all retired/invalid requested IDs are rejected. Renderer applies only the trusted palette for the acknowledged ID. The shared preference revision prevents an older initial GET from overwriting a later update.

Wallpaper artwork stays behind the desktop and inside the decorative Settings scene. It has no event handlers, animation, network source or additional window ownership. Backed file labels and opaque terminal/editor/list surfaces preserve readability. The fantasy composition is original and contains no Riot assets. SVG masters contain only inert geometry/gradients; runtime uses PNGs, and remote SVG viewer support is unchanged.

Existing xterm instances receive `options.theme` changes. They retain their channels, input queues, output and restore barriers. A current-theme ref also supplies explicitly recreated displays, so an intentional display reset does not revert to the initial palette. Theme switching introduces no SSH command, network request, database, additional runtime or downloaded theme package.

App controls retain visible keyboard focus, labels, reduced-motion behavior and distinct text/icon status. Automated contrast and fixture screenshots are separate from target screen-reader, IME and display-scaling acceptance. Native Windows/macOS and real Ubuntu/OpenSSH checks must be reported as untested when not performed.
