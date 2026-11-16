# Shared by setup/start/verification scripts. Requires Windows and PowerShell 7.4+.
Set-StrictMode -Version Latest

function Get-JwzzCredentialPath {
    if (-not $IsWindows) { throw 'This launcher requires Windows.' }
    Join-Path $env:LOCALAPPDATA 'JWZZ/ai-credentials.clixml'
}

function Read-JwzzCredentials([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw 'AI credentials not found. Run scripts/setup_local_ai.ps1 first.'
    }
    try {
        $saved = Import-Clixml -LiteralPath $Path
        if ($saved.Version -ne 1 -or $saved.ApiKey -isnot [securestring] -or
            $saved.SharedToken -isnot [securestring] -or
            $saved.ApiKey.Length -eq 0 -or $saved.SharedToken.Length -eq 0) {
            throw 'Invalid credential format.'
        }
        return $saved
    } catch {
        throw 'Cannot decrypt credentials. Use the original Windows account/computer, or run setup_local_ai.ps1 -Reset.'
    }
}

function Write-JwzzCredentials([string]$Path, [securestring]$ApiKey, [securestring]$SharedToken) {
    if (-not $IsWindows) { throw 'Encrypted credential storage requires Windows DPAPI.' }
    if ($null -eq $ApiKey -or $ApiKey.Length -eq 0 -or $null -eq $SharedToken -or $SharedToken.Length -eq 0) {
        throw 'Credentials cannot be empty.'
    }
    $plain = [System.Net.NetworkCredential]::new('', $ApiKey).Password
    try {
        if ($plain -notmatch '^[\x21-\x7E]{1,4096}$' -or $plain.Contains('*')) {
            throw 'Use the complete API key, not a masked value; do not include spaces or line breaks.'
        }
    } finally { $plain = $null }

    $folder = Split-Path $Path -Parent
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
    # Only this Windows user can access the credential directory by default.
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    # Modify only the DACL. Creating a fresh security descriptor can unnecessarily
    # request audit/owner privileges when an existing credential folder is reused.
    $acl = Get-Acl -LiteralPath $folder
    $alreadyRestricted = $acl.AreAccessRulesProtected -and $acl.Access.Count -eq 1 -and
        $acl.Access[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]) -eq $sid -and
        $acl.Access[0].FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::FullControl
    if (-not $alreadyRestricted) {
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($rule in $acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier])) {
            $acl.RemoveAccessRuleSpecific($rule)
        }
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))
        Set-Acl -LiteralPath $folder -AclObject $acl
    }
    $verifiedAcl = Get-Acl -LiteralPath $folder
    if (-not $verifiedAcl.AreAccessRulesProtected -or $verifiedAcl.Access.Count -ne 1 -or
        $verifiedAcl.Access[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]) -ne $sid) {
        throw 'Cannot restrict the credential directory to the current Windows user. No credentials were saved.'
    }

    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [pscustomobject]@{ Version = 1; ApiKey = $ApiKey; SharedToken = $SharedToken } |
            Export-Clixml -LiteralPath $temporary
        Read-JwzzCredentials $temporary | Out-Null
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function New-JwzzSharedToken {
    $bytes = [byte[]]::new(36)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force
}

function Get-JwzzDatabaseEnvironment([string]$ConfigPath) {
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        throw 'Missing server/.env.local.ps1. Copy server/env.example.ps1 and fill in local database settings first.'
    }
    $before = [System.Environment]::GetEnvironmentVariables('Process')
    try {
        . $ConfigPath | Out-Null
        $database = @{}
        foreach ($name in @('DB_URL', 'DB_USER', 'DB_PASSWORD', 'JWZZ_REDIS_ENABLED',
            'REDIS_HOST', 'REDIS_PORT', 'DEMO_DOCTOR_EMAIL', 'DEMO_DOCTOR_PASSWORD')) {
            $value = [System.Environment]::GetEnvironmentVariable($name, 'Process')
            if ($null -ne $value) { $database[$name] = $value }
        }
        foreach ($name in @('DB_URL', 'DB_USER', 'DB_PASSWORD')) {
            if (-not $database.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($database[$name])) {
                throw "Missing database setting: $name"
            }
        }
        return $database
    } finally {
        foreach ($name in @([System.Environment]::GetEnvironmentVariables('Process').Keys)) {
            if (-not $before.Contains($name)) {
                # NullString prevents PowerShell coercing $null to an empty string.
                [System.Environment]::SetEnvironmentVariable($name, [NullString]::Value, 'Process')
            }
        }
        foreach ($name in $before.Keys) {
            [System.Environment]::SetEnvironmentVariable($name, $before[$name], 'Process')
        }
    }
}

