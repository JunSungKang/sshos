# sshOS Agent Development Rules

Last updated: 2026-11-15

## Required Pre-Work

1. Check the working tree, branch and canonical `origin`; preserve user changes.
2. Read the agent architecture contract and task-specific developer guides.
3. Locate actual callers, schemas, tests and build scripts with `rg`.
4. Reuse the approved SDD scope. A documentation migration does not authorize feature, security or acceptance changes.
5. Use repository-governed human commits/pushes/PRs, independent current-head review, App formal approval and human merge. Keep local workflow contracts under ignored `.local/`.

## Implementation Invariants

- One Electron main window; React DOM internal windows; one SSH utility process. Do not create an HTTP/WebSocket management service.
- Keep named preload APIs, strict schemas, sender validation, resource capabilities and generation/epoch identity. No generic local exec/fs/net bridge.
- Verify the pinned host key on every control, transfer and execution socket before authentication. Do not fall back to another authentication method.
- Persist intent before remote mutation or exec/PTY creation. Treat dispatch uncertainty conservatively and never replay a previous operation automatically.
- Preserve read-back verification, exclusive hardlink finalization, file/path locks and finalization cancellation barriers for existing mutations/transfers. Explicit text Save is a separate authorized replacement: bind the completed read digest and viewer generation, durably record intent before temporary creation/publication, verify content and POSIX owner/mode, use the advertised OpenSSH POSIX rename extension only, and retain uncertain outcomes without replay. No draft text belongs in JSON records or logs.
- A window, SSH channel, SSH socket and remote process have separate lifetimes. A local close is not proof of remote termination.
- Profile identity/auth changes and deletion must remain blocked by live connections or unresolved work; recheck inside serialized writes and reserve new authentication through storage ACK.
- Historical logs and receipts are not anonymous. Do not copy endpoint/path information into default diagnostics.

## Logging and Secrets

Use the existing fixed-code, allowlisted diagnostic schema. Do not adopt MailBox's server audit fields: sshOS must not add usernames, IPs, paths, request bodies or user agents to default logs. Never record passwords, keys, passphrases, terminal input/output, file contents, argv, raw SSH debug or command hashes. Preserve OS encryption and secret ownership checks; do not add plaintext fallback.

## Validation

```sh
python3 -B scripts/validate-docs.py --root .
npm run typecheck
npm run test:unit
npm run build
git diff --check
```

Select additional integration/security/coverage/package checks for the affected behavior. Do not rerun unrelated GUI suites concurrently. Per-file coverage gates remain statement 90% and branch 85%. Missing native targets remain untested. `test:performance` intentionally returns 2 after successful partial local measurements when target acceptance remains untested.

## Documentation

Maintain English prose and the audience-based indexes. Preserve literal runtime UI messages and legal notices. Never edit byte-preserved history to make a validator pass. Keep dates/source hashes and distinguish original requirements from later evidence. Update every executable path consumer when moving a documentation input.
