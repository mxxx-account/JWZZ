#Requires -Version 7.4
param([switch]$DisableNotifications)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local_launcher_common.ps1')
$root = Split-Path $PSScriptRoot -Parent
Assert-JwzzPortFree 8085
Assert-JwzzPortFree 3005
$jar = Join-Path $root '.local-run/notifications-server/server-0.1.0-SNAPSHOT.jar'
if (-not (Test-Path -LiteralPath $jar)) { throw 'Build the notifications preview JAR first; see docs/notifications-acceptance.md.' }
$database = Get-JwzzDatabaseEnvironment (Join-Path $root 'server/.env.local.ps1')
$javaEnv = Get-JwzzChildEnvironment -Service Java -Database $database
$javaEnv.JWZZ_REDIS_ENABLED = 'false'
$javaEnv.JWZZ_CORS_ORIGINS = 'http://localhost:3005,http://127.0.0.1:3005'
$webEnv = Get-JwzzChildEnvironment -Service Web
$webEnv.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:8085'
$webEnv.JWZZ_NOTIFICATIONS_QA = 'true'
$logs = Join-Path $root ('.local-run/notifications-preview-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$children = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
try {
    $argsJava = @('-jar',$jar,'--server.address=127.0.0.1','--server.port=8085')
    if ($DisableNotifications) { $argsJava += '--app.notifications.dispatch-enabled=false' }
    $backend = Start-JwzzChild -Executable (Get-Command java).Source -Arguments $argsJava -WorkingDirectory $root -Environment $javaEnv -LogDirectory $logs -Name 'java'
    $children.Add($backend)
    Wait-JwzzReady $backend 'http://127.0.0.1:8085/api/health' -JsonHealth
    $frontend = Start-JwzzChild -Executable (Get-Command node).Source -Arguments @((Join-Path $root 'web/node_modules/next/dist/bin/next'),'dev','--hostname','localhost','--port','3005') -WorkingDirectory (Join-Path $root 'web') -Environment $webEnv -LogDirectory $logs -Name 'web'
    $children.Add($frontend)
    Wait-JwzzReady $frontend 'http://localhost:3005'
    Write-Host "Ready: http://localhost:3005 . Logs: $logs"
    Write-Host 'Shares development DB; AI disabled. Ctrl+C stops this preview only.'
    while ($true) {
        if ($backend.HasExited -or $frontend.HasExited) { throw 'Preview stopped unexpectedly; inspect logs.' }
        Start-Sleep -Milliseconds 500
    }
} finally {
    for ($index=$children.Count-1; $index -ge 0; $index--) { Stop-JwzzChild $children[$index] }
}
