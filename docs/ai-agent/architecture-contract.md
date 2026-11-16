# sshOS Architecture Contract

Last updated: 2026-11-15

## Ownership

| Path | Owns | Must not own |
| --- | --- | --- |
| `src/renderer` | Desktop, viewers, xterm, user interactions and bounded display | SSH, native filesystem/network, decryption |
| `src/preload` | Named contextBridge methods and bounded streams | Generic invoke, shell or filesystem access |
| `src/main` | Sender/capability checks, native dialogs, profiles, trust, OS vault, single JSON writer | Remote-content disk cache, terminal/argv logging |
| `src/worker` | SSH/SFTP sockets, queues, remote execution/PTY, hashing, bounded I/O and probes | Server helpers, database or management listeners |
| `src/shared` | Pure types, schemas and state models | Electron, filesystem or network imports |
| `scripts` | Development, fixture verification, license preparation and packaging | Relaxed production security or fabricated checks |
| `docs/ai-agent` | Agent procedures and invariant contracts | Human-only onboarding |
| `docs/developer` | Onboarding, architecture, usage and validation guidance | Global credentials or project-neutral skill configuration |

## Dependency Direction

```text
renderer -> named preload -> main -> utility process -> existing SSH server
main -> single JSON writer + OS encrypted secrets + native dialogs
renderer -> pure shared contracts
main/worker -> pure shared contracts
image view -> isolated renderer Web Worker -> one transferable bitmap
```

Renderer cannot import main or worker internals. Shared modules cannot acquire OS authority. Worker receipt writes must pass through the main writer's ACK barrier. Clipboard reads require a native user gesture and a frozen terminal target.

## Security and Data Invariants

- Sandboxed renderer, context isolation, Node integration disabled, offline app protocol and restrictive CSP.
- Every operation binds its serverId, sessionGeneration, backendEpoch and resource identity. Current focus never retargets existing work.
- Every SSH socket verifies host trust and uses the selected authentication method once. RSA authentication never signs SHA-1.
- Main owns local capabilities and JSON persistence. No renderer- or worker-owned state-file writer.
- No overwrite, shell fallback for file mutations, automatic permission elevation or implicit execution on file open.
- No automatic reconnect, resume, cleanup scan or replay after a timeout/crash. Preserve `result_unknown`, partial results and cleanup uncertainty.
- No automatic remote GUI, search, AI, telemetry, crash upload or updater. The product's automatic network activity is selected SSH endpoints and DNS resolution.
- GUI exec and PTY share bounded channel ownership; release reservations only after actual channel/socket closure.
- Native support, OS vault, accessibility, network/performance and signed-release acceptance cannot be inferred from local mocks or package inspection.

[System Architecture](../developer/architecture/system-architecture.md) explains flows. Development Plan (private local material) fixes algorithms and budgets. [Documentation Maintenance](../developer/guides/documentation-maintenance.md) fixes migration provenance.
