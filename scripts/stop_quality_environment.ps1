$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$recordDir=Join-Path $projectRoot 'reports/quality-2026-11-08-round3'
$fault=Get-Content (Join-Path $recordDir 'processes.json') -Raw | ConvertFrom-Json
$production=Get-Content (Join-Path $recordDir 'production-processes.json') -Raw | ConvertFrom-Json
$targets=@(
  @{id=$fault.backendPid;match='server-0.1.0-SNAPSHOT.jar.*--server.port=8082'},
  @{id=$fault.proxyPid;match='quality_fault_proxy.mjs'},
  @{id=$production.backendPid;match='server-0.1.0-SNAPSHOT.jar.*--server.port=8083'},
  @{id=$production.frontendPid;match='quality-2026-11-08-round3.*server.js'}
)
foreach ($target in $targets) {
  if (-not $target.id) { throw 'Missing test process identifier' }
  $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($target.id)"
  if ($process) {
    if ($process.CommandLine -notmatch $target.match) { throw "Process identity changed: $($target.id)" }
    Stop-Process -Id $target.id
    Write-Output "Stopped owned test process $($target.id)"
  }
}
$label=wsl -d Ubuntu -u root -- docker inspect --format '{{index .Config.Labels "jwzz.quality"}}' jwzz-quality-r3-redis
if ($LASTEXITCODE -ne 0 -or ($label -join '').Trim() -ne 'round3') { throw 'Test Redis label mismatch' }
wsl -d Ubuntu -u root -- docker stop jwzz-quality-r3-redis
if ($LASTEXITCODE -ne 0) { throw 'Could not stop test Redis' }
Write-Output 'Retained test databases, test account grants, stopped Redis container and generated evidence; nothing deleted'
