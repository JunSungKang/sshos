# Testing and Evidence

## Available Checks

Run from the repository root after installation:

```sh
python3 -B scripts/validate-docs.py --root .
npm run typecheck
npm run test:unit
npm run test:coverage
npm run build
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:performance
```

Select affected checks rather than treating every command as required for every prose change. Integration/security/e2e launch real Electron and loopback SSH fixtures, require a usable desktop session, and should not run concurrently when focus matters. Reports identify source hashes and adapters replacing native dialogs/vault/focus. Scripts reject source changes during measurement.

Unit coverage enforces per-file statement 90%/branch 85% for configured modules. Preserve documented actual-process entrypoint verification; do not add exclusions or lower thresholds to pass. Meaningful boundary/state/fault behavior matters beyond percentages.

`test:performance` measures actual local registration, warm Electron launch and trusted UI clicks. Successful partial measurement deliberately exits 2 when target acceptance remains untested; do not relabel 2 as target pass. One working-set snapshot is not a settled 300-sample p95. Isolated loopback fixtures do not require a real TEST_HOST; this actual implementation is distinct from the original plan's external-target environment check. Missing real target access never passes native acceptance.

## Product Acceptance

The [checklist](quality-security-checklist.md) has 152 rows:149 technical-required and 3 nonblocking research rows. All remain untested as compound product criteria. Dated553-unit/17-integration/61-security results are separate evidence, not 152 passed acceptance rows.

Use [Native Validation](native-validation.md) for the six client/server combinations and section 14 of the [Development Plan](development-plan.md) for hardware, network, repetitions, resource budgets, IME/accessibility and signed-package conditions. Do not exercise fault fixtures on user servers.

For each executed row record checkId, status, binary SHA256, source revision, app version, client/server OS/CPU/OpenSSH, fixture settings, procedure, expected/actual, evidence and defectId. Keep failures and retests separately. Screenshots cannot prove byte integrity, host trust, egress or native signatures.

## Documentation Checks

The documentation validator checks the MailBox-style audience architecture, active links, English-contract structural parity, archive hashes and original v6 validator output. It does not certify English semantic equivalence, legal compliance, quality or native behavior; independent review supplies the translation/migration cross-check.
