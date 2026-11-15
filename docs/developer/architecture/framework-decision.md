# Electron Framework Decision

This preserves the selected design tradeoff from the 2026-11-15 comparison. It is not a current benchmark or an experimentally measured error-rate ranking.

Electron bundles Chromium/Node so the UI engine and TypeScript/ssh2 integration are controlled together. Chromium renders the entire desktop, viewers and terminal UI; it is actively used even though SSH owns network work. Its size/multiprocess/memory/update cost remains real. No hidden browsing/search/AI is added to justify that cost.

Tauri can implement a similar DOM desktop and SSH/PTY workflow with a Rust backend and OS WebViews. The recorded tradeoff is smaller bundled-runtime opportunity versus WebView/runtime/platform variation and a different SSH integration stack. Neither framework choice automatically solves server identity, IPC authority, IME/output backpressure or ambiguous remote outcomes. Do not describe Tauri as necessarily single-process, macOS-untestable or higher-error without evidence.

For sshOS, the chosen stack is Electron+React/TypeScript+named preload+main+utilityProcess ssh2. Internal windows use React/Pointer Events; remote PTY uses ssh2+xterm/addon-fit, without local node-pty or management WebSocket server. Optional native dependencies are inspected/excluded at packaging rather than declaring all transitive dependencies pure JavaScript.

The [original comparison](history/pre-english-20261115/docs/05-framework-comparison.md) retains dated primary references. Actual package/IME/focus/security/native results belong to [Testing](../guides/testing.md) and [Release Readiness](../guides/release-readiness.md). No same-product Electron-versus-Tauri performance, error-rate or preference experiment was performed.
