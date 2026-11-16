#Requires -Version 7.4
[CmdletBinding()]
param([ValidateSet('Web', 'Java', 'Python', 'EarlyExit', 'Health')][string]$ChildProbe)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local_launcher_common.ps1')

function Assert-Test([bool]$Condition, [string]$Label) {
    if (-not $Condition) { throw "FAIL: $Label" }
}

# A harmless child exercises real process environments, not just hashtable construction.
if ($ChildProbe) {
    if ($ChildProbe -eq 'EarlyExit') { exit 7 }
    if ($ChildProbe -eq 'Health') {
        $server = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
        try {
            $server.Start()
            Write-Output "HEALTH_PORT:$($server.LocalEndpoint.Port)"
            while ($true) {
                $client = $server.AcceptTcpClient()
                try {
                    $stream = $client.GetStream()
                    $reader = [System.IO.StreamReader]::new($stream)
                    do { $line = $reader.ReadLine() } while (-not [string]::IsNullOrEmpty($line))
                    $body = '{"status":"ok"}'
                    $reply = [System.Text.Encoding]::ASCII.GetBytes(
                        "HTTP/1.1 200 OK`r`nContent-Type: application/json`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n$body")
                    $stream.Write($reply, 0, $reply.Length)
                    $stream.Flush()
                } finally { $client.Dispose() }
            }
        } finally { $server.Stop() }
        return
    }
    Assert-Test (-not $env:UNRELATED_API_KEY) 'unrelated inherited key removed'
    switch ($ChildProbe) {
        'Web' {
            Assert-Test (-not $env:JWZZ_AI_API_KEY -and -not $env:JWZZ_AGENT_SHARED_TOKEN -and
                -not $env:DB_PASSWORD -and -not $env:DEMO_DOCTOR_PASSWORD) 'web receives no app credentials'
            Assert-Test ($env:NEXT_PUBLIC_API_BASE_URL -eq 'http://localhost:8080') 'web API URL'
        }
        'Java' {
            Assert-Test (-not $env:JWZZ_AI_API_KEY) 'Java receives no provider key'
            Assert-Test ($env:DB_PASSWORD -eq 'SyntheticDatabaseOnly') 'Java receives database configuration'
            Assert-Test ($env:JWZZ_AGENT_SHARED_TOKEN -eq 'SyntheticTokenOnly') 'Java receives shared token'
            Assert-Test ($env:JWZZ_AGENT_MODEL_ENABLED -eq 'true') 'Java model enabled'
        }
        'Python' {
            Assert-Test (-not $env:DB_PASSWORD -and -not $env:DEMO_DOCTOR_PASSWORD) 'Python receives no database credentials'
            Assert-Test ($env:JWZZ_AI_API_KEY -eq 'SyntheticUpdatedKeyOnly') 'Python receives provider key'
            Assert-Test ($env:JWZZ_AGENT_SHARED_TOKEN -eq 'SyntheticTokenOnly') 'Python receives same shared token'
        }
    }
    Write-Output 'CHILD_ENVIRONMENT_OK'
    Start-Sleep -Seconds 30
    exit 0
}

