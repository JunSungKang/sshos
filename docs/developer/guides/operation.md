# Operation and Local Data

## Data Locations

Packaged sshOS fixes app name to `sshOS` and uses Electron's OS-default userData. Functional JSON is under `data/`, session data under `runtime/`, and crash/log paths are children of userData. One main process owns the single-instance writer. Developer launch overrides the profile into `.local/runtime/` through maintained scripts.

State JSON owns profiles, trust, encrypted secrets and settings. Separate typed receipts contain operation identity, endpoint/path and observed stages. Default diagnostics exclude those identifying strings; receipts are not anonymous. Viewers, argv and exec/PTY input/output are not intentionally persisted. OS swap/dumps and remote shell/program logs are separate.

## Work and Shutdown

A hidden/minimized internal window does not cancel accepted work. Use Tasks to inspect transfer phases or reopen retained execution output. Stop/disconnect/exit are explicit confirmed operations. TERM or local channel close is not proof every remote process stopped. The app has no silent tray mode or automatic reconnect/replay.

After suspend, resume, worker death or ambiguous dispatch, review unknown records. The engine restarts only by explicit action. Current matching files do not prove a previous request succeeded. Acknowledgement closes local restrictions without rewriting the original unknown outcome.

## Storage Faults

Before a repair, exit the app and preserve the entire existing userData, including current and backup records, using approved local backup procedures. Never edit checksums/revisions to fabricate success, delete records to hide uncertainty or replace corruption with an empty profile.

When the app reports storage fault, use its explicit recheck only after inspecting the underlying disk/access problem. Recheck waits for worker/writer settlement and file validation. New changing actions stay blocked while safe reads/existing PTY input/stop/disconnect remain available. Backup recovery can require renewed host trust; backup receipts are conservatively unknown. See [Troubleshooting](troubleshooting.md).

## Diagnostics and Updates

Default allowlisted JSONL rotates at 1 MiB×3. Preview a redacted export and select its destination explicitly; inspect again before sharing. Do not attach raw userData, private keys, terminal screens or real server details to public issues.

Updates are manual. Verify a trusted artifact's hash/signing/source correspondence; preserve data and signing identity. Publisher signing/notarization and native credential continuity remain separate release gates. There is no automatic updater or migration promise between OS accounts.
