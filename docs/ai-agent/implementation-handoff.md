# sshOS Implementation Handoff

Use the approved v6 scope and its English edition. The project has implementation and local verification evidence; old statements that implementation had not started describe the archived planning date only.

## Work Procedure

1. Read product scope, development contracts, desktop interaction and the mapped acceptance rows.
2. Locate the implementation and tests for affected R IDs; do not infer current paths from originally planned P artifacts.
3. Identify the observed defect or requested behavior, permitted paths, regression checks and uncertainty boundary.
4. Implement within the existing process/capability architecture. Do not add excluded features, placeholder menus or future network permissions.
5. Verify behavior with isolated fixtures and preserve failure evidence. A missing environment is untested, not pass or an accepted skip.
6. Update English user/developer guidance, requirement traceability and actual verification records.
7. Use guarded human commit/push/PR, independent exact-head review, App formal approval and human merge with verified branch cleanup.

## Fixed Contracts

The response probe's literal `/bin/true` restriction applies only to response measurement. GUI execution accepts confirmed file/mode/argv inputs; PTY accepts explicit interactive user input. File opening never executes a program.

Keep persistence ACK before side effects, full read-back before exclusive destination creation, no overwrite, conservative unknown outcomes and no automatic replay. Separate local close, observed exit, remote business outcome and daemon/child-process lifetime.

Product acceptance remains 152 untested compound rows, including 149 required technical rows and 3 nonblocking research rows. Local automated tests and historical package evidence do not change those states. See [release readiness](../developer/guides/release-readiness.md).
