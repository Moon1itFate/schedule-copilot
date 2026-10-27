# One-time setup for building the APK without Android Studio.
# Downloads a JDK 17, Android SDK platform 34 and build-tools 34 into C:\dsh-android-build.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/setup-android.ps1
$ErrorActionPreference = 'Stop'

$build = if ($env:ANDROID_BUILD_DIR) { $env:ANDROID_BUILD_DIR } else { 'C:\dsh-android-build' }
$dl = Join-Path $build 'dl'
New-Item -ItemType Directory -Force -Path $dl, (Join-Path $build 'sdk\platforms'), (Join-Path $build 'sdk\build-tools') | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Fetch([string]$url, [string]$out) {
  if (Test-Path $out) { return }
  Write-Host "downloading $url"
  & curl.exe -L --retry 3 --retry-delay 2 --max-time 1800 -o $out $url
  if ($LASTEXITCODE -ne 0) { throw "download failed: $url" }
}

if (-not (Test-Path (Join-Path $build 'jdk\bin\javac.exe'))) {
  $zip = Join-Path $dl 'jdk17.zip'
  Fetch 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip' $zip
  $tmp = Join-Path $build 'tmp-jdk'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
  Get-ChildItem $tmp -Directory | Select-Object -First 1 | ForEach-Object { Move-Item $_.FullName (Join-Path $build 'jdk') }
  Remove-Item -Recurse -Force $tmp
}

if (-not (Test-Path (Join-Path $build 'sdk\platforms\android-34\android.jar'))) {
  $zip = Join-Path $dl 'platform-34.zip'
  Fetch 'https://googledownloads.cn/android/repository/platform-34-ext7_r03.zip' $zip
  $tmp = Join-Path $build 'tmp-platform'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
  Move-Item (Join-Path $tmp 'android-34') (Join-Path $build 'sdk\platforms\android-34')
  Remove-Item -Recurse -Force $tmp
}

if (-not (Test-Path (Join-Path $build 'sdk\build-tools\34.0.0\aapt2.exe'))) {
  $zip = Join-Path $dl 'build-tools-34.zip'
  Fetch 'https://googledownloads.cn/android/repository/build-tools_r34-windows.zip' $zip
  $tmp = Join-Path $build 'tmp-bt'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
  Move-Item (Join-Path $tmp 'android-14') (Join-Path $build 'sdk\build-tools\34.0.0')
  Remove-Item -Recurse -Force $tmp
}

Write-Host "Android build tools ready in $build"
