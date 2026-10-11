# Distro Pro: build on this computer and put it on the cloud server (prepared once with server-setup.sh).
#
#   Code only (data on the server stays):
#     powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server ubuntu@1.2.3.4
#   First time, or moving the live data from this computer to the server:
#     powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server ubuntu@1.2.3.4 -MigrateData
#
# -MigrateData stops the server on this computer, switches off its autostart (so only one copy of the data is live),
# takes a consistent snapshot of the database, uploads it with .env.local (the key that decrypts the stored
# integration passwords), and checks that every table has the same number of rows on the server.
# The local database file is not changed or deleted: it stays as a fallback.
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$Key = "$env:USERPROFILE\.ssh\distro_oracle",
  [switch]$MigrateData,
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$node = Join-Path $root 'runtime\node.exe'
$sshOpts = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30')
function Remote([string]$cmd) { & ssh @sshOpts $Server $cmd; if ($LASTEXITCODE -ne 0) { throw "Serverda xato: $cmd" } }
function Upload([string[]]$files, [string]$dest) { & scp @sshOpts @files "${Server}:$dest"; if ($LASTEXITCODE -ne 0) { throw "Yuklab bo'lmadi: $files" } }

if (-not (Test-Path $Key)) { throw "SSH kalit topilmadi: $Key" }
$stage = Join-Path $env:TEMP "distro-deploy"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null
# The staging folder may hold the database copy and the secret key: removed on any failure too.
trap { Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue; throw $_ }

# 1. Build
if (-not $SkipBuild) {
  Write-Host "== Yig'ish (typecheck, vite, esbuild)"
  & $node node_modules\typescript\bin\tsc --noEmit; if ($LASTEXITCODE -ne 0) { throw 'Typecheck xato' }
  & $node node_modules\vite\bin\vite.js build | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Vite xato' }
  & $node node_modules\esbuild\bin\esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs
  if ($LASTEXITCODE -ne 0) { throw 'esbuild xato' }
}

# 2. Package: dist + a package.json with exactly the packages the server bundle requires, at the versions used here.
Write-Host "== Paket"
$pkgScript = @'
const fs=require('fs'),path=require('path');
const code=fs.readFileSync('dist/server.cjs','utf8');
const builtins=new Set(require('module').builtinModules);
const deps={};
for(const m of code.matchAll(/require\("([^"./][^"]*)"\)/g)){
  const id=m[1];if(id.startsWith('node:')||builtins.has(id))continue;
  const name=id.startsWith('@')?id.split('/').slice(0,2).join('/'):id.split('/')[0];
  deps[name]=JSON.parse(fs.readFileSync(path.join('node_modules',name,'package.json'),'utf8')).version;
}
fs.writeFileSync(process.argv[2],JSON.stringify({name:'distro-pro',private:true,dependencies:deps},null,2));
console.log(Object.entries(deps).map(([k,v])=>k+'@'+v).join(', '));
'@
$pkgScript | Set-Content -Encoding ASCII (Join-Path $stage 'pkg.cjs')
& $node (Join-Path $stage 'pkg.cjs') (Join-Path $stage 'package.json'); if ($LASTEXITCODE -ne 0) { throw 'package.json tuzilmadi' }
$tar = Join-Path $stage 'app.tar.gz'
tar -czf $tar dist -C $stage package.json; if ($LASTEXITCODE -ne 0) { throw 'Arxiv tuzilmadi' }

# 3. Data (only with -MigrateData)
if ($MigrateData) {
  Write-Host "== Kompyuterdagi serverni to'xtatish va avtomatik ishga tushishni o'chirish"
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*server-launcher.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  $listen = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
  if ($listen) { Stop-Process -Id $listen.OwningProcess -Force; Start-Sleep -Seconds 3 }
  Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'DistroPro' -ErrorAction SilentlyContinue

  Write-Host "== Baza nusxasi (VACUUM INTO)"
  $snap = Join-Path $stage 'finance.sqlite'
  $countScript = @'
const {DatabaseSync}=process.getBuiltinModule('node:sqlite');
const [src,snap,out]=process.argv.slice(2);
if(snap){const s=new DatabaseSync(src,{readOnly:true});s.exec(`VACUUM INTO '${snap.replace(/'/g,"''")}'`);s.close();}
const d=new DatabaseSync(snap||src,{readOnly:true});
const rows=d.prepare('select tbl,count(*) n from rows group by tbl order by tbl').all().map(r=>r.tbl+'|'+r.n);
require('fs').writeFileSync(out,rows.join('\n'));console.log(rows.length+' jadval');
'@
  $countScript | Set-Content -Encoding ASCII (Join-Path $stage 'count.cjs')
  & $node (Join-Path $stage 'count.cjs') (Join-Path $root '.data\finance.sqlite') $snap (Join-Path $stage 'local-counts.txt')
  if ($LASTEXITCODE -ne 0) { throw 'Baza nusxasi olinmadi' }
  Copy-Item (Join-Path $root '.env.local') (Join-Path $stage '.env.local')

  # Face ID portraits and check-in photos live next to the database (paths in it are relative to the data folder).
  $photoDirs = @('face-photos', 'attendance-photos') | Where-Object { Test-Path (Join-Path $root ".data\$_") }
  if ($photoDirs) {
    Write-Host "== Rasmlar: $($photoDirs -join ', ')"
    tar -czf (Join-Path $stage 'photos.tar.gz') -C (Join-Path $root '.data') @photoDirs; if ($LASTEXITCODE -ne 0) { throw 'Rasmlar arxivi tuzilmadi' }
  }
}

