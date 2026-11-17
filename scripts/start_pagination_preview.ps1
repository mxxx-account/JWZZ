#Requires -Version 7.4
# An isolated local acceptance instance; uses existing local development database.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local_launcher_common.ps1')
$root = Split-Path $PSScriptRoot -Parent
Assert-JwzzPortFree 8084
Assert-JwzzPortFree 3004
$jar = Join-Path $root '.local-run/pagination-server/server-0.1.0-SNAPSHOT.jar'
if (-not (Test-Path -LiteralPath $jar)) { throw 'Build the isolated JAR first; see docs/message-pagination-acceptance.md.' }
$database = Get-JwzzDatabaseEnvironment (Join-Path $root 'server/.env.local.ps1')
$javaEnv = Get-JwzzChildEnvironment -Service Java -Database $database
$javaEnv.JWZZ_REDIS_ENABLED = 'false'
$javaEnv.JWZZ_CORS_ORIGINS = 'http://localhost:3004,http://127.0.0.1:3004'
$webEnv = Get-JwzzChildEnvironment -Service Web
$webEnv.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:8084'
$webEnv.JWZZ_PAGINATION_QA = 'true'
$logs = Join-Path $root ('.local-run/pagination-preview-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$children = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
try {
    $backend = Start-JwzzChild -Executable (Get-Command java).Source -Arguments @('-jar',$jar,'--server.address=127.0.0.1','--server.port=8084') -WorkingDirectory $root -Environment $javaEnv -LogDirectory $logs -Name 'java'
    $children.Add($backend)
    Wait-JwzzReady $backend 'http://127.0.0.1:8084/api/health' -JsonHealth
    $frontend = Start-JwzzChild -Executable (Get-Command node).Source -Arguments @((Join-Path $root 'web/node_modules/next/dist/bin/next'),'dev','--hostname','localhost','--port','3004') -WorkingDirectory (Join-Path $root 'web') -Environment $webEnv -LogDirectory $logs -Name 'web'
    $children.Add($frontend)
    Wait-JwzzReady $frontend 'http://localhost:3004'
    Write-Host "Preview ready: http://localhost:3004 . Logs: $logs"
    Write-Host 'Shares local development DB; AI disabled. Ctrl+C stops only this preview, not 3000/8080.'
    while ($true) {
        if ($backend.HasExited -or $frontend.HasExited) { throw 'A preview process exited; inspect its logs.' }
        Start-Sleep -Milliseconds 500
    }
} finally {
    for ($index=$children.Count-1; $index -ge 0; $index--) { Stop-JwzzChild $children[$index] }
}
