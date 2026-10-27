$ErrorActionPreference = 'SilentlyContinue'

$addrs = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'
} | Sort-Object -Property @{ Expression = { if ($_.InterfaceAlias -match 'WLAN|Wi-Fi|Ethernet') { 0 } else { 1 } } }, InterfaceAlias

Write-Host ""
Write-Host "  日程罗盘 · 本机局域网地址" -ForegroundColor Cyan
Write-Host "  ----------------------------------------"

if (-not $addrs) {
  Write-Host "  没有检测到局域网地址，检查 Wi-Fi 是否连接。" -ForegroundColor Yellow
}

foreach ($a in $addrs) {
  $mark = ''
  if ($a.InterfaceAlias -match 'WLAN|Wi-Fi|Ethernet') { $mark = '   <= 手机填这个' }
  Write-Host ("  {0,-16} {1}{2}" -f $a.IPAddress, $a.InterfaceAlias, $mark)
}

$first = $addrs | Where-Object { $_.InterfaceAlias -match 'WLAN|Wi-Fi|Ethernet' } | Select-Object -First 1
if (-not $first) { $first = $addrs | Select-Object -First 1 }

if ($first) {
  Write-Host ""
  Write-Host "  手机 App 里填：      http://$($first.IPAddress):8787" -ForegroundColor Green
  Write-Host "  手机下载安装包：    http://$($first.IPAddress):8787/app.apk" -ForegroundColor Green
}

Write-Host ""
Write-Host "  换了 Wi-Fi、开了热点、插了 USB 共享网络后，地址会变，重新运行本脚本即可。"
Write-Host ""
