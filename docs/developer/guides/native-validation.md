# Native Target Validation

The user will perform native testing; no remote target runners or signing credentials were supplied. Preserve untested results until actual evidence exists.

## Matrix

Windows 11 x64, macOS 14 arm64 and native macOS 14 x64, each with Ubuntu 24.04LTS amd64 and arm64:6 combinations. Rosetta is not native x64 evidence. Servers use security-updated OpenSSH, ext4 and ordinary accounts; record package versions/sshd config. Use owned isolated accounts/keys/files, never production data or public-report secrets.

## Procedure

1. Preserve artifact source revision, lock hash, SHA256 and build report; verify size and source correspondence.
2. On a clean target without Node/Python/DB, launch the correct portable exe or extracted app. Record OS blocks/signatures. Current unsigned/ad-hoc development packages cannot pass publisher signing/notarization/stapling.
3. Exercise password/supported keys, first trust/changed-key refusal, OS confirmation, desktop/files/viewers, upload/download/read-back, explicit exec/PTY, window close/minimize/restore, Tasks/storage recheck, disconnect/exit/suspend-resume.
4. Add SFTP-only/chroot, denied exec/PTY, no SFTP, READ denial, unsupported hardlink, MaxSessions, read-only path, quota/full-disk and network faults. Observe server-side no automatic replay/input repetition.
5. Test actual OS vault save/decrypt/unavailability and signed-update identity continuity. Record native locking/disk/permission outcomes.
6. Measure section 14 budgets on≥8-GiB RAM, SSD, ≥4 logical CPUs; baseline 100 Mbps/RTT40 ms/loss 0,5 repeats, nearest-rank. Keep RTT500/2000/loss 1%/disconnect faults separate.
7. After60-s stabilization collect 300 one-second whole-app memory samples, including all process roles and shared-page caveat. Test disconnected/3 servers/2 transfers/10000 listing/two 1-GiB transfers with browsing/4×40-MP viewers+6 channels+12 windows/100 cycles.
8. Test1120×760/1600×1000,100/150/200% scales, keyboard/focus/modal restoration, screen reader/contrast, Korean IME/emoji, actual server vi and terminal clipboard/resize.

Each result requires the [evidence schema](testing.md). An incorrect target, wrong-server action, false completion, secret leakage or required security failure is a blocking defect. Keep local fixture/static-package evidence distinct from this matrix.
