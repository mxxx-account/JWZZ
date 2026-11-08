$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$recordDir=Join-Path $projectRoot 'reports/quality-2026-11-08-round3'
$client='C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
if (-not $env:JWZZ_QA_ROOT_PASSWORD) { throw 'Set JWZZ_QA_ROOT_PASSWORD for local test database provisioning' }
foreach ($port in @(8082,15432,16379,16380,18090)) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Test port $port is occupied" }
}
$env:MYSQL_PWD=$env:JWZZ_QA_ROOT_PASSWORD
$exists=& $client --host=127.0.0.1 --user=root --batch --skip-column-names --execute="SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='jwzz_quality_r3';"
if ($LASTEXITCODE -ne 0 -or $exists -ne '0') { throw 'Cannot provision or test schema already exists; refusing overwrite' }
$testSecret=[guid]::NewGuid().ToString('N')
& $client --host=127.0.0.1 --user=root --execute="CREATE DATABASE jwzz_quality_r3 CHARACTER SET utf8mb4; CREATE USER 'jwzz_quality_r3'@'localhost' IDENTIFIED BY '$testSecret'; GRANT ALL PRIVILEGES ON jwzz_quality_r3.* TO 'jwzz_quality_r3'@'localhost';"
if ($LASTEXITCODE -ne 0) { throw 'Test database provisioning failed' }
Remove-Item Env:MYSQL_PWD
Remove-Item Env:JWZZ_QA_ROOT_PASSWORD
New-Item -ItemType Directory $recordDir -Force | Out-Null
wsl -d Ubuntu -u root -- docker run -d --name jwzz-quality-r3-redis --label jwzz.quality=round3 --memory=128m -p 127.0.0.1:16379:6379 redis:7-alpine
if ($LASTEXITCODE -ne 0) { throw 'Test Redis start failed' }
$proxy=Start-Process node -ArgumentList (Join-Path $PSScriptRoot 'quality_fault_proxy.mjs') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $recordDir 'proxy.log') -RedirectStandardError (Join-Path $recordDir 'proxy-error.log') -PassThru
$env:DB_URL='jdbc:mysql://127.0.0.1:15432/jwzz_quality_r3?useUnicode=true&characterEncoding=utf8'
$env:DB_USER='jwzz_quality_r3'; $env:DB_PASSWORD=$testSecret
$env:JWZZ_REDIS_ENABLED='true'; $env:REDIS_HOST='127.0.0.1'; $env:REDIS_PORT='16380'
$env:DEMO_DOCTOR_EMAIL=''; $env:DEMO_DOCTOR_PASSWORD=''
$java=Start-Process java -ArgumentList '-Xmx384m','-jar',(Join-Path $projectRoot 'server/target/server-0.1.0-SNAPSHOT.jar'),'--spring.profiles.active=dev','--server.port=8082','--spring.datasource.hikari.connection-timeout=2000','--spring.datasource.hikari.maximum-pool-size=4','--spring.data.redis.timeout=800ms','--spring.data.redis.connect-timeout=800ms' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $recordDir 'isolated-backend.log') -RedirectStandardError (Join-Path $recordDir 'isolated-backend-error.log') -PassThru
[pscustomobject]@{ proxyPid=$proxy.Id; backendPid=$java.Id; database='jwzz_quality_r3'; redisContainer='jwzz-quality-r3-redis'; port=8082 } | ConvertTo-Json | Out-File (Join-Path $recordDir 'processes.json') -Encoding utf8
Remove-Item Env:DB_PASSWORD
Write-Output "Started test proxy $($proxy.Id), backend $($java.Id); isolated database jwzz_quality_r3; no credentials saved"
