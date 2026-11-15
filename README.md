# English in Practice

Offline React Native English study for Android/iOS: vocabulary and spelling, spaced review,
22 Use of English formats, mistake notebook, notes, incremental JSON import and backup.
The bundle contains 131,008 reference headwords, 40 curated meanings and 70 original tasks.
Original practice is not official IELTS past-paper material.

## Download an Android APK

Open **Actions → Build Android APK → Run workflow**. After success, download
`English-in-Practice-android-<run number>` under **Artifacts**, extract it and install the APK.
Artifacts are retained for 30 days. The workflow also runs automatically on `v*` tags.
Successful tag builds publish the APK, verification report and SHA256SUMS.txt to
[GitHub Releases](https://github.com/WartDipara/Lng/releases). Release downloads do not
have the Actions artifact retention limit. Manual builds only upload Actions artifacts.

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
It does not run device tests. iOS requires Mac/Xcode and signing; this CI produces Android APKs.

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
