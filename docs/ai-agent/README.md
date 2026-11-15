# sshOS AI Agent Guide

Last updated: 2026-11-15

Read these rules before implementation, review or documentation work. Human onboarding and operational explanations belong in `docs/developer`.

## Required Reading

1. [Development Rules](development-rules.md)
2. [Architecture Contract](architecture-contract.md)
3. [Developer Onboarding](../developer/onboarding/sshos-onboarding.md)
4. [System Architecture](../developer/architecture/system-architecture.md)
5. [Implementation Handoff](implementation-handoff.md)

## Task-Specific Reading

- Authentication or secrets: development plan sections 4–6 and 11–12, plus the security policy.
- File browsing, mutations or transfers: development plan sections 7–9 and the acceptance checklist.
- Viewers, execution or PTY: development plan sections 18–19 and desktop interaction.
- Build or dependency paths: packaging, dependency review and documentation maintenance.
- Documentation: documentation maintenance, the English contract index and the preserved-source manifest.

Links: [Development Plan](../developer/guides/development-plan.md), [Acceptance Checklist](../developer/guides/quality-security-checklist.md), [Desktop Interaction](../developer/architecture/desktop-interaction.md), [Packaging](../developer/guides/packaging.md), [Documentation Maintenance](../developer/guides/documentation-maintenance.md), [Security](../../SECURITY.md).

## Completion Rule

Inspect the existing implementation and user diff first. Run checks appropriate to the changed paths and validate documentation links. Never put credentials, file contents or terminal output in examples, diagnostics or PR attachments. Do not claim unperformed target checks passed. Maintained prose is English; exact UI literals and historical source records retain their original language.
