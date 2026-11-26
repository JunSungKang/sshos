# sshOS Architecture Contract

Last updated: 2026-11-17

## Ownership

| Path | Owns | Must not own |
| --- | --- | --- |
| `src/renderer` | Desktop, viewers, xterm, user interactions and bounded display | SSH, native filesystem/network, decryption |
| `src/preload` | Named contextBridge methods and bounded streams | Generic invoke, shell or filesystem access |
| `src/main` | Sender/capability checks, native dialogs, profiles, trust, OS vault, single JSON writer | Remote-content disk cache, terminal/argv logging |
| `src/worker` | SSH/SFTP sockets, queues, remote execution/PTY, hashing, bounded I/O and probes | Server helpers, database or management listeners |
| `src/platform/local-files` | Native selected-file inspection shared by main and worker | SSH or renderer authority |
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

Renderer cannot import main or worker internals. Main must not import worker internals. Shared policies and DTOs cannot acquire OS authority; platform modules own native file inspection. Worker receipt writes must pass through the main writer's ACK barrier. Clipboard reads require a native user gesture and a frozen terminal target.

## Security and Data Invariants

- Sandboxed renderer, context isolation, Node integration disabled, offline app protocol and restrictive CSP.
- Every operation binds its serverId, sessionGeneration, backendEpoch and resource identity. Current focus never retargets existing work.
- Every SSH socket verifies host trust and uses the selected authentication method once. RSA authentication never signs SHA-1.
- Main owns local capabilities and JSON persistence. No renderer- or worker-owned state-file writer.
- Ordinary file mutations and transfers never overwrite. Explicit text Save alone may replace its bound regular UTF-8 file using durable intent, a verified same-directory temporary file, optimistic content/stat conflict checks and OpenSSH POSIX rename. Desktop metadata and confirmed mkdir/delete/rename use fixed Ubuntu SSH command templates on serialized control channels. No generic renderer command API, automatic permission elevation, SFTP fallback for Desktop queries or implicit program execution on file open. Text Save and transfers retain their SFTP integrity protocols. SFTP does not provide atomic compare-and-swap against external writers.
- A confirmed server copy may stage one regular file under a private, job-owned local directory. Preserve the parent receipt, both endpoint identities, the verified source digest, disk reservation and cleanup evidence across the two legs. The destination's final name uses exclusive publication. Local removal requires proven ownership.
- A native text-file drop grants access to the selected file for the captured gesture. Desktop insertion modifies only the draft. The Console always requires a send confirmation bound to the original terminal. Remote HTML receives no local drop or file-picker capability.
- No automatic reconnect, resume, cleanup scan or replay after a timeout/crash. Preserve `result_unknown`, partial results and cleanup uncertainty.
- No automatic remote GUI, search, AI, telemetry, crash upload or updater. The product's automatic network activity is selected SSH endpoints and DNS resolution.
- GUI exec and PTY share bounded channel ownership; release reservations only after actual channel/socket closure.
- Web previews use a separate nonpersistent session and sandboxed WebContentsView without preload, Node, external network, service workers or permission grants. Default JavaScript is off; explicit per-preview configuration can enable it. Only named root-scoped SFTP resources are served, with 20 MiB per response, 64 MiB/512 requests per load and two active reads globally. Native view visibility follows Desktop focus, overlays and bounds.
- Native support, OS vault, accessibility, network/performance and signed-release acceptance cannot be inferred from local mocks or package inspection.

[System Architecture](../developer/architecture/system-architecture.md) explains flows. Development Plan (private local material) fixes algorithms and budgets. [Documentation Maintenance](../developer/guides/documentation-maintenance.md) fixes migration provenance.
