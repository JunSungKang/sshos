# Dependency and Supply Chain Review

This is an English reading of the dated 2026-11-15 review, not a new security scan. Exact active dependencies belong to package.json/package-lock.json; the [initial baseline](../architecture/dependency-baseline-v6.json) retains original metadata and untested design observations.

## Distribution Inputs

Runtime npm licenses were classified as MIT, BSD-3-Clause or Unlicense and original notices are preserved. Optional cpu-features/nan/buildcheck, sshcrypto.node and Pageant helpers are excluded from production artifacts. afterPack uses actual target Electron MIT/Chromium notices rather than the host's notice as a substitute. The local settings viewer displays notices as plain text.

The CycloneDX inventory records runtime npm and Electron components. Detailed bundled Electron terms remain in its original third-party text; this is not a claim of complete legal review for every binary, codec, asset or launcher. Preserve the project AGPL text, upstream notices, source/lock/version correspondence and actual distribution obligations.

## Retained Audit Findings

The recorded audit has 6 moderate build-tool findings, high 0 and critical 0. DEP-001 remains open for minimatch/electron-builder-related dependencies. The original review inspected fixed repository globs/default optimization level and found no demonstrated remote-input runtime path; that is a bounded implementation analysis, not a fixed-version claim or waiver.

Do not blindly apply a minimatch major override or builder downgrade. Reassess consumed APIs, glob exclusions, ASAR, three-target packaging and licensing before an exact-version change. A new audit requires a new dated record. Applicable unresolved high/critical, unknown/incompatible license or failed required check blocks public release.

## Windows Launcher

Pin toolset 1.2.1/vendor NSIS 3.12 archive SHA256 `56997fdefe25e7928a1a68b4583d08b240b66cf660234053b20131a74cc082f4`. The Mac compiler's observed string is `v23-May-2026.cvs`; record it literally, not as a fabricated native version result. portable.useZip uses direct app files and built-in zlib rather than Nsis7z/nsisunz.

StdUtils 1.14 DLL SHA256 is `b72e9013a6204e9f01076dc38dabbf30870d44dfc66962adbf73619d4331601e`, matching the reviewed upstream release. Preserve unmodified LGPL-2.1-or-later text, author clarification, copyright, BLAKE2/RHash notices and complete corresponding source. The [launcher manifest](../architecture/third-party/windows-launcher-manifest.json) fixes all input hashes. Windows resources include notices/source and inventory entries; native launcher security/startup still needs acceptance.

The original review (private local material) retains full observed source paths and primary-source links. Translation does not renew that assessment. Do not edit upstream legal bytes during documentation changes.
