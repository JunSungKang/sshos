# sshOS Agent Instructions

Use `sshOS` for the English product name and `sshos` for machine identifiers. The Korean product name is `시오스`.

- Read the required documents in [the AI agent guide](docs/ai-agent/README.md) before changing code or documentation.
- Put agent work rules and architecture invariants in `docs/ai-agent`.
- Put human developer material in `docs/developer/onboarding`, `docs/developer/architecture` or `docs/developer/guides` and update both indexes.
- Write maintained documentation, README files, contribution guidance, issue/PR templates and release notes in English. Preserve quoted runtime UI strings, legal notices and immutable historical evidence verbatim. This does not authorize UI translation.
- Preserve the approved v6 scope and all acceptance thresholds. The byte-preserved original and the English edition are connected by the documentation migration manifest. Translation and relocation do not pass a product test or approve a new feature.
- Keep application data in JSON and OS-encrypted secrets. Do not introduce a server agent, database, remote GUI, AI/search, telemetry, automatic update, reconnect or execution replay.
- Use existing repository governance for tracked writes. Contracts and temporary evidence belong in ignored workspace-local `.local/`; never publish credentials or global credential mappings.
- Do not commit `.local/`, `node_modules/`, `dist/`, generated executables, user files, private keys, passwords, tokens or terminal content.
- Inspect user changes before editing. Resolve every task output path inside the authorized workspace; preserve unrelated and pre-existing artifacts.
- Before completion run the checks required by the affected code, `python3 -B scripts/validate-docs.py --root .`, and `git diff --check`. Report missing target tests explicitly.
