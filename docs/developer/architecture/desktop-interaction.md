# Desktop Interaction Contract

English edition of v6,2026-11-15. Desktop windows are client DOM elements, not remote graphical applications.

## 1 Geometry and Appearance

One BrowserWindow, with native confirmation/file dialogs permitted. Internal apps use React/Pointer Events/pointer capture, not per-app BrowserWindows/webviews/iframes or an extra window-manager dependency. xterm occupies only terminal content.

Main minimum 1120×760 CSS pixels; reference 1600×1000. Reserve header 44 px, transfer shelf 60 px, taskbar 56 px. Workspace is x0, y44, width=viewportWidth, height=viewportHeight−160. Launchers are below windows; header/footer cannot be covered. Maximize fills workspace, not OS fullscreen.

Minimums:Files640×360, Text/Image480×320, Output/Terminal560×320, Connections640×400, Tasks640×360, Settings560×360. Initial Files min(940, width)×min(596, height), others min(720, width)×min(440, height). Center first window, cascade next 24 px each axis then clamp. On viewport changes clamp geometry and keep complete 40-px titlebar reachable.

Colors:desktop#123C47, panel#F8FAFB, text#16313B, accent#087F78, header/taskbar#102D35. Decoration cannot violate focus/contrast/performance; native OS mimicry is not required.

## 2 State and Transitions

Model:windowId, kind, serverId|null, sessionGeneration|null, resourceId|null, bounds, restoreBounds, mode, restoreMode, focused, lastFocusedSequence. Mode normal/maximized/minimized; restoreMode normal/maximized. Preserve normal bounds and prior mode through maximize/minimize/restore. Window ID is not an SSH channel ID.

Title-only dragging excludes buttons, uses pointer capture and≤1 update per animation frame; cancel/blur ends it without selection/remote input. Resize normal windows only within minimum/workspace. Content/taskbar selection raises/focuses the window. Minimize hides content, retains taskbar and selects last visible focus. Restore retains geometry/content/scroll then clamps. Title double-click toggles max/normal, excluding title buttons.

Limits:12 total,6 file,4 viewers. Reject excess with an accessible open-window list, never silently close another. Connections/Tasks/Settings singleton. Files launcher restores last file window for selected server; New File Window is explicit. Same server/generation/canonical path/viewer kind restores existing viewer.

## 3 Server Identity

An app requiring a server opens Connections if none; one connected server is selected directly; multiple require an explicit selector before requests. Focusing a server window sets activeServerId; global windows retain it. Top selection changes only future defaults. Closing all windows retains last selected server; disconnect shows disconnected.

Title includes kind/file and server display name; details show account/endpoint/path. Never merge same names across servers. Disconnect retains last listing/viewer read-only with read time; new generation requires explicit refresh/reopen for new capabilities. No auto-terminal restoration or execution.

## 4 Launchers, Explorer and Taskbar

Desktop launchers:Connections, Files, Terminal, Settings; Start also Tasks. Single click selects, double-click/Enter launches. Single taskbar click restores/focuses, never arbitrarily minimizes an already-active window. Execution output has a distinct icon/state.

Tree/list belong to one explorer. Folder double-click/Enter navigates, regular file opens a viewer/choice; Run is a separate explicit action. No text Save. Download creates a transfer. Refresh occurs on explicit refresh/navigation or one parent reload after that window's successful GUI mutation. No watcher/cross-window polling; execution completion offers a refresh action, not automatic scan. Viewers show last-read time/manual reread.

Shelf always remains visible even under maximized/minimized internal windows, with≤2 running transfer rows, queued/failed counts and All Tasks. Taskbar owns windows; shelf owns transfers. Explorer closure does not remove accepted tasks.

## 5 Close Semantics

| Window | Effect |
| --- | --- |
| Files/Connections/Settings/Tasks | Close view/cancel its pending confirmation, keep independent sessions/tasks |
| Viewer | Cancel owned read, release buffer/bitmap/canvas, preserve shared SSH |
| Running output | Offer keep window, hide and continue, or request stop; hidden output reopens via Tasks |
| Exited output | Close view; memory ring lasts until session end or explicit record close, no disk output |
| Terminal | Confirm keep or close channel; stop local input without claiming process-tree termination |

App exit/disconnect aggregate work and confirm separately. Internal close and main-window close are not interchangeable events.

## 6 Keyboard and Accessibility

Tab traverses active controls and reaches taskbar; modal traps then restores prior valid focus. Taskbar keyboard+Enter restores the selected window. Do not intercept OS Alt/Cmd+Tab or register global shortcuts. Title-menu move/resize uses arrows 10 px, Shift+arrows 1 px, Enter commit, Esc revert.

IME composition Enter cannot double-submit execution/delete/transfer/terminal input. Terminal Ctrl+C sends remote 0x03; copy via explicit menu or mac Cmd+C/Windows Ctrl+Shift+C. Paste via menu or mac Cmd+V/Windows Ctrl+Shift+V with duplicate browser-event prevention. Other windows use ordinary copy/paste.

Use text+icons, contrast≥4.5:1, roles/labels, visible focus and action names. Default minimize/restore 150 ms; reduced-motion disables transitions and applies state immediately.

## 7 Persistence and Recovery

Do not auto-save geometry/open files/terminal contents/input to disk. Start with desktop+Connections. Main receives layout metadata with 250-ms debounce; renderer recovery uses its last snapshot and worker resource observations, without promising the final 250 ms. Restoring a window never creates a new SSH action by ID alone. Native viewport/scale/IME/recovery/keyboard tests remain acceptance, not GIF evidence.