function Get-JwzzChildEnvironment {
    param(
        [ValidateSet('Web', 'Java', 'Python')][string]$Service,
        [hashtable]$Database = @{}, $Credentials = $null, [hashtable]$Settings = @{}
    )
    $values = @{}
    # Strip inherited app credentials, including leftovers from manual startup terminals.
    foreach ($name in [System.Environment]::GetEnvironmentVariables('Process').Keys) {
        if ($name -match '^(DB_|DEMO_DOCTOR_|REDIS_|JWZZ_|SPRING_|MYSQL_PWD$|NEXT_PUBLIC_API_BASE_URL$)' -or
            $name -match '(API_?KEY|PASSWORD|SECRET|TOKEN)') {
            $values[$name] = $null
        }
    }
    switch ($Service) {
        'Web' {
            $values.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:8080'
            $values.NEXT_TELEMETRY_DISABLED = '1'
        }
        'Java' {
            foreach ($name in $Database.Keys) { $values[$name] = $Database[$name] }
            $values.SPRING_PROFILES_ACTIVE = 'dev'
            $values.JWZZ_AGENT_MODEL_ENABLED = if ($null -ne $Credentials) { 'true' } else { 'false' }
            $values.JWZZ_AGENT_URL = 'http://127.0.0.1:8091/v1/report-draft'
            $values.JWZZ_AGENT_TIMEOUT_MS = '7000'
            if ($null -ne $Credentials) {
                $values.JWZZ_AGENT_SHARED_TOKEN = [System.Net.NetworkCredential]::new('', $Credentials.SharedToken).Password
            }
        }
        'Python' {
            if ($null -eq $Credentials) { throw 'Python requires saved AI credentials.' }
            $values.JWZZ_AGENT_SHARED_TOKEN = [System.Net.NetworkCredential]::new('', $Credentials.SharedToken).Password
            $values.JWZZ_AI_API_KEY = [System.Net.NetworkCredential]::new('', $Credentials.ApiKey).Password
            $values.JWZZ_AI_BASE_URL = $Settings.AiBaseUrl
            $values.JWZZ_AI_MODEL = $Settings.AiModel
            $values.JWZZ_AI_TIMEOUT_SECONDS = [string]$Settings.AiTimeoutSeconds
            $values.JWZZ_AI_ALLOW_LOCAL_PROVIDER = 'false'
            $values.JWZZ_AI_PORT = '8091'
        }
    }
    return $values
}

function Assert-JwzzPortFree([int]$Port) {
    $ports = @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        ForEach-Object { $_.Port })
    if ($ports -contains $Port) {
        throw "Port $Port is already in use. Stop your old project instance yourself, then retry. No existing process was stopped."
    }
}

function Start-JwzzChild {
    param([string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory,
        [hashtable]$Environment, [string]$LogDirectory, [string]$Name)
    # Credentials are passed via a child-only environment, never through command arguments.
    $quoted = foreach ($argument in $Arguments) {
        if ($argument.Contains('"')) { throw 'Unexpected quote in a startup argument.' }
        '"' + $argument + '"'
    }
    Start-Process -FilePath $Executable -ArgumentList $quoted -WorkingDirectory $WorkingDirectory `
        -Environment $Environment -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $LogDirectory "$Name.log") `
        -RedirectStandardError (Join-Path $LogDirectory "$Name.error.log")
}

function Stop-JwzzChild([System.Diagnostics.Process]$Process) {
    if (-not $Process.HasExited) {
        $Process.Kill($true)
        $Process.WaitForExit(5000) | Out-Null
    }
    $Process.Dispose()
}

function Wait-JwzzReady {
    param([System.Diagnostics.Process]$Process, [string]$Url, [switch]$JsonHealth)
    $deadline = [datetime]::UtcNow.AddSeconds(90)
    while ([datetime]::UtcNow -lt $deadline) {
        if ($Process.HasExited) { throw 'A project process exited during startup. Check its local log.' }
        try {
            $response = Invoke-WebRequest -Uri $Url -NoProxy -TimeoutSec 2
            if ($response.StatusCode -eq 200 -and
                (-not $JsonHealth -or ($response.Content | ConvertFrom-Json).status -eq 'ok')) { return }
        } catch { # Retry only local readiness probes; no provider calls are made.
        }
        Start-Sleep -Milliseconds 400
    }
    throw "Startup timed out: $Url. Check the local log; the launcher will stop only its own processes."
}
