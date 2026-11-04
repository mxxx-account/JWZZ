# Run while the local Spring Boot server is started with the dev profile.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\server\.env.local.ps1')
# Load the WebCmdlets assembly before resolving WebRequestSession's type.
Get-Command Invoke-WebRequest | Out-Null
$base = 'http://127.0.0.1:8080'
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
$register = Invoke-WebRequest "$base/api/auth/register" -Method Post -WebSession $userSession -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=$token} -Body (@{email=$userEmail;password=$userPassword} | ConvertTo-Json) -SkipHttpErrorCheck
AssertStatus $register.StatusCode 201 'user registration'
Login $userSession $userEmail $userPassword
$me = Invoke-RestMethod "$base/api/auth/me" -WebSession $userSession
if ($me.role -ne 'USER') { throw 'Registration created unexpected role' }
Write-Output 'PASS user session'

$token = Csrf $userSession
$demo = Invoke-RestMethod "$base/api/dev/reports" -Method Post -WebSession $userSession -Headers @{'X-XSRF-TOKEN'=$token}
$reportId = $demo.id
Write-Output "PASS demo report created (id=$reportId)"

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
AssertStatus $revoke.StatusCode 200 'grant revoked'
$after = Invoke-WebRequest "$base/api/reports/$reportId" -WebSession $doctorSession -SkipHttpErrorCheck
AssertStatus $after.StatusCode 404 'revoked doctor denied'

$doctorCreate = Invoke-WebRequest "$base/api/dev/reports" -Method Post -WebSession $doctorSession -Headers @{'X-XSRF-TOKEN'=(Csrf $doctorSession)} -SkipHttpErrorCheck
AssertStatus $doctorCreate.StatusCode 403 'doctor cannot create patient report'

$otherSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$otherEmail = "acceptance-$([guid]::NewGuid().ToString('N'))@example.invalid"
$otherToken = Csrf $otherSession
$otherRegister = Invoke-WebRequest "$base/api/auth/register" -Method Post -WebSession $otherSession -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=$otherToken} -Body (@{email=$otherEmail;password=$userPassword} | ConvertTo-Json) -SkipHttpErrorCheck
AssertStatus $otherRegister.StatusCode 201 'second user registration'
Login $otherSession $otherEmail $userPassword
$otherRead = Invoke-WebRequest "$base/api/reports/$reportId" -WebSession $otherSession -SkipHttpErrorCheck
AssertStatus $otherRead.StatusCode 404 'other user cannot read report'
$otherGrant = Invoke-WebRequest "$base/api/reports/$reportId/grants" -Method Post -WebSession $otherSession -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Csrf $otherSession)} -Body (@{doctorEmail=$env:DEMO_DOCTOR_EMAIL} | ConvertTo-Json) -SkipHttpErrorCheck
AssertStatus $otherGrant.StatusCode 404 'other user cannot grant report'

# PowerShell persists request headers in WebRequestSession; remove the prior token explicitly.
[void]$userSession.Headers.Remove('X-XSRF-TOKEN')
$noCsrf = Invoke-WebRequest "$base/api/dev/reports" -Method Post -WebSession $userSession -SkipHttpErrorCheck
AssertStatus $noCsrf.StatusCode 403 'mutation without CSRF token denied'
$logout = Invoke-WebRequest "$base/api/auth/logout" -Method Post -WebSession $userSession -Headers @{'X-XSRF-TOKEN'=(Csrf $userSession)} -SkipHttpErrorCheck
AssertStatus $logout.StatusCode 204 'logout'
$afterLogout = Invoke-WebRequest "$base/api/auth/me" -WebSession $userSession -SkipHttpErrorCheck
AssertStatus $afterLogout.StatusCode 401 'logged out session denied'
Write-Output 'Stage 2 API acceptance checks passed.'
