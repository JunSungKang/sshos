# Development Packaging and Release Gates

## Build

Use the pinned Node toolchain and a clean committed tree:

```sh
node scripts/install.mjs
npm run typecheck
npm run test:unit
npm run build
npm run package:win
```

On a macOS build host, run `npm run package:mac` for arm64/x64 ZIPs. Build Windows and macOS sequentially because dist/build resources are shared. Current scripts create **development** artifacts only and do not search for or require publisher credentials. No publication is performed.

Outputs go to `.local/packages/<source-prefix>-<target>-<uuid>/`. Each includes actual executable/ZIP names, build-report.json, SHA256SUMS and a Git corresponding-source tar. Reports bind clean source revision, lock SHA256, tool versions/build host, fuses, ASAR integrity, notices, size and signature limitations. Untracked or changed source during packaging is rejected. Never commit executables, caches, dist or secrets.

Actual builder names currently include `sshOS 0.1.0.exe`,`sshOS-0.1.0-arm64-mac.zip` and `sshOS-0.1.0-mac.zip`; these are development artifacts, not a declaration that original planned public-release filenames have passed Q002. Exact per-artifact names/hashes belong to its manifest.

## Static Safeguards

Production packaging enables 6 security fuses, ASAR header/member integrity, no untracked/unpacked executable payload, test fixtures or optional native SSH accelerators. Size caps remain 250 MiB compressed/750 MiB unpacked. macOS development app is ad-hoc signed and verified deep/strict; Windows is unsigned. Neither result is publisher trust or native launch acceptance.

License preparation reads exact installed runtime licenses. afterPack replaces Electron/Chromium notices with actual target archive bytes. Windows uses the pinned NSIS/StdUtils manifest in `docs/developer/architecture/third-party`, retains original notices/corresponding source, and verifies hashes. Do not translate those upstream bytes. See [Dependency Review](dependency-review.md).

## Public Release

Public-release readiness remains false until all applicable technical acceptance, clean native launch, OS vault/accessibility/controlled performance, publisher signatures/mac notarization-stapling and supply-chain/license decisions pass. Attach AGPL text/notices/CycloneDX/lock/source/hash/build instructions. Applicable unresolved high/critical or unknown/incompatible license blocks. Usability research remains separately reported, not fabricated. No GitHub release/publishing or visibility change is authorized by a documentation update.
