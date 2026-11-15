# Installation and First Launch

## Packaged App

The initial client targets are Windows 11 x64 and macOS 14 arm64/x64. Choose the artifact matching your OS and CPU, verify its SHA256 against the accompanying manifest, then run the portable Windows executable or extract the macOS ZIP and open `sshOS.app`.

Packaged users do not install Node.js, Python, a database or a browser. Windows portable execution may extract internal files into a temporary directory; a macOS `.app` is a directory bundle shown as one application. User data is separate from the executable. This is not a zero-file or zero-cache promise.

Current development Windows artifacts are unsigned; macOS artifacts have ad-hoc signatures without Developer ID notarization. An OS may block launch. Record the exact block and artifact hash when testing; do not treat static integrity checks as OS trust approval or disable security system-wide. Publisher-signed public release is still pending.

## Existing Server Requirements

Use an existing Ubuntu Server 24.04 LTS amd64/arm64 account and OpenSSH endpoint. SFTP enables file features, SSH exec enables program output and PTY enables an interactive terminal. The remote account needs the permissions and programs used by the selected action. sshOS installs no server helper, interpreter or package and grants no permissions.

Verified upload finalization and same-directory file rename require hardlink support; uploads also require permission to read back the temporary file. Unsupported features fail explicitly rather than overwrite an existing destination.

## Source Checkout

Use Node 24.22.3, then run `node scripts/install.mjs`, `npm run build` and `npm start` from the repository root. Detailed checks and entry points are in [Onboarding](../onboarding/sshos-onboarding.md).

Developer scripts use `.local/` for caches and runtime data. Packaged apps use Electron's OS-default userData for app name `sshOS`; functional JSON is under `data/`, session data under `runtime/`, and crashes/logs are also child paths. Do not relocate an existing production profile by copying secrets between OS accounts; native encryption continuity needs separate testing.
