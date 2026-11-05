param([string]$BaseUrl = 'http://127.0.0.1:8080')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\server\.env.local.ps1')
$base = $BaseUrl.TrimEnd('/')
$user = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$general = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$cardiology = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$email = "messages-$([guid]::NewGuid().ToString('N'))@example.invalid"
$password = 'MessageFlowTest123!'

function Csrf($session) { (Invoke-RestMethod "$base/api/auth/csrf" -WebSession $session).token }
function PostJson($path, $session, $body) {
    Invoke-WebRequest "$base$path" -Method Post -WebSession $session -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Csrf $session)} -Body ($body | ConvertTo-Json -Depth 6) -SkipHttpErrorCheck
}
function Login($session, $name, $secret) {
    Invoke-WebRequest "$base/api/auth/login" -Method Post -WebSession $session -ContentType 'application/x-www-form-urlencoded' -Headers @{'X-XSRF-TOKEN'=(Csrf $session)} -Body @{email=$name;password=$secret} | Out-Null
}
function Check($response, [int]$expected, [string]$label) {
    if ($response.StatusCode -ne $expected) { throw "$label expected $expected, got $($response.StatusCode): $($response.Content)" }
    Write-Output "PASS $label"
}

Check (PostJson '/api/auth/register' $user @{email=$email;password=$password}) 201 'register user'
Login $user $email $password
Login $general $env:DEMO_DOCTOR_EMAIL $env:DEMO_DOCTOR_PASSWORD
Login $cardiology 'doctor.cardiology@jwzz.local' $env:DEMO_DOCTOR_PASSWORD
Check (PostJson '/api/doctor/presence' $cardiology @{}) 204 'doctor heartbeat'
$directory = Invoke-RestMethod "$base/api/doctors" -WebSession $user
if ($directory.Count -lt 3 -or -not ($directory | Where-Object { $_.email -eq 'doctor.cardiology@jwzz.local' -and $_.online })) { throw 'Doctor directory or online presence mismatch' }
Write-Output 'PASS three specialties and online presence'

$entry = PostJson '/api/indicators' $user @{
    category='BP';measuredAt=(Get-Date).AddMinutes(-5).ToString('yyyy-MM-ddTHH:mm:ss');context='HOME';ageYears=22;pregnant=$false
    values=@{systolic_bp=@{value=130;unit='mmHg'};diastolic_bp=@{value=80;unit='mmHg'}}
}
Check $entry 201 'create indicator'
$entryId = ($entry.Content | ConvertFrom-Json).entryId
$report = PostJson '/api/reports' $user @{entryId=$entryId}
Check $report 200 'create report'
$reportId = ($report.Content | ConvertFrom-Json).id
$grant = PostJson "/api/reports/$reportId/grants" $user @{doctorEmail='doctor.cardiology@jwzz.local'}
Check $grant 200 'authorize chosen doctor'
$doctorId = ($grant.Content | ConvertFrom-Json).doctorId

$created = PostJson '/api/consultations' $user @{reportId=$reportId;doctorId=$doctorId;question=''}
Check $created 201 'submit blank consultation'
$id = ($created.Content | ConvertFrom-Json).id
$patientDetail = Invoke-RestMethod "$base/api/messages/conversations/$id" -WebSession $user
if ($patientDetail.messages.Count -ne 1 -or $patientDetail.messages[0].body -ne '您好，请帮我看看我的指标报告！') { throw 'Default greeting was not stored' }
Write-Output 'PASS default greeting and patient history'
$otherList = Invoke-RestMethod "$base/api/messages/conversations" -WebSession $general
if ($otherList | Where-Object id -eq $id) { throw 'Non-target doctor sees conversation' }
Write-Output 'PASS target-doctor isolation'
$targetList = Invoke-RestMethod "$base/api/messages/conversations" -WebSession $cardiology
if (-not ($targetList | Where-Object { $_.id -eq $id -and $_.unreadCount -eq 1 })) { throw 'Target doctor did not receive unread conversation' }
Write-Output 'PASS doctor received unread message'
Check (PostJson "/api/doctor/consultations/$id/claim" $cardiology @{}) 200 'claim conversation'
Check (PostJson "/api/messages/conversations/$id" $cardiology @{body='请记录多次测量的时间和条件，线下与医生核对。'}) 201 'doctor sends message'
Check (PostJson "/api/messages/conversations/$id" $user @{body='好的，我会准备测量记录。'}) 201 'patient continues same conversation'
$history = Invoke-RestMethod "$base/api/messages/conversations/$id" -WebSession $cardiology
if ($history.messages.Count -ne 3) { throw 'Conversation history mismatch' }
Write-Output 'PASS three-message history'
Check (PostJson "/api/messages/conversations/$id/read" $cardiology @{}) 204 'mark read'
$readList = Invoke-RestMethod "$base/api/messages/conversations" -WebSession $cardiology
if (($readList | Where-Object id -eq $id).unreadCount -ne 0) { throw 'Unread count did not clear' }
Write-Output 'PASS unread count cleared'

$revoke = Invoke-WebRequest "$base/api/reports/$reportId/grants/$doctorId" -Method Delete -WebSession $user -Headers @{'X-XSRF-TOKEN'=(Csrf $user)} -SkipHttpErrorCheck
Check $revoke 204 'revoke report access'
$after = Invoke-RestMethod "$base/api/messages/conversations" -WebSession $cardiology
if ($after | Where-Object id -eq $id) { throw 'Doctor retains revoked conversation' }
Write-Output 'PASS revoked conversation hidden from doctor'
Check (PostJson "/api/messages/conversations/$id" $cardiology @{body='撤销后不应发送。'}) 404 'revoked doctor cannot send'
Check (PostJson "/api/messages/conversations/$id" $user @{body='撤销后不应发送。'}) 409 'patient cannot send after revoke'
Write-Output 'Message flow acceptance checks passed.'
