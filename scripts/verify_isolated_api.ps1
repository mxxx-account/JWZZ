$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
. (Join-Path $projectRoot 'server/.env.local.ps1')
$base='http://127.0.0.1:8082'
$session=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
$token=(Invoke-RestMethod "$base/api/auth/csrf" -WebSession $session).token
$doctors=@(
  @{email='doctor@jwzz.local';name='隔离全科医生';specialty='GENERAL'},
  @{email='doctor.cardiology@jwzz.local';name='隔离心内医生';specialty='CARDIOLOGY'},
  @{email='doctor.endocrinology@jwzz.local';name='隔离内分泌医生';specialty='ENDOCRINOLOGY'}
)
foreach ($doctor in $doctors) {
  $body=@{email=$doctor.email;name=$doctor.name;specialty=$doctor.specialty;role='DOCTOR';password=$env:DEMO_DOCTOR_PASSWORD}
  $response=Invoke-WebRequest "$base/api/auth/register" -Method Post -WebSession $session -Headers @{'X-XSRF-TOKEN'=$token} -ContentType 'application/json' -Body ($body | ConvertTo-Json) -SkipHttpErrorCheck
  if ($response.StatusCode -notin @(201,409)) { throw "Seed doctor returned $($response.StatusCode)" }
}
foreach ($script in @('verify_stage2','verify_stage3','verify_stage4','verify_stage5','verify_messages')) {
  & (Join-Path $PSScriptRoot "$script.ps1") -BaseUrl $base
  Write-Output "ISOLATED PASS $script"
}
