# sshOS Developer Guide

Last updated: 2026-11-15

This area explains product behavior, implementation boundaries, local development and verification. Agent work rules belong in `docs/ai-agent`.

## Recommended Reading Order

1. [sshOS Onboarding](onboarding/sshos-onboarding.md)
3. [System Architecture](architecture/system-architecture.md)
4. [Installation](guides/installation.md) and [User Guide](guides/user-guide.md)
7. [Packaging](guides/packaging.md), [Operation](guides/operation.md) and [Troubleshooting](guides/troubleshooting.md)

## Developer Checklist

- Identify whether a change belongs to renderer, preload, main, shared contracts, worker or build tooling before editing.
- Keep SSH authority and local file capabilities out of the renderer.
- Preserve durable intent/ACK ordering, no-overwrite finalization and uncertainty after timeouts or lost acknowledgements.
- Use isolated fixtures. Native support and security claims require evidence from the specified targets.
- Keep code, English guides and executable documentation consumers consistent.
- Follow [Documentation Maintenance](guides/documentation-maintenance.md) when relocating or translating a contract.
