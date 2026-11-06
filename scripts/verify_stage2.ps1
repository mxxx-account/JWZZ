# Run while the local Spring Boot server is started with the dev profile.
param([string]$BaseUrl = 'http://127.0.0.1:8080')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\server\.env.local.ps1')
# Load the WebCmdlets assembly before resolving WebRequestSession's type.
Get-Command Invoke-WebRequest | Out-Null
$base = $BaseUrl.TrimEnd('/')
$userEmail = "acceptance-$([guid]::NewGuid().ToString('N'))@example.invalid"
$userPassword = 'StageTwoTest123!'
$userSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$doctorSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()

function Csrf([Microsoft.PowerShell.Commands.WebRequestSession]$session) {
    (Invoke-RestMethod "$base/api/auth/csrf" -WebSession $session).token
}
function Login([Microsoft.PowerShell.Commands.WebRequestSession]$session, [string]$email, [string]$password) {
    $token = Csrf $session
    Invoke-WebRequest "$base/api/auth/login" -Method Post -WebSession $session -ContentType 'application/x-www-form-urlencoded' -Headers @{'X-XSRF-TOKEN'=$token} -Body @{email=$email;password=$password} | Out-Null
}
function AssertStatus([int]$actual, [int]$expected, [string]$case) {
    if ($actual -ne $expected) { throw "$case expected $expected, got $actual" }
    Write-Output "PASS $case ($actual)"
}

$anonymous = Invoke-WebRequest "$base/api/reports" -SkipHttpErrorCheck
AssertStatus $anonymous.StatusCode 401 'anonymous reports denied'

$token = Csrf $userSession
$register = Invoke-WebRequest "$base/api/auth/register" -Method Post -WebSession $userSession -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=$token} -Body (@{email=$userEmail;password=$userPassword;name='测试用户';role='USER'} | ConvertTo-Json) -SkipHttpErrorCheck
AssertStatus $register.StatusCode 201 'user registration'
Login $userSession $userEmail $userPassword
$me = Invoke-RestMethod "$base/api/auth/me" -WebSession $userSession
if ($me.role -ne 'USER') { throw 'Registration created unexpected role' }
Write-Output 'PASS user session'

$token = Csrf $userSession
$measurement = @{
    category='BP'; measuredAt=(Get-Date).AddMinutes(-5).ToString('yyyy-MM-ddTHH:mm:ss')
    context='HOME'; ageYears=22; pregnant=$false
    values=@{systolic_bp=@{value=130;unit='mmHg'};diastolic_bp=@{value=80;unit='mmHg'}}
} | ConvertTo-Json -Depth 5
$entry = Invoke-RestMethod "$base/api/indicators" -Method Post -WebSession $userSession -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=$token} -Body $measurement
$report = Invoke-RestMethod "$base/api/reports" -Method Post -WebSession $userSession -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Csrf $userSession)} -Body (@{entryId=$entry.entryId} | ConvertTo-Json)
$reportId = $report.id
Write-Output "PASS indicator report created (id=$reportId)"

Login $doctorSession $env:DEMO_DOCTOR_EMAIL $env:DEMO_DOCTOR_PASSWORD
$doctorMe = Invoke-RestMethod "$base/api/auth/me" -WebSession $doctorSession
if ($doctorMe.role -ne 'DOCTOR') { throw 'Doctor role missing' }
$before = Invoke-WebRequest "$base/api/reports/$reportId" -WebSession $doctorSession -SkipHttpErrorCheck
AssertStatus $before.StatusCode 404 'ungranted doctor denied'

$token = Csrf $userSession
$grant = Invoke-RestMethod "$base/api/reports/$reportId/grants" -Method Post -WebSession $userSession -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=$token} -Body (@{doctorEmail=$env:DEMO_DOCTOR_EMAIL} | ConvertTo-Json)
$during = Invoke-WebRequest "$base/api/reports/$reportId" -WebSession $doctorSession -SkipHttpErrorCheck
AssertStatus $during.StatusCode 200 'granted doctor allowed'

$token = Csrf $userSession
$revoke = Invoke-WebRequest "$base/api/reports/$reportId/grants/$($grant.doctorId)" -Method Delete -WebSession $userSession -Headers @{'X-XSRF-TOKEN'=$token} -SkipHttpErrorCheck
AssertStatus $revoke.StatusCode 204 'grant revoked'
$activeGrants = Invoke-WebRequest "$base/api/reports/$reportId/grants" -WebSession $userSession
if ($activeGrants.Content.Trim() -ne '[]') { throw 'Revoked grant still visible to patient' }
Write-Output 'PASS revoked grant removed from patient list'
$after = Invoke-WebRequest "$base/api/reports/$reportId" -WebSession $doctorSession -SkipHttpErrorCheck
AssertStatus $after.StatusCode 404 'revoked doctor denied'

$doctorCreate = Invoke-WebRequest "$base/api/reports" -Method Post -WebSession $doctorSession -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Csrf $doctorSession)} -Body (@{entryId=$entry.entryId} | ConvertTo-Json) -SkipHttpErrorCheck
AssertStatus $doctorCreate.StatusCode 403 'doctor cannot create patient report'

$otherSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$otherEmail = "acceptance-$([guid]::NewGuid().ToString('N'))@example.invalid"
$otherToken = Csrf $otherSession
$otherRegister = Invoke-WebRequest "$base/api/auth/register" -Method Post -WebSession $otherSession -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=$otherToken} -Body (@{email=$otherEmail;password=$userPassword;name='其他测试用户';role='USER'} | ConvertTo-Json) -SkipHttpErrorCheck
AssertStatus $otherRegister.StatusCode 201 'second user registration'
Login $otherSession $otherEmail $userPassword
$otherRead = Invoke-WebRequest "$base/api/reports/$reportId" -WebSession $otherSession -SkipHttpErrorCheck
AssertStatus $otherRead.StatusCode 404 'other user cannot read report'
$otherGrant = Invoke-WebRequest "$base/api/reports/$reportId/grants" -Method Post -WebSession $otherSession -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Csrf $otherSession)} -Body (@{doctorEmail=$env:DEMO_DOCTOR_EMAIL} | ConvertTo-Json) -SkipHttpErrorCheck
AssertStatus $otherGrant.StatusCode 404 'other user cannot grant report'

# PowerShell persists request headers in WebRequestSession; remove the prior token explicitly.
[void]$userSession.Headers.Remove('X-XSRF-TOKEN')
$noCsrf = Invoke-WebRequest "$base/api/reports" -Method Post -WebSession $userSession -ContentType 'application/json' -Body (@{entryId=$entry.entryId} | ConvertTo-Json) -SkipHttpErrorCheck
AssertStatus $noCsrf.StatusCode 403 'mutation without CSRF token denied'
$logout = Invoke-WebRequest "$base/api/auth/logout" -Method Post -WebSession $userSession -Headers @{'X-XSRF-TOKEN'=(Csrf $userSession)} -SkipHttpErrorCheck
AssertStatus $logout.StatusCode 204 'logout'
$afterLogout = Invoke-WebRequest "$base/api/auth/me" -WebSession $userSession -SkipHttpErrorCheck
AssertStatus $afterLogout.StatusCode 401 'logged out session denied'
Write-Output 'Stage 2 API acceptance checks passed.'
