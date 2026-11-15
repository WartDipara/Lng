$ErrorActionPreference = 'Stop'
function Invoke-Gh([string[]]$Arguments) {
    & gh @Arguments
    if ($LASTEXITCODE -ne 0) { throw "GitHub release operation failed: $($Arguments[0]) $($Arguments[1])" }
}

$tag = $env:RELEASE_TAG
if (!$tag -or !$env:GH_REPO) { throw 'RELEASE_TAG and GH_REPO are required.' }
$report = Get-Content -Raw output/android-build-verification.json | ConvertFrom-Json
if ($tag -ne "v$($report.version)") { throw 'Tag does not match the verified APK version.' }
$apk = 'output/English-in-Practice.apk'
$actual = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $report.sha256 -or !$report.signatureVerified -or !$report.allPackBytesMatchSource) {
    throw 'APK does not match the successful build verification report.'
}
"$actual  English-in-Practice.apk" | Set-Content output/SHA256SUMS.txt -Encoding utf8NoBOM
$assets = @($apk, 'output/android-build-verification.json', 'output/SHA256SUMS.txt')
$url = "https://github.com/$($env:GH_REPO)/releases/tag/$tag"
$notes = @"
Offline English study for Android. Download and install **English-in-Practice.apk** below.

- Version: $($report.version) (Android versionCode $($report.versionCode))
- Architectures: arm64-v8a and x86_64
- SHA-256: $actual
- Offline assets verified: $($report.offlinePackCount)
- Build: https://github.com/$($env:GH_REPO)/actions/runs/$($env:GITHUB_RUN_ID)

Includes the build verification report and SHA256SUMS.txt. This build checks compilation,
tests, signing and bundled content; it does not run device tests.
"@
$notes | Set-Content output/release-notes.md -Encoding utf8NoBOM

# The list operation must succeed: an authentication/network error is not "no release".
$raw = Invoke-Gh @('api', '--paginate', "repos/$($env:GH_REPO)/releases", '--jq', '.[] | {tag_name, draft, assets: [.assets[].name]}')
$existing = @($raw | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.tag_name -eq $tag })
if ($existing.Count -gt 0 -and !$existing[0].draft) {
    foreach ($name in @('English-in-Practice.apk', 'android-build-verification.json', 'SHA256SUMS.txt')) {
        if ($name -notin $existing[0].assets) { throw "Published release is missing $name. It will not be overwritten automatically." }
    }
    Write-Host "Release already published; preserving its existing downloads: $url"
} else {
    if (!$existing.Count) {
        $arguments = @('release', 'create', $tag, '--verify-tag', '--draft', '--title', "English in Practice $tag", '--notes-file', 'output/release-notes.md')
        if ($report.version -match '-') { $arguments += '--prerelease' }
        Invoke-Gh $arguments
    }
    # A failed upload leaves a draft. Retrying replaces only unfinished draft assets.
    Invoke-Gh (@('release', 'upload', $tag, '--clobber') + $assets)
    Invoke-Gh @('release', 'edit', $tag, '--draft=false', '--notes-file', 'output/release-notes.md')
}
if ($env:GITHUB_STEP_SUMMARY) {
    "## Release published`n[Download $tag APK]($url)" | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
}
Write-Host $url
