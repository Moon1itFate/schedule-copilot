# Build a debug APK without Android Studio or Gradle.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 [-SeedStatePath path/to/state.json]
# All intermediate files go to an ASCII-only directory (C:\dsh-android-build) because
# aapt2/javac do not handle non-ASCII paths reliably.
param(
  [string]$SeedStatePath = ""
)

$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $PSScriptRoot
$buildDir = if ($env:ANDROID_BUILD_DIR) { $env:ANDROID_BUILD_DIR } else { 'C:\dsh-android-build' }
$jdk = Join-Path $buildDir 'jdk'
$bt = Join-Path $buildDir 'sdk\build-tools\34.0.0'
$androidJar = Join-Path $buildDir 'sdk\platforms\android-34\android.jar'
$work = Join-Path $buildDir 'work'
$resolvedBuild = [System.IO.Path]::GetFullPath($buildDir).TrimEnd('\','/')
$resolvedWork = [System.IO.Path]::GetFullPath($work)
if (-not [string]::Equals((Split-Path -Parent $resolvedWork), $resolvedBuild, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Build work directory is outside the intended build root: $resolvedWork"
}
$apkOut = Join-Path $project 'ScheduleCopilot.apk'

$required = @(
  (Join-Path $jdk 'bin\javac.exe'),
  (Join-Path $bt 'aapt2.exe'),
  (Join-Path $bt 'd8.bat'),
  (Join-Path $bt 'apksigner.bat'),
  (Join-Path $bt 'zipalign.exe'),
  $androidJar
)
foreach ($need in $required) {
  if (-not (Test-Path $need)) {
    throw "Missing build dependency: $need"
  }
}

Write-Host 'Building bundled phone UI (no desktop server required)...'
Push-Location $project
try {
  & npm.cmd run build:mobile
  if ($LASTEXITCODE -ne 0) { throw 'Mobile frontend build failed' }
} finally { Pop-Location }

# Fresh ASCII work directory with a copy of the Android project
if (Test-Path -LiteralPath $resolvedWork) { Remove-Item -LiteralPath $resolvedWork -Recurse -Force }
New-Item -ItemType Directory -Force -Path $work | Out-Null
Copy-Item (Join-Path $project 'android') (Join-Path $work 'android') -Recurse
$androidDir = Join-Path $work 'android'
$out = Join-Path $work 'out'
New-Item -ItemType Directory -Force -Path $out, (Join-Path $out 'gen'), (Join-Path $out 'classes'), (Join-Path $out 'dex') | Out-Null

$assets = Join-Path $androidDir 'assets\web'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Copy-Item (Join-Path $project 'dist-mobile\*') $assets -Recurse -Force
if ($SeedStatePath) {
  $seed = Get-Content -LiteralPath $SeedStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $seed.term -or $null -eq $seed.courses -or $null -eq $seed.tasks) { throw 'Invalid seed state' }
  # Only schedule data is bundled. Model settings and keys are never copied.
  $clean = @{ term = $seed.term; courses = @($seed.courses); tasks = @($seed.tasks) } | ConvertTo-Json -Depth 50
  [System.IO.File]::WriteAllText((Join-Path $assets 'initial-state.json'), $clean, (New-Object System.Text.UTF8Encoding($false)))
}

$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$bt;$env:PATH"

Write-Host '1/6 aapt2 compile...'
& (Join-Path $bt 'aapt2.exe') compile --dir (Join-Path $androidDir 'res') -o (Join-Path $out 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

Write-Host '2/6 aapt2 link...'
& (Join-Path $bt 'aapt2.exe') link `
  -o (Join-Path $out 'base.apk') `
  -I $androidJar `
  --manifest (Join-Path $androidDir 'AndroidManifest.xml') `
  -R (Join-Path $out 'res.zip') `
  --auto-add-overlay `
  --java (Join-Path $out 'gen') `
  --min-sdk-version 24 `
  --target-sdk-version 34 `
  --version-code 11 `
  --version-name 0.6.4
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

Write-Host '3/6 javac...'
$sources = @()
$sources += Get-ChildItem (Join-Path $androidDir 'java') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$sources += Get-ChildItem (Join-Path $out 'gen') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& (Join-Path $jdk 'bin\javac.exe') -encoding UTF-8 -source 8 -target 8 -Xlint:-options -classpath $androidJar -d (Join-Path $out 'classes') $sources
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

Write-Host '4/6 d8...'
$classes = Get-ChildItem (Join-Path $out 'classes') -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& (Join-Path $bt 'd8.bat') --lib $androidJar --min-api 24 --output (Join-Path $out 'dex') $classes
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

Write-Host '5/6 assembling APK...'
$unsigned = Join-Path $out 'app-unsigned.apk'
Copy-Item (Join-Path $out 'base.apk') $unsigned
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($unsigned, 'Update')
try {
  $entry = $zip.GetEntry('classes.dex')
  if ($entry) { $entry.Delete() }
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $out 'dex\classes.dex'), 'classes.dex') | Out-Null
  # aapt2 on Windows can emit asset names with backslashes. Add portable ZIP paths explicitly.
  $assetRoot = Join-Path $androidDir 'assets'
  foreach ($assetFile in (Get-ChildItem -LiteralPath $assetRoot -Recurse -File)) {
    $relative = [System.IO.Path]::GetRelativePath($assetRoot, $assetFile.FullName).Replace('\','/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $assetFile.FullName, "assets/$relative") | Out-Null
  }
} finally {
  $zip.Dispose()
}

$aligned = Join-Path $out 'app-aligned.apk'
& (Join-Path $bt 'zipalign.exe') -f -p 4 $unsigned $aligned
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

$keystore = Join-Path $buildDir 'debug.keystore'
if (-not (Test-Path $keystore)) {
  Write-Host '   generating debug keystore...'
  & (Join-Path $jdk 'bin\keytool.exe') -genkeypair -keystore $keystore -alias androiddebugkey `
    -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 `
    -dname "CN=Android Debug,O=Android,C=US" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
}

Write-Host '6/6 signing...'
$signed = Join-Path $out 'schedule-copilot-signed.apk'
& (Join-Path $bt 'apksigner.bat') sign --ks $keystore --ks-pass pass:android --key-pass pass:android `
  --min-sdk-version 24 --out $signed $aligned
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }

$verify = & (Join-Path $bt 'apksigner.bat') verify --print-certs $signed
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
$verify | Select-Object -First 5

$payloadCheck = [System.IO.Compression.ZipFile]::OpenRead($signed)
try {
  if (-not $payloadCheck.GetEntry('assets/web/index.html') -or -not $payloadCheck.GetEntry('assets/web/app-icon.svg')) { throw 'APK missing bundled frontend' }
  if (@($payloadCheck.Entries | Where-Object { $_.FullName.Contains('\') }).Count) { throw 'Non-portable APK entry path' }
} finally { $payloadCheck.Dispose() }
if (Test-Path $apkOut) { Remove-Item -Force $apkOut }
Copy-Item $signed $apkOut
$size = [math]::Round((Get-Item $apkOut).Length / 1KB, 1)
Write-Host ""
Write-Host "APK: $apkOut ($size KB)"
Write-Host 'Standalone 0.6.4: bundled UI + private phone data; AI connects directly over HTTPS.'
exit 0
