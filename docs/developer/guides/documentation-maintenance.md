# Documentation Maintenance

Public documentation follows the MailBox audience structure: docs/ai-agent for agent work rules; docs/developer/onboarding for setup; docs/developer/architecture for implemented architecture and upstream legal resources; docs/developer/guides for usage, operation, testing and packaging.

Keep product plans, development plans, sprint documents, machine-readable implementation specifications, acceptance planning, decision logs and historical planning archives local and ignored. Never stage them, include their contents in PR bodies, or require them for a public clone to install, build or test. Local execution records belong under .local. User documentation describes observable implemented behavior, not upcoming sprint scope.

Write maintained prose in English. Preserve the Korean product name, exact runtime strings and upstream legal notices. Update public indexes and links when changing public guidance. Run `python3 -B scripts/validate-docs.py --root .` and `git diff --check`; the documentation validator rejects tracked private planning paths and public links to private plans. It does not approve a product or certify native-platform acceptance.

Retain the existing SSH/security and data-integrity contracts while updating UI guidance. Keep fixture results separate from native OS, actual Ubuntu/OpenSSH, signing and release acceptance. Never change an unperformed check to passed.
