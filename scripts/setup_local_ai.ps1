#Requires -Version 7.4
[CmdletBinding()]
param([switch]$UpdateApiKey, [switch]$Reset)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local_launcher_common.ps1')
if ($UpdateApiKey -and $Reset) { throw 'Choose either -UpdateApiKey or -Reset.' }
$credentialPath = Get-JwzzCredentialPath
$exists = Test-Path -LiteralPath $credentialPath
if ($exists -and -not $UpdateApiKey -and -not $Reset) {
    Write-Host 'Credentials already exist. Nothing changed. Use -UpdateApiKey to change only the provider key.'
    return
}
if ($Reset -and $exists) {
    $answer = Read-Host 'Replace BOTH saved credentials? Stop your project first. Type YES to confirm'
    if ($answer -cne 'YES') { Write-Host 'Cancelled. Nothing changed.'; return }
}
$previous = if ($exists -and -not $Reset) { Read-JwzzCredentials $credentialPath } else { $null }
$apiKey = Read-Host 'Paste your complete DeepSeek API key (input is hidden)' -AsSecureString
$sharedToken = if ($null -ne $previous) { $previous.SharedToken } else { New-JwzzSharedToken }
try {
    Write-JwzzCredentials -Path $credentialPath -ApiKey $apiKey -SharedToken $sharedToken
    Write-Host "Saved Windows-encrypted credentials to: $credentialPath"
    Write-Host 'No API request was made. The random internal token is managed automatically.'
    Write-Host 'Next: .\scripts\start_local.ps1 -WithAi -CheckOnly'
} finally {
    $apiKey = $null
    $sharedToken = $null
    $previous = $null
}
