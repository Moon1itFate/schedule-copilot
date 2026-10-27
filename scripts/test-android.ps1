$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$androidBuild = if ($env:ANDROID_BUILD_DIR) { $env:ANDROID_BUILD_DIR } else { 'C:\dsh-android-build' }
$javaCompiler = Join-Path $androidBuild 'jdk\bin\javac.exe'
$javaRunner = Join-Path $androidBuild 'jdk\bin\java.exe'
if (-not (Test-Path -LiteralPath $javaCompiler)) { throw 'Run scripts/setup-android.ps1 first, or set ANDROID_BUILD_DIR' }
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\','/')
$testOutput = Join-Path $tempRoot ('schedule-android-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testOutput | Out-Null
try {
  & $javaCompiler -encoding UTF-8 -d $testOutput (Join-Path $projectRoot 'android\java\com\dsh\schedule\ReminderSchedule.java') (Join-Path $projectRoot 'tests\android\ReminderScheduleTest.java')
  if ($LASTEXITCODE -ne 0) { throw 'Native reminder planner compilation failed' }
  & $javaRunner -cp $testOutput com.dsh.schedule.ReminderScheduleTest
  if ($LASTEXITCODE -ne 0) { throw 'Native reminder planner tests failed' }
} finally {
  $resolvedTest = [System.IO.Path]::GetFullPath($testOutput)
  if ((Split-Path -Parent $resolvedTest) -ne $tempRoot -or (Split-Path -Leaf $resolvedTest) -notlike 'schedule-android-test-*') { throw 'Refusing to remove an unexpected test directory' }
  Remove-Item -LiteralPath $resolvedTest -Recurse -Force
}
