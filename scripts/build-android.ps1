[CmdletBinding()]
param([switch]$Offline, [ValidateRange(1, 16)][int]$Workers = 4, [switch]$EmulatorTest)

$ErrorActionPreference = 'Stop'
$releaseContract = Get-Content -Raw (Join-Path $PSScriptRoot '../config/release.json') | ConvertFrom-Json
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$lock = $null
$transcribing = $false
$stepTimings = [System.Collections.Generic.List[object]]::new()
$abis = if ($EmulatorTest) { @('x86_64') } else { @('arm64-v8a', 'armeabi-v7a') }
$outputName = if ($EmulatorTest) { 'English-in-Practice-emulator.apk' } else { 'English-in-Practice.apk' }
function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}
function Invoke-Step([string]$Label, [string]$Executable, [string[]]$Arguments) {
    Write-Host "`n>>> $Label" -ForegroundColor Cyan
    $timer = [Diagnostics.Stopwatch]::StartNew()
    try {
        & $Executable @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE). See the build log." }
    } finally {
        $timer.Stop()
        $stepTimings.Add([ordered]@{ step = $Label; seconds = [Math]::Round($timer.Elapsed.TotalSeconds, 2) })
        Write-Host "Duration: $($timer.Elapsed.TotalSeconds.ToString('F2')) seconds"
    }
}
try {
    New-Item -ItemType Directory -Force '.local', 'output/builds', '.local/tmp' | Out-Null
    $lock = [IO.File]::Open((Join-Path $root '.local/android-build.lock'), 'CreateNew', 'Write', 'None')
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Start-Transcript -Path "output/builds/build-$stamp.log" | Out-Null
    $transcribing = $true
    $nodeVersion = & node.exe --version
    if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node.js 24 or newer is required.' }
    # Prefer explicit environment settings, then the project-local SDK.
    if (!$env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $root '.local/android-sdk' }
    if (!$env:JAVA_HOME -or !(Test-Path "$env:JAVA_HOME/bin/java.exe")) { throw 'Set JAVA_HOME to an installed JDK 17 directory.' }
    $sdk = $env:ANDROID_HOME
    foreach ($path in @('platforms/android-37.0/android.jar', 'build-tools/37.0.0/apksigner.bat', 'ndk/27.1.12297006', 'cmake/3.30.5')) {
        if (!(Test-Path (Join-Path $sdk $path))) { throw "Missing Android SDK component: $path. See README.md." }
    }
    $env:ANDROID_USER_HOME = Join-Path $sdk 'user'
    if (!$env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = Join-Path $sdk 'gradle-home' }
    $env:TEMP = Join-Path $root '.local/tmp'; $env:TMP = $env:TEMP
    $env:CI = '1'
    if ($Offline) { $env:EXPO_OFFLINE = '1' }
    $env:Path = "$env:JAVA_HOME/bin;$sdk/platform-tools;$env:Path"
    Invoke-Step 'Check Java' "$env:JAVA_HOME/bin/java.exe" @('-version')
    if (!(Test-Path 'node_modules/.bin/expo.cmd')) {
        $installArgs = @('ci')
        if ($Offline) { $installArgs += '--offline' }
        Invoke-Step 'Install locked dependencies' 'npm.cmd' $installArgs
    }
    Invoke-Step 'Prepare and validate offline content' 'npm.cmd' @('run', 'prepare:mobile')
    Invoke-Step 'Check core TypeScript' 'npm.cmd' @('run', 'typecheck')
    Invoke-Step 'Check mobile TypeScript' 'npm.cmd' @('run', 'typecheck:mobile')
    Invoke-Step 'Run core and mobile data tests' 'npm.cmd' @('test')
    Invoke-Step 'Run collection tests' 'npm.cmd' @('run', 'test:data')

    # Never silently generate a different signing identity for an existing installation.
    $keyPath = Join-Path $root 'android/app/debug.keystore'
    if (!(Test-Path -LiteralPath $keyPath)) { throw 'Restore android/app/debug.keystore before building. The existing signing key is required for app updates.' }
    $keyHash = Get-Sha256 $keyPath
    $keyBytes = [IO.File]::ReadAllBytes($keyPath)
    try {
        Invoke-Step 'Synchronize native project (preserve signing key)' 'node.exe' @('node_modules/expo/bin/cli', 'prebuild', '--platform', 'android', '--no-install', '--no-clean')
    } finally {
        if (!(Test-Path -LiteralPath $keyPath) -or (Get-Sha256 $keyPath) -ne $keyHash) {
            [IO.Directory]::CreateDirectory((Split-Path $keyPath -Parent)) | Out-Null
            [IO.File]::WriteAllBytes($keyPath, $keyBytes)
            Write-Warning 'Prebuild changed the key; restored the original signing key.'
        }
    }
    $gradlePath = Join-Path $root 'android/app/build.gradle'
    $gradle = [IO.File]::ReadAllText($gradlePath)
    if (!$gradle.Contains('-DCMAKE_OBJECT_PATH_MAX=240')) {
        $marker = 'defaultConfig {'
        if (!$gradle.Contains($marker)) { throw 'Cannot apply the Windows CMake path fix to this native template.' }
        $gradle = $gradle.Replace($marker, "$marker`n        externalNativeBuild { cmake { arguments `"-DCMAKE_OBJECT_PATH_MAX=240`" } }")
        [IO.File]::WriteAllText($gradlePath, $gradle)
    }
    $gradleArgs = @('-p', 'android', 'assembleRelease', '--no-daemon', '--build-cache', "-PreactNativeArchitectures=$($abis -join ',')", '-Pandroid.enableMinifyInReleaseBuilds=true', '-Pandroid.enableShrinkResourcesInReleaseBuilds=true', '-Pexpo.useLegacyPackaging=true', "--max-workers=$Workers", '--console=plain')
    if ($Offline) { $gradleArgs += '--offline' }
    Invoke-Step 'Build self-contained release APK' '.\android\gradlew.bat' $gradleArgs
    $apk = Join-Path $root 'android/app/build/outputs/apk/release/app-release.apk'
    Invoke-Step 'Verify APK signature' "$sdk/build-tools/37.0.0/apksigner.bat" @('verify', '--verbose', '--print-certs', $apk)

    $certificate = & "$sdk/build-tools/37.0.0/apksigner.bat" verify --print-certs $apk
    if ($LASTEXITCODE -ne 0) { throw 'Could not read APK signing certificate.' }
    $expectedCertificate = $releaseContract.signingCertificateSha256
    if (!(($certificate -join "`n").ToLowerInvariant().Contains($expectedCertificate))) {
        throw 'Signing identity changed. This APK cannot safely update existing installations.'
    }
    $appConfig = (Get-Content -Raw app.json | ConvertFrom-Json).expo
    if ($appConfig.android.package -ne $releaseContract.androidApplicationId) { throw 'Application ID changed; existing data would not be retained.' }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($apk)
    try {
        $bundle = $archive.GetEntry('assets/index.android.bundle')
        if (!$bundle -or $bundle.Length -eq 0) { throw 'APK has no embedded JavaScript bundle.' }
        foreach ($abi in $abis) {
            if (!($archive.Entries | Where-Object { $_.FullName -like "lib/$abi/*.so" })) { throw "Missing native ABI: $abi" }
        }
        $actualAbis = @($archive.Entries | Where-Object { $_.FullName -match '^lib/[^/]+/.*\.so$' } | ForEach-Object { $_.FullName.Split('/')[1] } | Sort-Object -Unique)
        if (@(Compare-Object ($abis | Sort-Object) $actualAbis).Count) { throw 'APK contains unexpected native architectures.' }
        if ($archive.Entries | Where-Object { $_.FullName -match 'libtranslate_jni\.so$' }) { throw 'Unused ML Kit native library is still included.' }
        foreach ($entry in $archive.Entries | Where-Object { $_.FullName -match '^lib/.*\.so$' }) {
            if ($entry.CompressedLength -ge $entry.Length) { throw "Native library was not compressed: $($entry.FullName)" }
        }
        $packHashes = @{}
        foreach ($entry in $archive.Entries | Where-Object { $_.FullName.EndsWith('.pack') }) {
            $stream = $entry.Open(); $sha = [Security.Cryptography.SHA256]::Create()
            try { $digest = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', ''); $packHashes[$digest] = $true }
            finally { $stream.Dispose(); $sha.Dispose() }
        }
        $registry = [IO.File]::ReadAllText((Join-Path $root 'mobile/assets/registry.ts'))
        $assets = [regex]::Matches($registry, "require\('([^']+\.pack)'\)")
        foreach ($match in $assets) {
            $asset = Join-Path "$root/mobile/assets" $match.Groups[1].Value
            $digest = Get-Sha256 $asset
            if (!$packHashes.ContainsKey($digest)) { throw "APK contains missing or stale offline content: $asset" }
        }
        $bundleBytes = $bundle.Length
    } finally { $archive.Dispose() }

    $config = (Get-Content app.json -Raw | ConvertFrom-Json).expo
    $version = $config.version -replace '[^a-zA-Z0-9._-]', '_'
    $archiveName = "English-in-Practice-$version-$($config.android.versionCode)-$($abis -join '+')-$stamp.apk"
    Copy-Item -LiteralPath $apk -Destination "output/builds/$archiveName"
    Copy-Item -LiteralPath $apk -Destination "output/$outputName" -Force
    $report = [ordered]@{
        builtAt = [DateTime]::UtcNow.ToString('o'); version = $config.version; versionCode = $config.android.versionCode
        apk = "output/$outputName"; archivedApk = "output/builds/$archiveName"
        sizeBytes = (Get-Item $apk).Length; sha256 = (Get-Sha256 $apk).ToLowerInvariant()
        offlinePackCount = $assets.Count; allPackBytesMatchSource = $true; hermesBundleBytes = $bundleBytes
        abis = $abis; resourceShrinking = $true; nativeLibrariesCompressed = $true; unusedTranslationModuleRemoved = $true; signatureVerified = $true; signingCertificateSha256 = $expectedCertificate
        checks = @('core typecheck', 'mobile typecheck', 'core/mobile tests', 'collection tests', 'APK signature', 'bundled assets')
        runtimeTest = 'Not run by this packaging command; previous emulator results do not validate a newly changed app.'
    }
    $report | ConvertTo-Json -Depth 5 | Set-Content "output/builds/build-$stamp.json" -Encoding UTF8
    $report | ConvertTo-Json -Depth 5 | Set-Content $(if ($EmulatorTest) { 'output/android-emulator-verification.json' } else { 'output/android-build-verification.json' }) -Encoding UTF8
    Write-Host "`nBuild succeeded: $root/output/$outputName" -ForegroundColor Green
    Write-Host "SHA256: $($report.sha256)"
} catch {
    Write-Host "`nBUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if (Test-Path -LiteralPath 'output') {
        ConvertTo-Json -InputObject @($stepTimings.ToArray()) -Depth 3 | Set-Content 'output/build-timings.json' -Encoding UTF8
        if ($env:GITHUB_STEP_SUMMARY) {
            @('## Build phase timings', '', '| Phase | Seconds |', '| --- | ---: |') | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
            foreach ($timing in $stepTimings) {
                "| $($timing.step) | $($timing.seconds) |" | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
            }
        }
    }
    if ($transcribing) { Stop-Transcript | Out-Null }
    if ($lock) { $lock.Dispose(); Remove-Item -LiteralPath (Join-Path $root '.local/android-build.lock') }
}
