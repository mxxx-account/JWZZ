# Requires PowerShell 7 and the local server started with the dev profile.
param([string]$BaseUrl = 'http://127.0.0.1:8080')
$ErrorActionPreference = 'Stop'
Get-Command Invoke-WebRequest | Out-Null
. (Join-Path $PSScriptRoot '..\server\.env.local.ps1')
$base = $BaseUrl.TrimEnd('/')
$owner = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$other = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$doctor = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$password = 'StageFourTest123!'
$email = "report-$([guid]::NewGuid().ToString('N'))@example.invalid"
$otherEmail = "report-$([guid]::NewGuid().ToString('N'))@example.invalid"
function Token($session) { (Invoke-RestMethod "$base/api/auth/csrf" -WebSession $session).token }
function AssertStatus($response, $expected, $label) {
    if ($response.StatusCode -ne $expected) { throw "$label expected $expected, got $($response.StatusCode): $($response.Content)" }
    Write-Output "PASS $label ($expected)"
}
function Login($session, $address, $secret) {
    $response = Invoke-WebRequest "$base/api/auth/login" -Method Post -WebSession $session -ContentType 'application/x-www-form-urlencoded' -Headers @{'X-XSRF-TOKEN'=(Token $session)} -Body @{email=$address;password=$secret} -SkipHttpErrorCheck
    AssertStatus $response 200 'login'
}
function Register($session, $address) {
    $response = Invoke-WebRequest "$base/api/auth/register" -Method Post -WebSession $session -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Token $session)} -Body (@{email=$address;password=$password;name='测试用户';role='USER'} | ConvertTo-Json) -SkipHttpErrorCheck
    AssertStatus $response 201 'registration'
    Login $session $address $password
}
function SaveGlucose($session, $context, $time, $value) {
    $body = @{category='GLUCOSE';measuredAt=$time;context=$context;ageYears=22;pregnant=$false;values=@{blood_glucose=@{value=$value;unit='mg/dL'}}} | ConvertTo-Json -Depth 5
    $response = Invoke-WebRequest "$base/api/indicators" -Method Post -WebSession $session -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Token $session)} -Body $body -SkipHttpErrorCheck
    AssertStatus $response 201 'indicator saved' | Out-Host
    return ($response.Content | ConvertFrom-Json).entryId
}
Register $owner $email
Register $other $otherEmail
Login $doctor $env:DEMO_DOCTOR_EMAIL $env:DEMO_DOCTOR_PASSWORD
$entry1 = SaveGlucose $owner 'FASTING_PLASMA' (Get-Date).AddDays(-2).ToString('yyyy-MM-ddTHH:mm:ss') 100
$entry2 = SaveGlucose $owner 'FASTING_PLASMA' (Get-Date).AddDays(-1).ToString('yyyy-MM-ddTHH:mm:ss') 110
$capillary = SaveGlucose $owner 'CAPILLARY' (Get-Date).AddHours(-1).ToString('yyyy-MM-ddTHH:mm:ss') 120
$reportBody = @{entryId=$entry1} | ConvertTo-Json
$created = Invoke-WebRequest "$base/api/reports" -Method Post -WebSession $owner -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Token $owner)} -Body $reportBody -SkipHttpErrorCheck
AssertStatus $created 200 'report generated'
$report = $created.Content | ConvertFrom-Json
if ($report.content.sourceEntryId -ne $entry1 -or $report.content.values[0].rawValue -ne 100 -or $report.content.interpretations[0].ruleVersion -ne 'draft-2026-01') { throw 'Report snapshot missing data or rule version' }
Write-Output 'PASS report contains input and rule snapshot'
$again = Invoke-WebRequest "$base/api/reports" -Method Post -WebSession $owner -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Token $owner)} -Body $reportBody -SkipHttpErrorCheck
AssertStatus $again 200 'report retry'
$repeat = $again.Content | ConvertFrom-Json
if ($repeat.id -ne $report.id -or $repeat.content.generatedAt -ne $report.content.generatedAt) { throw 'Report generation was not idempotent' }
Write-Output 'PASS retry returned original immutable snapshot'
$reports = Invoke-RestMethod "$base/api/reports" -WebSession $owner
if (@($reports).Count -ne 1) { throw 'Retry created a duplicate report' }
Write-Output 'PASS exactly one report exists'
$parallelBody = @{entryId=$entry2} | ConvertTo-Json
$parallelToken = Token $owner
$cookieHeader = ($owner.Cookies.GetCookies([uri]$base) | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; '
$parallel = 1..8 | ForEach-Object -Parallel {
    Get-Command Invoke-WebRequest | Out-Null
    $response = Invoke-WebRequest ($using:base + '/api/reports') -Method Post -ContentType 'application/json' -Headers @{Cookie=$using:cookieHeader;'X-XSRF-TOKEN'=$using:parallelToken} -Body $using:parallelBody -SkipHttpErrorCheck
    [pscustomobject]@{status=$response.StatusCode;id=($response.Content | ConvertFrom-Json).id}
} -ThrottleLimit 8
if (@($parallel).Count -ne 8 -or @($parallel | Where-Object status -ne 200).Count -ne 0 -or @($parallel | Select-Object -ExpandProperty id -Unique).Count -ne 1) {
    throw "Concurrent report requests did not converge on one report: $($parallel | ConvertTo-Json -Compress)"
}
Write-Output 'PASS eight concurrent requests returned one report'
$otherGenerate = Invoke-WebRequest "$base/api/reports" -Method Post -WebSession $other -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Token $other)} -Body $reportBody -SkipHttpErrorCheck
AssertStatus $otherGenerate 404 'other user cannot generate from owner entry'
$doctorGenerate = Invoke-WebRequest "$base/api/reports" -Method Post -WebSession $doctor -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Token $doctor)} -Body $reportBody -SkipHttpErrorCheck
AssertStatus $doctorGenerate 403 'doctor cannot generate patient report'
$fasting = Invoke-RestMethod "$base/api/indicators/trends?code=blood_glucose&context=FASTING_PLASMA" -WebSession $owner
if (@($fasting).Count -ne 2 -or $fasting[0].entryId -ne $entry1 -or $fasting[1].entryId -ne $entry2) { throw 'Fasting trend mixed conditions or is out of order' }
Write-Output 'PASS fasting trend contains two chronological points'
$capillaryTrend = Invoke-RestMethod "$base/api/indicators/trends?code=blood_glucose&context=CAPILLARY" -WebSession $owner
if (@($capillaryTrend).Count -ne 1 -or $capillaryTrend[0].entryId -ne $capillary) { throw 'Capillary trend mixed conditions' }
Write-Output 'PASS capillary trend kept separate'
$otherTrend = Invoke-RestMethod "$base/api/indicators/trends?code=blood_glucose&context=FASTING_PLASMA" -WebSession $other
if (@($otherTrend).Count -ne 0) { throw 'Other user can read trend' }
Write-Output 'PASS trend is owner-scoped'
$invalidTrend = Invoke-WebRequest "$base/api/indicators/trends?code=blood_glucose&context=HOME" -WebSession $owner -SkipHttpErrorCheck
AssertStatus $invalidTrend 400 'invalid indicator/context pair rejected'
Write-Output 'Stage 4 API acceptance checks passed.'
