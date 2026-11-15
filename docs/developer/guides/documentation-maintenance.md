# Documentation Maintenance and Migration

## Ownership

Follow the MailBox documentation architecture:

```text
docs/
  README.md
  ai-agent/
    README.md
    development-rules.md
    architecture-contract.md
    implementation-handoff.md
  developer/
    README.md
    onboarding/
    architecture/
    guides/
```

Agent procedures belong in ai-agent; human explanations in developer. Developer onboarding owns initial commands/entry points; architecture owns process/data/interaction contracts; guides own setup, use, operation, testing, packaging and maintenance. History and exact upstream inputs are nested under developer/architecture. Do not create another flat numbered planning collection or duplicate competing live guides.

## Language and Scope

The user requested English documentation and this same audience-based architecture on 2026-11-15. The existing SDD method is retained. This is a documentation migration, not a new product feature or security/acceptance revision. Maintain English prose, root contribution/security guidance and issue/PR templates. The Korean product name and exact existing runtime messages may remain literal. Legal notices, actual approval quotes, failed-test records and immutable history retain original bytes/language. Translating these in place would invalidate provenance.

The [archive manifest](../architecture/history/archive-manifest.json) records source revision, original path, new archive path and SHA256 for 127 preserved files. Its snapshot root contains the old docs/design/README layout so the unchanged original validator retains its original documentation layout. Do not resolve a historical path against today's checkout and call it broken or current.

The [English contract index](../architecture/contract-index.json) maps 38 requirements,13 stages and 152 checks to the approved original digest. Structural fields, requirements-to-check links, stage dependencies, required flags, methods and untested states are unchanged. Original procedure/expected hashes bind each translated row. English wording does not create a new original approval or automatically prove semantic equivalence; review both editions when a boundary matters. The original engineering contract remains the escalation source for ambiguity; fix the English edition rather than silently changing behavior.

## Migration Work Plan

1. Preserve original approved/history/upstream files with source hashes and validate them in their original layout.
2. Write English indexes, agent rules, onboarding/product/architecture/user/operation/contribution/security/testing/package/readiness guides and the complete acceptance reading layer.
3. Update all executable consumers:installer baseline, Windows toolset/afterPack notices, exact-message unit test, CI validator and Git attributes. Do not change src, dependency versions, project license or product acceptance.
4. Validate archive bytes, original scope digest, English structured parity, active local links/anchors, maintained-language exceptions and current path consumers. Run affected type/unit/build/resource checks.
5. Use actual human commit/push/PR, independent current-head review, App approval and guarded merge/verified branch cleanup. Preserve real timestamps and remaining native/release gates.

## Updating Documents

Update both docs indexes and affected cross-links. Review setup/operation/packaging together for command/path changes and user/troubleshooting/security together for authentication/outcomes. Document actual builder names separately from planned public-release names. Never label old binaries rebuilt for a doc migration.

`scripts/validate-docs.py` validates maintained documents and the preserved original. The documentation manifest fixes active file hashes and old-to-new ownership mapping. Regenerate active hashes deliberately after approved edits; never rewrite original archive hashes to hide changes. Validator success is structural evidence, not product certification or legal advice.

The original requirement/check identities are not a new completion percentage. All152 compound acceptance rows remain untested; new documentation checks belong only to this migration. Dates and source hashes of historical tests remain unchanged.

The snapshot contains documentation, design assets and selected root entry files. Historical references to application code or evidence use the recorded source revision; those trees were not copied into this documentation snapshot. Maintained guides link current code and the original checkout evidence separately.
