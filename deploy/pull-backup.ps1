# Copies the newest daily backup from the cloud server to this computer (.data\cloud-backups), keeping the last 30.
# A second copy away from the server: if the server is lost, the data is not.
#   powershell -ExecutionPolicy Bypass -File deploy\pull-backup.ps1 -Server ubuntu@1.2.3.4
# Run daily by the "DistroPro backup" scheduled task (install-backup-task.ps1).
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$Key = "$env:USERPROFILE\.ssh\distro_oracle",
  [int]$Keep = 30
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root '.data\cloud-backups'
New-Item -ItemType Directory -Force $dest | Out-Null
$log = Join-Path $dest 'pull.log'
$sshOpts = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes')
try {
  $newest = (& ssh @sshOpts $Server 'ls -1t /opt/distro-pro/data/backups/daily/*.sqlite 2>/dev/null | head -n 1').Trim()
  if (-not $newest) { throw 'Serverda zaxira nusxa topilmadi' }
  $target = Join-Path $dest ([IO.Path]::GetFileName($newest))
  if (-not (Test-Path $target)) {
    & scp @sshOpts "${Server}:$newest" $target
    if ($LASTEXITCODE -ne 0) { throw "Yuklab bo'lmadi: $newest" }
  }
  Get-ChildItem $dest -Filter 'finance-*.sqlite' | Sort-Object Name -Descending | Select-Object -Skip $Keep | Remove-Item -Force
  Add-Content $log ("[{0}] OK {1} ({2:N0} MB)" -f (Get-Date -Format 's'), (Split-Path $target -Leaf), ((Get-Item $target).Length / 1MB))
} catch {
  Add-Content $log ("[{0}] XATO {1}" -f (Get-Date -Format 's'), $_.Exception.Message)
  throw
}
