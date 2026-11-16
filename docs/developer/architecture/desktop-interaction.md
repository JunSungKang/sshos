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

Console attaches real xterm instances to main-owned PTY resources. Its tabs select existing terminals; opening and closing terminals are explicit actions. Changing mode, opening a navigation panel or hiding a tab retains the channel and bounded output. Hidden terminals stop local user input and do not resize to a zero viewport. No directory-synchronizing command is injected into a shell.

Terminal paste confirmations render outside a hidden tab through a DOM portal. The confirmation and eventual paste remain bound to the original terminal resource, even if selection changes while a native clipboard read is pending. Existing paste size, gesture, sequence and restore-ACK barriers remain enforced.

Read-only text/image viewers and explicit execution-output windows use the existing limits. A regular-file double-click never executes it. Run confirms the fixed target, working directory, mode and individual arguments. Closing or hiding a view does not establish remote process termination.

## Appearance and accessibility

The app uses dark chocolate surfaces, dark yellow accents and warm light text. The original bow SVG is stored in src/renderer/assets; a local PNG is served through the restricted app protocol. ICO/ICNS resources are in build/icons. Native file dialogs follow OS appearance and source image pixels retain their original colors.

App controls retain visible keyboard focus, labels, reduced-motion behavior and distinct text/icon status. Automated contrast and fixture screenshots are separate from target screen-reader, IME and display-scaling acceptance. Native Windows/macOS and real Ubuntu/OpenSSH checks must be reported as untested when not performed.