$projectRoot = Split-Path $PSScriptRoot -Parent
$runRoot = Join-Path $projectRoot '.local-run'
$testFolder = Join-Path $runRoot ('launcher verify ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testFolder -Force | Out-Null
$credentialPath = Join-Path $testFolder 'secrets/ai-credentials.clixml'
$before = [System.Environment]::GetEnvironmentVariables('Process')
$passed = 0
$children = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
function Pass([string]$Label) { $script:passed++; Write-Host "PASS $script:passed - $Label" }
try {
    foreach ($name in @('local_launcher_common.ps1', 'setup_local_ai.ps1', 'start_local.ps1', 'verify_local_launcher.ps1')) {
        $errors = $null
        [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$null, [ref]$errors) | Out-Null
        Assert-Test ($errors.Count -eq 0) "parse $name"
    }
    Pass 'All launcher scripts parse successfully'
    $settings = Import-PowerShellDataFile (Join-Path $PSScriptRoot 'local.settings.psd1')
    Assert-Test ($settings.AiBaseUrl.StartsWith('https://') -and $settings.AiTimeoutSeconds -le 5) 'public settings'
    Pass 'Public settings load without credentials'

    $key = ConvertTo-SecureString 'SyntheticProviderKeyOnly' -AsPlainText -Force
    $token = ConvertTo-SecureString 'SyntheticTokenOnly' -AsPlainText -Force
    Write-JwzzCredentials $credentialPath $key $token
    $xml = Get-Content -LiteralPath $credentialPath -Raw
    Assert-Test (-not $xml.Contains('SyntheticProviderKeyOnly') -and -not $xml.Contains('SyntheticTokenOnly')) 'encrypted XML'
    Pass 'Saved credential XML contains neither plaintext credential'
    $saved = Read-JwzzCredentials $credentialPath
    Assert-Test ([System.Net.NetworkCredential]::new('', $saved.ApiKey).Password -eq 'SyntheticProviderKeyOnly') 'DPAPI round trip'
    Pass 'Current Windows user can decrypt saved credentials'
    $acl = Get-Acl -LiteralPath (Split-Path $credentialPath -Parent)
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    Assert-Test ($acl.AreAccessRulesProtected -and $acl.Access.Count -eq 1 -and
        $acl.Access[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]) -eq $sid) 'directory ACL'
    Pass 'Credential directory access restricted to current user'

    $updatedKey = ConvertTo-SecureString 'SyntheticUpdatedKeyOnly' -AsPlainText -Force
    Write-JwzzCredentials $credentialPath $updatedKey $saved.SharedToken
    $saved = Read-JwzzCredentials $credentialPath
    Assert-Test ([System.Net.NetworkCredential]::new('', $saved.ApiKey).Password -eq 'SyntheticUpdatedKeyOnly' -and
        [System.Net.NetworkCredential]::new('', $saved.SharedToken).Password -eq 'SyntheticTokenOnly') 'update key only'
    Pass 'Key replacement preserves the internal shared token'
    $rejected = $false
    try { Write-JwzzCredentials $credentialPath (ConvertTo-SecureString 'masked***value' -AsPlainText -Force) $token }
    catch { $rejected = $true }
    Assert-Test $rejected 'masked key rejected'
    Assert-Test ([System.Net.NetworkCredential]::new('', (Read-JwzzCredentials $credentialPath).ApiKey).Password -eq 'SyntheticUpdatedKeyOnly') 'saved key unchanged'
    Pass 'Masked key rejected without overwriting existing credentials'
    $rejected = $false
    try { Write-JwzzCredentials $credentialPath ([securestring]::new()) $token } catch { $rejected = $true }
    Assert-Test $rejected 'empty key rejected'
    Pass 'Empty credential rejected'
    $rejected = $false
    try { Read-JwzzCredentials (Join-Path $testFolder 'missing.clixml') | Out-Null } catch { $rejected = $true }
    Assert-Test $rejected 'missing credentials rejected'
    Pass 'Missing credential file produces a setup error'
    $invalidPath = Join-Path $testFolder 'invalid.clixml'
    [pscustomobject]@{ Version = 1; ApiKey = 'not-secure'; SharedToken = 'not-secure' } | Export-Clixml -LiteralPath $invalidPath
    $rejected = $false
    try { Read-JwzzCredentials $invalidPath | Out-Null } catch { $rejected = $true }
    Assert-Test $rejected 'malformed credentials rejected'
    Pass 'Plaintext/invalid credential schema is refused'
    $random1 = [System.Net.NetworkCredential]::new('', (New-JwzzSharedToken)).Password
    $random2 = [System.Net.NetworkCredential]::new('', (New-JwzzSharedToken)).Password
    Assert-Test ($random1.Length -ge 48 -and $random1 -ne $random2) 'random token generation'
    Pass 'Shared tokens are generated randomly'

    $env:DB_PASSWORD = 'ParentDatabaseSentinel'
    $env:JWZZ_AI_API_KEY = 'ParentApiKeySentinel'
    $env:JWZZ_AGENT_SHARED_TOKEN = 'ParentTokenSentinel'
    $env:UNRELATED_API_KEY = 'ParentUnrelatedKeySentinel'
    $snapshot = [System.Environment]::GetEnvironmentVariables('Process')
    $database = Get-JwzzDatabaseEnvironment (Join-Path $PSScriptRoot 'tests/launcher_database_fixture.ps1')
    $after = [System.Environment]::GetEnvironmentVariables('Process')
    $changedNames = (Compare-Object @($snapshot.Keys) @($after.Keys) | ForEach-Object { $_.InputObject }) -join ', '
    Assert-Test ($after.Count -eq $snapshot.Count) "environment count restored (different names: $changedNames)"
    foreach ($name in $snapshot.Keys) { Assert-Test ($after[$name] -ceq $snapshot[$name]) 'parent environment restored' }
    Assert-Test (-not $database.ContainsKey('JWZZ_AGENT_SHARED_TOKEN')) 'database setting allowlist'
    Pass 'Database configuration is captured without changing the parent environment'
    $template = Get-JwzzChildEnvironment -Service Java -Database $database
    Assert-Test ($template.JWZZ_AGENT_MODEL_ENABLED -eq 'false' -and -not $template.JWZZ_AGENT_SHARED_TOKEN -and
        -not $template.JWZZ_AI_API_KEY) 'template mode isolation'
    Pass 'Template-only Java disables AI and removes inherited AI secrets'

    $pwsh = (Get-Process -Id $PID).Path
    foreach ($service in @('Web', 'Java', 'Python')) {
        $overrides = Get-JwzzChildEnvironment -Service $service -Database $database -Credentials $saved -Settings $settings
        $child = Start-JwzzChild -Executable $pwsh `
            -Arguments @('-NoProfile', '-File', $PSCommandPath, '-ChildProbe', $service) `
            -WorkingDirectory $testFolder -Environment $overrides -LogDirectory $testFolder -Name $service
        $children.Add($child)
        $deadline = [datetime]::UtcNow.AddSeconds(10)
        $log = Join-Path $testFolder "$service.log"
        $ready = $false
        do {
            Start-Sleep -Milliseconds 100
            if ((Test-Path -LiteralPath $log) -and (Get-Content -LiteralPath $log -Raw) -match 'CHILD_ENVIRONMENT_OK') { $ready = $true }
        } until ($ready -or $child.HasExited -or [datetime]::UtcNow -ge $deadline)
        Assert-Test $ready "$service real child environment and quoted file paths"
        Pass "$service child receives only the intended application credentials"
        $childId = $child.Id
        Stop-JwzzChild $child
        $children.Remove($child) | Out-Null
        Assert-Test ($null -eq (Get-Process -Id $childId -ErrorAction SilentlyContinue)) 'child stopped'
    }
    Pass 'All three test children stopped without touching existing services'

    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        $port = $listener.LocalEndpoint.Port
        $rejected = $false
        try { Assert-JwzzPortFree $port } catch { $rejected = $true }
        Assert-Test $rejected 'occupied port rejected'
        Assert-Test $listener.Server.IsBound 'existing listener untouched'
    } finally { $listener.Stop() }
    Assert-JwzzPortFree $port
    Pass 'Busy port refused without stopping its owner; free port accepted'

    $child = Start-JwzzChild -Executable $pwsh -Arguments @('-NoProfile', '-File', $PSCommandPath, '-ChildProbe', 'Health') `
        -WorkingDirectory $testFolder -Environment (Get-JwzzChildEnvironment Web) -LogDirectory $testFolder -Name 'health'
    $children.Add($child)
    $deadline = [datetime]::UtcNow.AddSeconds(10)
    $probePort = 0
    do {
        Start-Sleep -Milliseconds 100
        $log = Join-Path $testFolder 'health.log'
        if ((Test-Path -LiteralPath $log) -and (Get-Content -LiteralPath $log -Raw) -match 'HEALTH_PORT:(\d+)') {
            $probePort = [int]$Matches[1]
        }
    } until ($probePort -gt 0 -or $child.HasExited -or [datetime]::UtcNow -ge $deadline)
    Assert-Test ($probePort -gt 0) 'fake local health server startup'
    Wait-JwzzReady $child "http://127.0.0.1:$probePort/health" -JsonHealth
    Wait-JwzzReady $child "http://127.0.0.1:$probePort/"
    Pass 'HTTP and JSON readiness probes succeed against an isolated local fake service'

    $child = Start-JwzzChild -Executable $pwsh -Arguments @('-NoProfile', '-File', $PSCommandPath, '-ChildProbe', 'EarlyExit') `
        -WorkingDirectory $testFolder -Environment (Get-JwzzChildEnvironment Web) -LogDirectory $testFolder -Name 'exit'
    $children.Add($child)
    $child.WaitForExit(10000) | Out-Null
    $rejected = $false
    try { Wait-JwzzReady $child 'http://127.0.0.1:1/health' -JsonHealth } catch { $rejected = $true }
    Assert-Test ($rejected -and $child.HasExited) 'early exit detected'
    Pass 'Readiness check detects a process that exited before becoming healthy'

    Write-Host "RESULT: $passed checks passed. No real credentials, database or external API were used."
} finally {
    foreach ($child in $children) { Stop-JwzzChild $child }
    foreach ($name in @([System.Environment]::GetEnvironmentVariables('Process').Keys)) {
        if (-not $before.Contains($name)) { [System.Environment]::SetEnvironmentVariable($name, [NullString]::Value, 'Process') }
    }
    foreach ($name in $before.Keys) { [System.Environment]::SetEnvironmentVariable($name, $before[$name], 'Process') }
    # Delete only this test's GUID-named temporary directory beneath the project log folder.
    $resolvedTest = [System.IO.Path]::GetFullPath($testFolder)
    $allowedRoot = [System.IO.Path]::GetFullPath($runRoot) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolvedTest.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing cleanup outside the test log directory.'
    }
    Remove-Item -LiteralPath $resolvedTest -Recurse -Force
}
