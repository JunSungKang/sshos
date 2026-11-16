# Contributing to sshOS

Thank you for helping improve a client-only SSH desktop. Start with the [documentation index](docs/README.md),[onboarding](docs/developer/onboarding/sshos-onboarding.md),product plan (private local material) and [architecture](docs/developer/architecture/system-architecture.md).

## Development

Use Node 24.22.3. From the repository root:

```sh
node scripts/install.mjs
npm run typecheck
npm run test:unit
npm run build
npm start
```

Developer caches/runtime stay under `.local/`. Do not commit credentials, private keys, real endpoints, user files, terminal content, node_modules, dist or generated packages. Packaged users need no developer runtime or DB.

## Propose a Change

For a bug, include app/source/artifact version, OS/CPU, an isolated reproduction, expected/actual outcome and redacted fixed error codes. Keep failures and retests honest. Report sensitive issues using [SECURITY](SECURITY.md), not a public exploit or real server dump.

For a feature, identify the user task, affected R/check IDs, tradeoffs and exclusions. Changes to support targets, security or acceptance need an explicit impact/version decision. Do not add a server agent/DB/remote GUI/AI/search/updater/automatic replay as a convenient workaround.

## Validate and Document

Run affected tests and `python3 -B scripts/validate-docs.py --root .`, then `git diff --check`. Preserve90% statement/85% branch per-file gates and meaningful fault checks. Do not lower thresholds or exclude failing code. See [Testing](docs/developer/guides/testing.md) for integration/security/native conditions and the deliberate partial-performance exit 2.

Write maintained docs, README files and release notes in English. Keep exact UI literals, upstream legal bytes and historical evidence intact. Update the audience indexes and actual command/path consumers. UI translation is a separate product change.

## Pull Requests and Licensing

Describe the concrete problem/result, scope, checks and untested limits. Maintainers integrate through repository-owned human author/assignee roles, independent exact-head review, App formal approval and human merge with verified head-branch cleanup. External contribution proposals do not bypass the maintainers' protected-branch integration policy; maintainers can prepare a compliant integration PR while retaining attribution. Every push needs current-head review again.

Submit contributions compatible with [AGPL-3.0-only](LICENSE). Include provenance and original terms for copied code/assets; do not claim project licensing overrides upstream terms. No new CLA, DCO or ownership transfer is introduced by this guide.
