# English in Practice

An offline Android app for vocabulary, spelling and Use of English practice.
Includes practice sets, progress charts, a mistake notebook, notes, dark mode,
and incremental JSON content imports. No account required.

## Download & update

Download **English-in-Practice.apk** from [GitHub Releases](https://github.com/WartDipara/Lng/releases).
Install newer versions over the existing app **without uninstalling or clearing data**.
Use **Profile → Library & backups** to export your records before changing phones.

## Build & release

```sh
npm ci
npm run build
```

Requires Windows, Node.js 24+, Python 3, JDK 17 and the Android SDK.
Restore the existing signing key to `android/app/debug.keystore` before building.
The APK is written to `output/English-in-Practice.apk`.

For a release, update the versions in `package.json` and `app.json`, increase
Android `versionCode`, then push the matching `v*` tag. GitHub Actions builds
and attaches the APK to the Release. Manual runs provide an Actions artifact.
Keep the existing signing key and `ANDROID_KEYSTORE_BASE64` repository secret.

Content schemas and example JSON packs are in `schemas/` and `examples/`.
Practice questions are original exercises, not official IELTS past papers.
