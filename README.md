# English in Practice

Offline React Native English study for Android: vocabulary and spelling, spaced review,
22 Use of English formats, mistake notebook, notes, incremental JSON import and backup.
The bundle contains 131,008 reference headwords, 40 curated meanings and 70 original tasks.
Original practice is not official IELTS past-paper material.

## Download an Android APK

Open [GitHub Releases](https://github.com/WartDipara/Lng/releases) and download
**English-in-Practice.apk** directly from a version's Assets. The verification report and
SHA256SUMS.txt are attached alongside it. These downloads do not have the Actions artifact
retention limit. A successful `v*` tag build publishes its version automatically.

For a manual test build, open **Actions → Build Android APK → Run workflow**. After success,
download `English-in-Practice-android-<run number>` under **Artifacts**, extract it and install
the APK. Manual builds only upload Actions artifacts, retained for 30 days.

For a new app release, keep `package.json` and `app.json` versions equal, increase
`expo.android.versionCode`, commit the changes, then push a matching tag:

```sh
git tag v1.0.1
git push origin v1.0.1
```

A tag must equal `v` plus the app version. Content-only updates can be imported as JSON
without publishing a new app. A Release is published only after the complete build job
succeeds and the downloaded APK checksum is verified. Failed uploads remain drafts and
can be retried; rerunning an already published version preserves its existing downloads.
Pre-release versions (such as `1.1.0-beta.1`) are marked as pre-releases. No app-store upload occurs.

## Keep your progress when updating

Download the newer APK from Releases and install it over the current app; do not uninstall.
Android requires the same application ID (`com.engdictionary.practice`) and signing key.
Increase versionCode for every release. The build checks the existing signing certificate.
Private local files survive an in-place update. Uninstalling or clearing app storage removes them.
Use Profile → Library & backups to export before changing devices or uninstalling, then import
that backup to restore your local identity, drafts, results, notes and imported packs.
New optional progress fields migrate old saves without replacing their study history.
An old app version may not understand a backup produced by a newer version; keep the newer app.

Practice sets contain 1–50 randomly selected, non-repeating questions from the current filter.
Answers are saved as drafts; grading is performed once when the full set is submitted.
Accuracy is fully correct questions / all set questions, including skipped questions.
Question snapshots preserve historical results across future content updates.

## Build locally

```sh
npm ci
npm run build
```

Windows prerequisites: Node 24+, Python 3.11+, JDK 17 (`JAVA_HOME`), Android SDK
(`ANDROID_HOME`, default `.local/android-sdk`) with platform `android-37.0`, build-tools
37.0.0, NDK 27.1.12297006 and CMake 3.30.5/3.22.1.
Restore your existing signing key to `android/app/debug.keystore` first. APK output:
`output/English-in-Practice.apk`. Logs and versioned copies: `output/builds/`.
Use `npm run build -- -Offline` with cached dependencies, or `-Workers 2` to limit parallelism.
The command validates content, typechecks, tests, builds and verifies signatures/assets.
It does not run device tests. Android APK is the supported installation and release format.

## Signing and repository contents

CI requires repository Actions secret **ANDROID_KEYSTORE_BASE64**, the base64 bytes of the
existing personal-use Android keystore. Keep the same key for installation updates. The
workflow restores it temporarily and removes it after building; keys are never committed.
The current personal-use key uses Android's debug alias/password; store publishing needs
its own signing configuration. Do not replace the key for an existing installation.

Only source, schemas, small test fixtures, necessary tests/build scripts and attributed
content are tracked. SDKs, dependencies, generated native projects/assets, APKs, caches,
local development documents and keys stay ignored. `data/vocabulary.json.gz` is the single
compressed dictionary source; `npm run prepare:mobile` regenerates its JSON and bundled
shards. After editing the local master JSON, run `npm run archive:data` before committing.
Source attribution and license notices remain in `data/notices/` and the content metadata.

For development: `npm run prepare:mobile`, then `npm start`. Content schemas are under
`schemas/`; `examples/base.pack.json` and `examples/increment.pack.json` illustrate imports.
