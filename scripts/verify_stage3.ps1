# Requires PowerShell 7 and the local Spring Boot server with the dev profile.
param([string]$BaseUrl = 'http://127.0.0.1:8080')
$ErrorActionPreference = 'Stop'
Get-Command Invoke-WebRequest | Out-Null
. (Join-Path $PSScriptRoot '..\server\.env.local.ps1')
$base = $BaseUrl.TrimEnd('/')
$session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$other = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$email = "indicator-$([guid]::NewGuid().ToString('N'))@example.invalid"
$otherEmail = "indicator-$([guid]::NewGuid().ToString('N'))@example.invalid"
$password = 'StageThreeTest123!'
function Token($webSession) { (Invoke-RestMethod "$base/api/auth/csrf" -WebSession $webSession).token }
function RegisterAndLogin($webSession, $address) {
    $token = Token $webSession
    $registered = Invoke-WebRequest "$base/api/auth/register" -Method Post -WebSession $webSession -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=$token} -Body (@{email=$address;password=$password;name='测试用户';role='USER'} | ConvertTo-Json) -SkipHttpErrorCheck
    if ($registered.StatusCode -ne 201) { throw "Registration failed: $($registered.StatusCode)" }
    $token = Token $webSession
    $login = Invoke-WebRequest "$base/api/auth/login" -Method Post -WebSession $webSession -ContentType 'application/x-www-form-urlencoded' -Headers @{'X-XSRF-TOKEN'=$token} -Body @{email=$address;password=$password} -SkipHttpErrorCheck
    if ($login.StatusCode -ne 200) { throw "Login failed: $($login.StatusCode)" }
}
function AssertStatus($response, $expected, $label) {
    if ($response.StatusCode -ne $expected) { throw "$label expected $expected, got $($response.StatusCode): $($response.Content)" }
    Write-Output "PASS $label ($expected)"
}
RegisterAndLogin $session $email
RegisterAndLogin $other $otherEmail
$time = (Get-Date).AddMinutes(-5).ToString('yyyy-MM-ddTHH:mm:ss')
$bp = @{category='BP';measuredAt=$time;context='HOME';ageYears=22;pregnant=$false;values=@{systolic_bp=@{value=130;unit='mmHg'};diastolic_bp=@{value=80;unit='mmHg'}}} | ConvertTo-Json -Depth 5
$saved = Invoke-WebRequest "$base/api/indicators" -Method Post -WebSession $session -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Token $session)} -Body $bp -SkipHttpErrorCheck
AssertStatus $saved 201 'blood pressure saved'
$entry = $saved.Content | ConvertFrom-Json
if ($entry.draftInterpretations[0].ruleCode -ne 'BP_CATEGORY' -or $entry.rulesStatus -ne 'AWAITING_CLINICAL_REVIEW') { throw 'Unexpected draft rule result' }
Write-Output 'PASS versioned draft BP rule'
$mine = Invoke-RestMethod "$base/api/indicators" -WebSession $session
if (@($mine).Count -ne 2 -or $mine[0].entryId -ne $entry.entryId) { throw 'Saved values were not grouped correctly' }
Write-Output 'PASS two indicator records grouped in one entry'
$theirs = Invoke-RestMethod "$base/api/indicators" -WebSession $other
if (@($theirs).Count -ne 0) { throw 'Other user can read indicator records' }
Write-Output 'PASS other user list isolated'
$doctorSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$doctorToken = Token $doctorSession
$doctorLogin = Invoke-WebRequest "$base/api/auth/login" -Method Post -WebSession $doctorSession -ContentType 'application/x-www-form-urlencoded' -Headers @{'X-XSRF-TOKEN'=$doctorToken} -Body @{email=$env:DEMO_DOCTOR_EMAIL;password=$env:DEMO_DOCTOR_PASSWORD} -SkipHttpErrorCheck
AssertStatus $doctorLogin 200 'doctor login'
$doctorRead = Invoke-WebRequest "$base/api/indicators" -WebSession $doctorSession -SkipHttpErrorCheck
AssertStatus $doctorRead 403 'doctor cannot read patient indicators'
$badUnit = @{category='GLUCOSE';measuredAt=$time;context='FASTING_PLASMA';ageYears=22;pregnant=$false;values=@{blood_glucose=@{value=100;unit='watts'}}} | ConvertTo-Json -Depth 5
$rejected = Invoke-WebRequest "$base/api/indicators" -Method Post -WebSession $session -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Token $session)} -Body $badUnit -SkipHttpErrorCheck
AssertStatus $rejected 400 'invalid unit rejected'
$invalidBp = @{category='BP';measuredAt=$time;context='HOME';ageYears=22;pregnant=$false;values=@{systolic_bp=@{value=7.0001;unit='mmHg'};diastolic_bp=@{value=15.0001;unit='mmHg'}}} | ConvertTo-Json -Depth 5
$invalidBpResponse = Invoke-WebRequest "$base/api/indicators" -Method Post -WebSession $session -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Token $session)} -Body $invalidBp -SkipHttpErrorCheck
AssertStatus $invalidBpResponse 400 'screenshot blood pressure rejected'
$invalidMessage = ($invalidBpResponse.Content | ConvertFrom-Json).message
if ($invalidMessage -notmatch '收缩压|舒张压') { throw 'Invalid BP response did not identify the field' }
Write-Output 'PASS invalid BP response explains the field'
$capillary = @{category='GLUCOSE';measuredAt=$time;context='CAPILLARY';ageYears=22;pregnant=$false;values=@{blood_glucose=@{value=7.0;unit='mmol/L'}}} | ConvertTo-Json -Depth 5
$capillarySaved = Invoke-WebRequest "$base/api/indicators" -Method Post -WebSession $session -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Token $session)} -Body $capillary -SkipHttpErrorCheck
AssertStatus $capillarySaved 201 'capillary glucose saved'
if (@(($capillarySaved.Content | ConvertFrom-Json).draftInterpretations).Count -ne 0) { throw 'Capillary reading received plasma rule' }
Write-Output 'PASS plasma rule not applied to capillary reading'
Write-Output 'Stage 3 API acceptance checks passed.'
