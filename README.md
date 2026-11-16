# sshOS

sshOS (Korean name: 시오스) is an Electron desktop client for working with Linux servers over existing SSH connections. Browse, inspect and transfer files, run an explicitly selected remote program, and use a remote terminal in one desktop workspace.

The desktop, overlapping windows and taskbar belong to the client. Remote graphical applications and server desktop streaming are outside the product scope. No sshOS server agent, application database, central service or additional server runtime is required.

## Project status

Version 0.1.0 is a development build. Application features, local automated checks and development packages have been implemented. Supported-platform acceptance, publisher signing/notarization and usability studies remain incomplete; public-release readiness is **false**. See release readiness (private local material) for dated evidence and limitations.

| Component | Initial target |
| --- | --- |
| Windows client | Windows 11 x64, portable executable |
| macOS client | macOS 14, separate arm64 and x64 application bundles |
| Linux server | Ubuntu Server 24.04 LTS, amd64 or arm64, existing OpenSSH |
| Feature permissions | SFTP for files; SSH exec for program output; SSH PTY for an interactive terminal |

A target in this table is an acceptance target, not a claim that native testing has passed. SFTP, exec and PTY permissions are independent.

## What it does

- Desktop launchers, movable/resizable internal windows, taskbar and persistent transfer shelf.
- Password or supported private-key authentication, explicit host-key trust and per-server session identity.
- One file explorer with tree and list, manual refresh, read-only UTF-8 text and static PNG/JPEG/WebP viewers.
- Asynchronous upload/download with separate transfer and verification progress, full SHA-256 read-back and exclusive destination creation.
- Explicit remote execution with stdout/stderr and observed exit information, plus an SSH PTY terminal for interactive programs such as an already-installed `vi`.
- Active-server connection state and SSH command-completion response time; settings, redacted diagnostics and offline license notices.

The first version excludes GUI editing, overwriting, recursive file operations, automatic reconnect/replay, filesystem watchers, remote GUI/X11, AI, online error search, telemetry and automatic updates. Terminal commands execute with the remote account's existing authority; GUI file safeguards cannot constrain commands or other users.

## Run a development package

Windows: run the portable `.exe`. macOS: extract the ZIP for your CPU and open `sshOS.app`. Packaged users do not install Node.js, Python or a database. Current development Windows packages are unsigned and macOS packages are ad-hoc signed; see [installation](docs/developer/guides/installation.md) before testing.

Development package handoff (private local material) identifies the existing artifact source revision and hash manifest. A checkout does not contain generated binaries, and historical artifact evidence is not a new release.

## Develop from source

Use **Node.js 24.22.3** and run these commands from the repository root:

```sh
node scripts/install.mjs
npm run typecheck
npm run test:unit
npm run build
npm start
```

The installer and launch scripts keep dependency caches and development runtime data under `.local/`. `npm start` launches the built desktop app. See [developer onboarding](docs/developer/onboarding/sshos-onboarding.md) for prerequisites, verification and packaging.

## Documentation and contributions

Start at the [documentation index](docs/README.md). Human developer material is under `docs/developer`; AI agent procedures are under `docs/ai-agent`.

- [User guide](docs/developer/guides/user-guide.md)
- [System architecture](docs/developer/architecture/system-architecture.md)
- [Testing and acceptance](docs/developer/guides/testing.md)
- [Contributing](CONTRIBUTING.md) and [security reporting](SECURITY.md)

Project code is licensed under **AGPL-3.0-only**; read [LICENSE](LICENSE). Third-party components retain their own licenses and notices; see [NOTICE](NOTICE). Contributions must be compatible with the project license. Repository documentation is maintained in English; the application UI language is unchanged.