# 4. Upload and install
Write-Host "== Serverga yuklash"
$files = @($tar); if ($MigrateData) { $files += @((Join-Path $stage 'finance.sqlite'), (Join-Path $stage '.env.local')) }
$photosTar = Join-Path $stage 'photos.tar.gz'
if ($MigrateData -and (Test-Path $photosTar)) { $files += $photosTar }
Remote 'rm -rf /tmp/distro-up && mkdir -p /tmp/distro-up && chmod 700 /tmp/distro-up'
Upload $files '/tmp/distro-up/'

Write-Host "== O'rnatish"
$install = @(
  'set -e',
  'sudo systemctl stop distro-pro || true',
  'sudo rm -rf /opt/distro-pro/app.new && sudo mkdir -p /opt/distro-pro/app.new',
  'sudo tar -xzf /tmp/distro-up/app.tar.gz -C /opt/distro-pro/app.new',
  'sudo chown -R distro:distro /opt/distro-pro/app.new',
  'cd /opt/distro-pro/app.new && sudo -u distro HOME=/opt/distro-pro npm install --omit=dev --no-audit --no-fund --loglevel=error',
  'sudo rm -rf /opt/distro-pro/app.old && (sudo mv /opt/distro-pro/app /opt/distro-pro/app.old || true) && sudo mv /opt/distro-pro/app.new /opt/distro-pro/app'
)
if ($MigrateData) {
  $install += @(
    # A database already on the server is kept aside, never overwritten silently.
    'if [ -f /opt/distro-pro/data/finance.sqlite ]; then sudo mv /opt/distro-pro/data/finance.sqlite /opt/distro-pro/data/finance.sqlite.before-migrate-$(date +%Y%m%d%H%M%S); fi',
    'sudo rm -f /opt/distro-pro/data/finance.sqlite-wal /opt/distro-pro/data/finance.sqlite-shm',
    'sudo install -o distro -g distro -m 640 /tmp/distro-up/finance.sqlite /opt/distro-pro/data/finance.sqlite',
    'sudo install -o distro -g distro -m 600 /tmp/distro-up/.env.local /opt/distro-pro/data/.env.local'
  )
  if (Test-Path $photosTar) {
    $install += @(
      'sudo tar -xzf /tmp/distro-up/photos.tar.gz -C /opt/distro-pro/data',
      'sudo chown -R distro:distro /opt/distro-pro/data/face-photos /opt/distro-pro/data/attendance-photos 2>/dev/null || true',
      'sudo chmod -R u=rwX,g=rX,o= /opt/distro-pro/data/face-photos /opt/distro-pro/data/attendance-photos 2>/dev/null || true'
    )
  }
}
$install += @('rm -rf /tmp/distro-up', 'sudo systemctl start distro-pro')
Remote ($install -join ' && ')

# 5. Check
Write-Host "== Tekshirish"
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 3
  & ssh @sshOpts $Server 'curl -fsS http://127.0.0.1:3100/api/health' 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
}
if (-not $ok) { & ssh @sshOpts $Server 'sudo journalctl -u distro-pro -n 40 --no-pager'; throw 'Server ishga tushmadi (yuqoridagi jurnalga qarang)' }
if ($MigrateData) {
  $remote = (& ssh @sshOpts $Server "sudo sqlite3 /opt/distro-pro/data/finance.sqlite 'select tbl, count(*) from rows group by tbl order by tbl'") -join "`n"
  $local = (Get-Content (Join-Path $stage 'local-counts.txt') -Raw).Trim()
  # Migrations at start-up may add rows (e.g. _migrations); every table must have at least as many rows as here.
  $remoteMap = @{}; foreach ($l in $remote -split "`n") { $p = $l.Trim() -split '\|'; if ($p.Count -eq 2) { $remoteMap[$p[0]] = [int]$p[1] } }
  $bad = @(); foreach ($l in $local -split "`n") { $p = $l.Trim() -split '\|'; if ([int]$remoteMap[$p[0]] -lt [int]$p[1]) { $bad += "$($p[0]): kompyuterda $($p[1]), serverda $($remoteMap[$p[0]])" } }
  if ($bad.Count) { throw ("Jadvallar mos emas:`n" + ($bad -join "`n")) }
  Write-Host "Baza ko'chirildi: hamma jadvallar mos."
}
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
Write-Host "Tayyor: server ishlayapti."
