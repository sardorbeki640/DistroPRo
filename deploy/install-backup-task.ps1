# Registers a daily Windows task (09:00 and at sign-in) that runs pull-backup.ps1 for this user.
#   powershell -ExecutionPolicy Bypass -File deploy\install-backup-task.ps1 -Server ubuntu@1.2.3.4
param([Parameter(Mandatory = $true)][string]$Server)
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'pull-backup.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Server $Server"
$triggers = @((New-ScheduledTaskTrigger -Daily -At 9am), (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'DistroPro backup' -Action $action -Trigger $triggers -Settings $settings -Description 'Distro Pro: serverdan kunlik zaxira nusxani olish' -Force | Out-Null
Write-Host "Vazifa o'rnatildi: har kuni 09:00 da va kirishda zaxira nusxa olinadi (.data\cloud-backups)."
