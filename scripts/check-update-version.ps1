$ErrorActionPreference = 'Stop'
$releaseContract = Get-Content -Raw (Join-Path $PSScriptRoot '../config/release.json') | ConvertFrom-Json
$app = (Get-Content -Raw app.json | ConvertFrom-Json).expo
if ($app.android.package -ne $releaseContract.androidApplicationId) { throw 'Keep the existing Android application ID for updates.' }
if (!$env:GITHUB_REPOSITORY) { throw 'GITHUB_REPOSITORY is required.' }
$headers = @{ Accept = 'application/vnd.github+json'; Authorization = "Bearer $env:GH_TOKEN" }
try {
    $latest = Invoke-RestMethod -Uri "https://api.github.com/repos/$($env:GITHUB_REPOSITORY)/releases/latest" -Headers $headers
} catch {
    if ([int]$_.Exception.Response.StatusCode -eq 404) { Write-Host 'No prior release to compare.'; exit 0 }
    throw
}
$asset = $latest.assets | Where-Object name -eq 'android-build-verification.json' | Select-Object -First 1
if (!$asset) { throw 'Latest release is missing its version verification report.' }
$previous = Invoke-RestMethod -Uri $asset.browser_download_url
# Allow a retry of an already-published tag, but never publish a new tag with an old code.
$retry = $env:GITHUB_REF_TYPE -eq 'tag' -and $env:GITHUB_REF_NAME -eq $latest.tag_name
if (!$retry -and $app.android.versionCode -le $previous.versionCode) {
    throw "Increase android.versionCode above $($previous.versionCode) so existing installs can update."
}
Write-Host "Update version verified against $($latest.tag_name)."
