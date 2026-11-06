param([string]$BaseUrl = 'http://127.0.0.1:8080')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\server\.env.local.ps1')
$base = $BaseUrl.TrimEnd('/')
$email = "stage5-$([guid]::NewGuid().ToString('N'))@example.invalid"
$password = 'StageFiveTest123!'
$user = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$doctor = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$other = [Microsoft.PowerShell.Commands.WebRequestSession]::new()

function Csrf($session) { (Invoke-RestMethod "$base/api/auth/csrf" -WebSession $session).token }
function PostJson($url, $session, $body) {
    Invoke-WebRequest "$base$url" -Method Post -WebSession $session -ContentType 'application/json' -Headers @{'X-XSRF-TOKEN'=(Csrf $session)} -Body ($body | ConvertTo-Json -Depth 5) -SkipHttpErrorCheck
}
function Login($session, $name, $secret) {
    Invoke-WebRequest "$base/api/auth/login" -Method Post -WebSession $session -ContentType 'application/x-www-form-urlencoded' -Headers @{'X-XSRF-TOKEN'=(Csrf $session)} -Body @{email=$name;password=$secret} | Out-Null
}
function AssertStatus($response, [int]$status, [string]$label) {
    if ($response.StatusCode -ne $status) { throw "$label expected $status, got $($response.StatusCode): $($response.Content)" }
    Write-Output "PASS $label ($status)"
}

$catalog = Invoke-RestMethod "$base/api/public/indicators"
if ($catalog.items.Count -ne 8 -or $catalog.version -ne 'catalog-2026-01') { throw 'Public catalog mismatch' }
Write-Output 'PASS public indicator catalog'

$registered = PostJson '/api/auth/register' $user @{email=$email;password=$password;name='测试用户';role='USER'}
AssertStatus $registered 201 'register user'
Login $user $email $password
Login $doctor $env:DEMO_DOCTOR_EMAIL $env:DEMO_DOCTOR_PASSWORD
$otherEmail = "stage5-$([guid]::NewGuid().ToString('N'))@example.invalid"
AssertStatus (PostJson '/api/auth/register' $other @{email=$otherEmail;password=$password;name='其他测试用户';role='USER'}) 201 'register other user'
Login $other $otherEmail $password

$measured = (Get-Date).AddMinutes(-5).ToString('yyyy-MM-ddTHH:mm:ss')
$entry = PostJson '/api/indicators' $user @{
    category='BP';measuredAt=$measured;context='HOME';ageYears=22;pregnant=$false
    values=@{systolic_bp=@{value=130;unit='mmHg'};diastolic_bp=@{value=80;unit='mmHg'}}
}
AssertStatus $entry 201 'create indicator entry'
$entryId = ($entry.Content | ConvertFrom-Json).entryId
$report = PostJson '/api/reports' $user @{entryId=$entryId}
AssertStatus $report 200 'create report'
$reportId = ($report.Content | ConvertFrom-Json).id
$otherCreate = PostJson '/api/consultations' $other @{reportId=$reportId;question='我不应该能查看别人的报告咨询。'}
AssertStatus $otherCreate 404 'other user cannot consult on report'
$doctorCreate = PostJson '/api/consultations' $doctor @{reportId=$reportId;question='医生不能用用户入口创建咨询。'}
AssertStatus $doctorCreate 403 'doctor cannot use patient consultation API'

$ungranted = PostJson '/api/consultations' $user @{reportId=$reportId;question='请解释这份报告中的测量条件。'}
AssertStatus $ungranted 409 'consultation requires grant'
$grant = PostJson "/api/reports/$reportId/grants" $user @{doctorEmail=$env:DEMO_DOCTOR_EMAIL}
AssertStatus $grant 200 'grant doctor access'
$doctorId = ($grant.Content | ConvertFrom-Json).doctorId

$first = PostJson '/api/consultations' $user @{reportId=$reportId;question='请解释这份报告中的测量条件。'}
AssertStatus $first 201 'create consultation'
$firstId = ($first.Content | ConvertFrom-Json).id
$visible = Invoke-RestMethod "$base/api/doctor/consultations" -WebSession $doctor
if (-not ($visible | Where-Object id -eq $firstId)) { throw 'Doctor cannot see granted consultation' }
Write-Output 'PASS doctor sees granted consultation'

$claimed = PostJson "/api/doctor/consultations/$firstId/claim" $doctor @{}
AssertStatus $claimed 200 'doctor claims consultation'
$duplicate = PostJson "/api/doctor/consultations/$firstId/claim" $doctor @{}
AssertStatus $duplicate 409 'duplicate claim denied'
$replied = PostJson "/api/doctor/consultations/$firstId/reply" $doctor @{answer='这是一次居家测量记录，建议核对设备和测量时间。'}
AssertStatus $replied 200 'doctor replies'
$mine = Invoke-RestMethod "$base/api/consultations" -WebSession $user
if (-not ($mine | Where-Object { $_.id -eq $firstId -and $_.status -eq 'ANSWERED' -and $_.answer })) { throw 'User cannot read reply' }
Write-Output 'PASS user sees reply'

$second = PostJson '/api/consultations' $user @{reportId=$reportId;question='请说明报告快照和原始指标的关系。'}
AssertStatus $second 201 'create concurrent-claim case'
$secondId = ($second.Content | ConvertFrom-Json).id
$token = Csrf $doctor
$cookie = ($doctor.Cookies.GetCookies([uri]$base) | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; '
$claimUrl = "$base/api/doctor/consultations/$secondId/claim"
$codes = 1..8 | ForEach-Object -Parallel {
    $headers = @{Cookie=$using:cookie;'X-XSRF-TOKEN'=$using:token}
    try { (Invoke-WebRequest $using:claimUrl -Method Post -Headers $headers -SkipHttpErrorCheck).StatusCode }
    catch { 0 }
} -ThrottleLimit 8
if (@($codes | Where-Object { $_ -eq 200 }).Count -ne 1 -or @($codes | Where-Object { $_ -eq 409 }).Count -ne 7) {
    throw "Concurrent claim expected one 200 and seven 409, got: $($codes -join ',')"
}
Write-Output 'PASS eight concurrent claims have one winner'

for ($i=0; $i -lt 3; $i++) {
    $extra = PostJson '/api/consultations' $user @{reportId=$reportId;question="这是一条演示限流问题，序号为 $i。"}
    AssertStatus $extra 201 "rate-limit setup $i"
}
$limited = PostJson '/api/consultations' $user @{reportId=$reportId;question='这条演示请求应该触发每分钟限流。'}
AssertStatus $limited 429 'sixth consultation rate limited'

$revoked = Invoke-WebRequest "$base/api/reports/$reportId/grants/$doctorId" -Method Delete -WebSession $user -Headers @{'X-XSRF-TOKEN'=(Csrf $user)} -SkipHttpErrorCheck
AssertStatus $revoked 204 'revoke report grant'
$after = Invoke-RestMethod "$base/api/doctor/consultations" -WebSession $doctor
if ($after | Where-Object id -eq $secondId) { throw 'Revoked consultation remains visible to doctor' }
Write-Output 'PASS revoked consultation hidden from doctor'
$replyAfterRevoke = PostJson "/api/doctor/consultations/$secondId/reply" $doctor @{answer='撤销后不能再发送这条演示回复。'}
AssertStatus $replyAfterRevoke 404 'revoked doctor cannot reply'
Write-Output 'Stage 5 acceptance checks passed.'
