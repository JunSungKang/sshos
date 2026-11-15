# 배포 의존성 검토

직접 의존성은 manifest의 exact version과 lockfile로 고정한다. [기준선](../dependency-baseline-v6.json)의 초기 metadata와 설치·배포 조합 시험은 별도다. 배포 앱의 runtime npm 패키지는 MIT, BSD-3-Clause, Unlicense로 분류하고 실제 LICENSE 원문을 보관한다. 선택적 cpu-features·nan·buildcheck와 sshcrypto.node, Pageant helper는 배포에서 제외한다. Electron의 대상별 MIT 원문과 Chromium을 포함한 전체 고지 원문은 afterPack에서 실제 대상 archive의 파일로 교체한다.

패키지의 `resources/licenses/sbom.cdx.json`에는 runtime npm 패키지와 Electron의 고정 버전을 기록한다. Electron 내부 구성요소의 개별 조건은 `electron-third-party.txt` 원문에 남긴다. Windows portable launcher와 빌드 도구의 별도 고지·의무 검토도 출시 전에 완료해야 한다. runtime inventory를 모든 바이너리 구성요소의 법률 검토 완료로 해석하지 않는다.

## 현재 보안 경고

보존한 npm audit 결과는 moderate6개, high0개, critical0개다. 경고는 minimatch와 이를 사용하는 electron-builder 계열의 빌드 의존성에 속한다. [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)는 영향 범위를7.0.0 이상11.0.1 미만으로 명시하며 optimizationLevel2 이상에서 공격자 입력 pattern의 증폭을 설명한다.

현재 app-builder-lib의 FileMatcher는 저장소 설정의 고정 glob과 `{dot:true}`를 사용하며, 설치된 minimatch의 기본 optimizationLevel은1이다. 이 코드 경로와 ASAR의 배포 의존성 목록에서 서버·파일명·프로필 입력이 minimatch로 전달되는 경로는 확인하지 못했다. 이는 현재 경로에 대한 구현자 분석이며, 영향 버전이 수정됐거나 독립 검토를 통과했다는 뜻은 아니다. 경고는 DEP-001로 유지한다.

minimatch11은 makeRe·AST 등 기존 API를 제거하므로 major override나 audit가 제안하는 빌드 도구 downgrade를 자동 적용하지 않는다. 고정 버전 변경은 사용하는 API, 파일 제외·ASAR·세 target 패키징·라이선스의 회귀 범위를 확인한 뒤 기록한다. 직접 의존성 exact version과 승인 기준을 무단으로 완화하지 않는다.


## Windows launcher toolset

The initial electron-builder default selected legacy NSIS3.04. CVE-2025-43715 concerns temporary plug-in directory races before3.11;3.12 contains a further elevated-temp protection fix. The project pins the supported toolset1.2.1, whose vendor archive is nsis-bundle-3.12.tar.gz with SHA25656997fdefe25e7928a1a68b4583d08b240b66cf660234053b20131a74cc082f4. The Mac compiler reports v23-May-2026.cvs rather than v3.12; this exact vendor build string is recorded alongside the pinned artifact, never relabeled as a different native measurement. Windows builds still require native validation.

portable.useZip=true makes electron-builder26.18 embed app files with the built-in NSIS zlib compressor. The selected template branch does not use Nsis7z or nsisunz. This trades the former7z payload for a simpler launcher dependency set; final size and actual extraction/start time must still be measured. No app protocol or direct dependency version changes.

The StdUtils Unicode DLL in toolsets0.0.0 and1.2.1 is byte-for-byte identical to the author's official1.14 release (PE fileVersion1.1.4.0), SHA256b72e9013a6204e9f01076dc38dabbf30870d44dfc66962adbf73619d4331601e. The original LGPL2.1-or-later text, author's clarification, copyright, BLAKE2 CC0/RHash notices and the complete official corresponding-source archive are preserved under docs/third-party. Windows afterPack includes them and the source in resources/licenses and resources/third-party-source, and adds NSIS/StdUtils to the CycloneDX inventory. The DLL remains unmodified. Source and notice hashes are verified before packaging.

Primary sources: [NSIS release notes](https://nsis.sourceforge.io/Docs/AppendixF.html#v3.11-rl), [toolset release and checksum](https://github.com/electron-userland/electron-builder-binaries/releases/tag/nsis%401.2.1), [StdUtils1.14](https://github.com/lordmulder/stdutils/releases/tag/1.14), [author's license clarification](https://nsis.sourceforge.io/StdUtils_plug-in#License). The exact archived notices and manifest are the build inputs; this review does not waive remaining native/security gates.
