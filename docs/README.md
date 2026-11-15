# sshOS Documentation

Last updated: 2026-11-15

Documentation is organized by audience and purpose, following the same directory architecture as MailBox. Write maintained documentation in English and update this index when adding a page.

## AI Agent

- [AI Agent Guide](ai-agent/README.md): required reading and task-specific references.
- [Development Rules](ai-agent/development-rules.md): change procedure, security and evidence invariants.
- [Architecture Contract](ai-agent/architecture-contract.md): process ownership and allowed dependencies.
- [Implementation Handoff](ai-agent/implementation-handoff.md): applying the approved scope without inventing features or test results.

## Developer

- [Developer Guide](developer/README.md): recommended reading order.
- [sshOS Onboarding](developer/onboarding/sshos-onboarding.md): stack, commands and code entry points.
- [System Architecture](developer/architecture/system-architecture.md): process boundaries, SSH roles and data flows.
- [Product Plan](developer/guides/product-plan.md) and [Development Plan](developer/guides/development-plan.md): scope and precise engineering contracts.
- [Desktop Interaction](developer/architecture/desktop-interaction.md): window, focus and server identity rules.
- [Requirements and Implementation](developer/architecture/requirement-traceability.md): requirement IDs, actual code and evidence limits.
- [Installation](developer/guides/installation.md), [User Guide](developer/guides/user-guide.md), [Operation](developer/guides/operation.md) and [Troubleshooting](developer/guides/troubleshooting.md).
- [Testing](developer/guides/testing.md), [Acceptance Checklist](developer/guides/quality-security-checklist.md) and [Native Validation](developer/guides/native-validation.md).
- [Development Packages](developer/guides/packaging.md), [Artifact Handoff](developer/guides/development-handoff.md) and [Release Readiness](developer/guides/release-readiness.md).
- [Dependency Review](developer/guides/dependency-review.md), [Research and Positioning](developer/guides/research-and-positioning.md), [Framework Decision](developer/architecture/framework-decision.md) and [Usability Evaluation](developer/guides/usability-evaluation.md).
- [Documentation Maintenance](developer/guides/documentation-maintenance.md): ownership, migration and validation.
- [Historical Sources](developer/architecture/history/README.md): original approvals, decisions and dated implementation records.

## Update Rules

- Update `docs/ai-agent` when work procedures or architecture invariants change.
- Update developer onboarding and architecture when module responsibilities, boundaries or main entry points change.
- Review installation, operations and packaging together when paths, build commands or runtime requirements change.
- Review the user guide, troubleshooting and security policy together when authentication or outcome handling changes.
- Keep product acceptance separate from unit tests, loopback integration, static package checks and public-release approval.
- Preserve the original dates, source revisions, measurements and limitations of historical evidence. Translation and relocation do not rerun tests.
