# Run only against the local project's MySQL database. No frontend, Redis or model is required.
param(
    [switch]$Full,
    [string]$MavenSettings,
    [string]$MavenRepository
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$localConfig = Join-Path $projectRoot 'server/.env.local.ps1'
if (-not (Test-Path -LiteralPath $localConfig)) { throw 'Set up server/.env.local.ps1 first (see docs/development.md).' }

$previousDb = @{}
foreach ($name in @('DB_URL', 'DB_USER', 'DB_PASSWORD', 'JWZZ_IT_DB_URL')) {
    $previousDb[$name] = [Environment]::GetEnvironmentVariable($name)
}
try {
    . $localConfig
    if ($env:DB_URL -notmatch '^jdbc:mysql://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/[^?;]+' -or -not $env:DB_USER -or -not $env:DB_PASSWORD) {
        throw 'Configure DB_URL, DB_USER and DB_PASSWORD for the local MySQL database.'
    }
    $env:JWZZ_IT_DB_URL = $env:DB_URL
    $projectCache = Join-Path $projectRoot '.maven-repository'
    $userSettings = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.m2/settings.xml'
    if (-not $MavenSettings -and -not $MavenRepository -and
        (Test-Path -LiteralPath $projectCache) -and (Test-Path -LiteralPath $userSettings)) {
        $MavenSettings = $userSettings
        $MavenRepository = $projectCache
    }
    $mavenArgs = @('-o', '-f', (Join-Path $projectRoot 'server/pom.xml'))
    if ($MavenSettings) { $mavenArgs += @('-s', $MavenSettings) }
    if ($MavenRepository) { $mavenArgs += "-Dmaven.repo.local=$MavenRepository" }
    if (-not $Full) { $mavenArgs += '-Dtest=ReportEvidenceIntegrationTest' }
    $mavenArgs += 'test'
    & mvn @mavenArgs
    if ($LASTEXITCODE -ne 0) { throw "Maven verification failed with exit code $LASTEXITCODE." }
} finally {
    foreach ($name in $previousDb.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousDb[$name])
    }
}
