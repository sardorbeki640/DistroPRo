# Distro Pro server launcher and watchdog.
# Started hidden at Windows sign-in (HKCU\...\Run "DistroPro"). Keeps exactly one server on port 3100 running:
# if it stops or crashes it is started again after 5 seconds. Logs go to .data\logs\server-YYYY-MM-DD.log.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$node = Join-Path $root 'runtime\node.exe'
$port = 3100
$logDir = Join-Path $root '.data\logs'
New-Item -ItemType Directory -Force $logDir | Out-Null

# A second launcher (double start) only watches.
$mutex = New-Object System.Threading.Mutex($false, 'Global\DistroProLauncher')
if (-not $mutex.WaitOne(0)) { exit 0 }

$env:HOST = '127.0.0.1'
$env:PORT = "$port"
$env:NODE_ENV = 'production'

while ($true) {
  $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($busy) { Start-Sleep -Seconds 30; continue }   # a server is already running (started by hand)
  $log = Join-Path $logDir ("server-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
  Add-Content -Path $log -Value ("[{0}] Server ishga tushirilmoqda" -f (Get-Date -Format 's')) -Encoding UTF8
  $p = Start-Process -FilePath $node -ArgumentList '--env-file-if-exists=.env.local', 'dist/server.cjs' -WorkingDirectory $root `
       -WindowStyle Hidden -PassThru -RedirectStandardOutput "$log.out" -RedirectStandardError "$log.err"
  $p.WaitForExit()
  Add-Content -Path $log -Value ("[{0}] Server to'xtadi (kod {1}); 5 soniyadan keyin qayta ishga tushadi" -f (Get-Date -Format 's'), $p.ExitCode) -Encoding UTF8
  Start-Sleep -Seconds 5
  # Old logs (over 30 days) are removed.
  Get-ChildItem $logDir -File | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | Remove-Item -Force -ErrorAction SilentlyContinue
}
