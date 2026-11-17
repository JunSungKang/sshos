# sshOS Developer Onboarding

Last updated: 2026-11-15

sshOS is a client-only desktop workspace over existing SSH. Electron renders a React desktop; a utility process owns SSH/SFTP; main owns capabilities, OS secrets and atomic JSON records. There is no sshOS server component or application database.

## Stack and Directories

The current manifest pins Node 24.22.3 for development, Electron 45.3.4, React 19.3.1, TypeScript 7.0.2, Vite 8.3.8, ssh2 1.17.0, xterm 6.0.0 and addon-fit 0.11.0. Electron 45.3.4 embeds Node 24.22.3 and Chromium 156.0.8078.100. See `package.json` and `package-lock.json` for exact dependency versions.

- `src/main/index.ts`: pre-ready policy, paths, process composition and lifecycle.
- `src/preload/index.ts`: named renderer bridge.
- `src/renderer/features/desktop/DesktopShell.tsx`: desktop, internal windows and taskbar.
- `src/worker/index.ts`: utility-process command dispatch and SSH operations.
- `src/shared`: pure schemas, states, budgets and cross-process file policies.
- `src/platform/local-files`: native file selection inspection; main never imports worker internals.
- `src/worker/remote-files/metadata`: fixed Ubuntu SSH commands and response parsing.
- `src/main/web-preview`: isolated Chromium sessions, root-scoped SFTP resources and view geometry.
- `tests/unit`: unit/state/boundary tests; `scripts/*-smoke.mjs`: actual-process fixture scenarios.
- `scripts/install.mjs`, `launch.mjs`, `verify.mjs`, `package.mjs`: setup, launch, verification and development artifacts.
- `docs/ai-agent`: procedures; `docs/developer`: human documentation; `evidence`: immutable dated reports; `.local`: ignored caches/runtime/artifacts.

## First Run

Install Node 24.22.3 using your normal development setup. From the repository root:

```sh
node scripts/install.mjs
npm run typecheck
npm run test:unit
npm run build
npm start
```

`node scripts/install.mjs` runs the lockfile installation and Electron download with workspace-local caches. `npm start` uses the built `dist` tree and the workspace-local development profile. Rebuild after source changes. Do not run the raw Electron binary with default home-directory development data paths.

## Verification and Packaging

```sh
python3 -B scripts/validate-docs.py --root .
npm run test:coverage
npm run test:integration
npm run test:security
npm run test:performance
```

Integration/security scenarios launch real Electron and loopback SSH fixtures. They require a usable desktop session; adapters replacing native dialogs/vault/focus are documented. Successful partial performance returns 2 because target acceptance is still untested. See [Testing](../guides/testing.md).

From a clean committed tree, use `npm run package:win` or, on a macOS build host, `npm run package:mac`. Current commands create development artifacts, not publisher-signed releases. See [Packaging](../guides/packaging.md) and Release Readiness (private local material).
