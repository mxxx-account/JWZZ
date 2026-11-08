param([string]$RunName = ('quality-' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
$ErrorActionPreference = 'Stop'
if ($RunName -notmatch '^quality-[a-zA-Z0-9-]+$') { throw 'Invalid run name' }
$projectRoot = Split-Path $PSScriptRoot -Parent
$recordDir = Join-Path $projectRoot "reports/$RunName"
if (Test-Path $recordDir) { throw 'Run directory already exists; choose a new RunName to preserve evidence' }
New-Item -ItemType Directory -Path $recordDir -Force | Out-Null
$results = [System.Collections.Generic.List[object]]::new()
. (Join-Path $projectRoot 'server/.env.local.ps1')
$env:JWZZ_IT_DB_URL = $env:DB_URL

function Check([string]$Name, [string]$Directory, [scriptblock]$Action) {
    $start = [DateTimeOffset]::Now
    $code = 0
    $global:LASTEXITCODE = 0
    Push-Location (Join-Path $projectRoot $Directory)
    try {
        & $Action 2>&1 | Tee-Object -FilePath (Join-Path $recordDir "$Name.log")
        $code = $LASTEXITCODE
    } catch {
        $_.Exception.Message | Tee-Object -FilePath (Join-Path $recordDir "$Name.log") -Append
        $code = 1
    } finally { Pop-Location }
    $results.Add([pscustomobject]@{ name=$Name; exitCode=$code; seconds=[math]::Round(([DateTimeOffset]::Now-$start).TotalSeconds,2) })
    $results | ConvertTo-Json -Depth 4 | Out-File (Join-Path $recordDir 'results.json') -Encoding utf8
    Write-Output "CHECK $Name exit=$code"
}

Check 'backend' 'server' { mvn -o test }
foreach ($script in @('verify_stage2','verify_stage3','verify_stage4','verify_stage5','verify_messages')) {
    Check $script '.' { & (Join-Path $PSScriptRoot "$script.ps1") }
}
Check 'typecheck' 'web' { npm run typecheck }
Check 'browser' 'web' { npm run test:e2e -- --workers=3 }
$results | Format-Table
if (@($results | Where-Object exitCode -ne 0).Count -gt 0) { exit 1 }
