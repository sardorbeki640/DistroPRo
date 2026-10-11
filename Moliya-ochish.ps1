$ErrorActionPreference='Stop'
$appRoot=$PSScriptRoot
$nodePath=(Get-Command node -ErrorAction SilentlyContinue).Source
if(!$nodePath){$nodePath='C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'}
if(!(Test-Path $nodePath)){throw 'Node.js topilmadi.'}
$env:HOST='127.0.0.1'
$env:PORT='3100'
$env:NODE_ENV='production'
try {
 $health=Invoke-RestMethod 'http://127.0.0.1:3100/api/health' -TimeoutSec 2
 if($health.system -eq 'Distribution Finance System'){Start-Process 'http://127.0.0.1:3100';exit}
 throw '3100-port boshqa dastur tomonidan band.'
} catch {
 if($_.Exception.Message -like '*boshqa dastur*'){throw}
}
Start-Process -FilePath $nodePath -ArgumentList '--env-file-if-exists=.env.local dist/server.cjs' -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $appRoot 'runtime.log') -RedirectStandardError (Join-Path $appRoot 'runtime-error.log')
for($attempt=0;$attempt -lt 30;$attempt++){
 try { $health=Invoke-RestMethod 'http://127.0.0.1:3100/api/health' -TimeoutSec 1; if($health.status -eq 'ok'){Start-Process 'http://127.0.0.1:3100';exit} } catch {}
 Start-Sleep -Milliseconds 300
}
throw 'Dastur ochilmadi. runtime-error.log faylini tekshiring.'
