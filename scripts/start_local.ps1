#Requires -Version 7.4
[CmdletBinding()]
param([switch]$WithAi, [switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local_launcher_common.ps1')
if (-not $IsWindows) { throw 'This local launcher requires Windows.' }
$projectRoot = Split-Path $PSScriptRoot -Parent
$settings = Import-PowerShellDataFile (Join-Path $PSScriptRoot 'local.settings.psd1')
$jar = Join-Path $projectRoot 'server/target/server-0.1.0-SNAPSHOT.jar'
$python = Join-Path $projectRoot '.venv/Scripts/python.exe'
$next = Join-Path $projectRoot 'web/node_modules/next/dist/bin/next'
$java = (Get-Command java -CommandType Application -ErrorAction Stop).Source
$node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
foreach ($required in @($jar, $next)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Missing dependency/build output: $required. See docs/local-startup.md. Nothing is downloaded automatically."
    }
}
$database = Get-JwzzDatabaseEnvironment (Join-Path $projectRoot 'server/.env.local.ps1')
$credentials = $null
$ports = @(8080, 3000)
if ($WithAi) {
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw 'Missing .venv/Scripts/python.exe. See docs/local-startup.md.' }
    $credentials = Read-JwzzCredentials (Get-JwzzCredentialPath)
    $baseUri = [uri]$settings.AiBaseUrl
    if (-not $baseUri.IsAbsoluteUri -or $baseUri.Scheme -ne 'https' -or $baseUri.UserInfo -or
        $baseUri.Query -or $baseUri.Fragment -or [string]::IsNullOrWhiteSpace($settings.AiModel) -or
        $settings.AiTimeoutSeconds -le 0 -or $settings.AiTimeoutSeconds -gt 5) {
        throw 'Invalid local.settings.psd1: use an HTTPS base URL, a model ID and timeout > 0 and <= 5 seconds.'
    }
    $ports += 8091
}
foreach ($port in $ports) { Assert-JwzzPortFree $port }
if ($CheckOnly) {
    Write-Host 'Preflight passed: local files/settings can be read and required ports are free.'
    Write-Host 'No process was started. Database connectivity and provider API validity have NOT been tested.'
    return
}

$runName = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$logs = Join-Path $projectRoot ".local-run/$runName"
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$children = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
Write-Host "Local logs: $logs"
try {
    if ($WithAi) {
        Write-Host 'Starting Python gateway...'
        $child = Start-JwzzChild -Executable $python -Arguments @('-m', 'ai_service') `
            -WorkingDirectory $projectRoot -LogDirectory $logs -Name 'python' `
            -Environment (Get-JwzzChildEnvironment -Service Python -Credentials $credentials -Settings $settings)
        $children.Add($child)
        Wait-JwzzReady $child 'http://127.0.0.1:8091/health' -JsonHealth
    }
    Write-Host 'Starting Java backend (existing JAR; no automatic build)...'
    $child = Start-JwzzChild -Executable $java `
        -Arguments @('-jar', $jar, '--server.address=127.0.0.1', '--server.port=8080') `
        -WorkingDirectory (Join-Path $projectRoot 'server') -LogDirectory $logs -Name 'java' `
        -Environment (Get-JwzzChildEnvironment -Service Java -Database $database -Credentials $credentials)
    $children.Add($child)
    Wait-JwzzReady $child 'http://127.0.0.1:8080/api/health' -JsonHealth

    Write-Host 'Starting Next.js frontend...'
    $child = Start-JwzzChild -Executable $node `
        -Arguments @($next, 'dev', '--hostname', 'localhost', '--port', '3000') `
        -WorkingDirectory (Join-Path $projectRoot 'web') -LogDirectory $logs -Name 'web' `
        -Environment (Get-JwzzChildEnvironment -Service Web)
    $children.Add($child)
    Wait-JwzzReady $child 'http://localhost:3000'

    Write-Host 'Ready: http://localhost:3000 . Keep this terminal open; press Ctrl+C here to stop these processes.'
    if ($WithAi) { Write-Host 'AI is enabled, but the external provider has NOT been called or verified by this launcher.' }
    else { Write-Host 'Template-only mode. Python and saved AI credentials are not used.' }
    while ($true) {
        foreach ($child in $children) {
            if ($child.HasExited) { throw 'A project process exited. Check its log; the other launcher-owned processes will stop.' }
        }
        Start-Sleep -Milliseconds 500
    }
} finally {
    for ($index = $children.Count - 1; $index -ge 0; $index--) {
        try { Stop-JwzzChild $children[$index] }
        catch { Write-Warning 'Could not stop a launcher-owned process. Check this run before restarting.' }
    }
    $credentials = $null
    $database = $null
    Write-Host 'Launcher cleanup finished. Existing services (including MySQL/Redis) were not stopped.'
}
