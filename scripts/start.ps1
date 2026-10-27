$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "没有找到 Node.js，请先安装 https://nodejs.org/ 后再试。" -ForegroundColor Red
  Read-Host "按回车退出"
  exit 1
}

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host "首次运行，安装依赖（可能需要一两分钟）..." -ForegroundColor Cyan
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    Write-Host "依赖安装失败，请检查网络后重试。" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
  }
}

if (-not (Test-Path (Join-Path $root 'dist\index.html'))) {
  Write-Host "构建前端..." -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) {
    Write-Host "构建失败。" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
  }
}

Write-Host "启动服务..." -ForegroundColor Cyan
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm start' -WorkingDirectory $root
Start-Sleep -Seconds 4
Start-Process 'http://127.0.0.1:8787'

Write-Host ""
Write-Host "已启动：http://127.0.0.1:8787" -ForegroundColor Green
Write-Host "手机访问地址看服务窗口打印的内容，或运行「查地址.bat」。" -ForegroundColor Green
Write-Host "关闭弹出的服务窗口即可停止服务。"
Start-Sleep -Seconds 2
