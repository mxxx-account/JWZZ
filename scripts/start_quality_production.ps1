$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$recordDir=Join-Path $projectRoot 'reports/quality-2026-11-08-round3'
if (-not $env:JWZZ_QA_ROOT_PASSWORD) { throw 'Set JWZZ_QA_ROOT_PASSWORD' }
if (Get-NetTCPConnection -LocalPort 8083 -State Listen -ErrorAction SilentlyContinue) { throw 'Test port 8083 occupied' }
$client='C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
$env:MYSQL_PWD=$env:JWZZ_QA_ROOT_PASSWORD
$exists=& $client --host=127.0.0.1 --user=root --batch --skip-column-names --execute="SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='jwzz_quality_prod_r3';"
if ($LASTEXITCODE -ne 0 -or $exists -ne '0') { throw 'Test schema exists or cannot connect; no overwrite' }
$secret=[guid]::NewGuid().ToString('N')
& $client --host=127.0.0.1 --user=root --execute="CREATE DATABASE jwzz_quality_prod_r3 CHARACTER SET utf8mb4; CREATE USER 'jwzz_quality_prod_r3'@'localhost' IDENTIFIED BY '$secret'; GRANT ALL PRIVILEGES ON jwzz_quality_prod_r3.* TO 'jwzz_quality_prod_r3'@'localhost';"
if ($LASTEXITCODE -ne 0) { throw 'Provision failed' }
Remove-Item Env:MYSQL_PWD; Remove-Item Env:JWZZ_QA_ROOT_PASSWORD
$env:DB_URL='jdbc:mysql://127.0.0.1:3306/jwzz_quality_prod_r3?useUnicode=true&characterEncoding=utf8'
$env:DB_USER='jwzz_quality_prod_r3'; $env:DB_PASSWORD=$secret
$env:JWZZ_REDIS_ENABLED='true'; $env:REDIS_HOST='127.0.0.1'; $env:REDIS_PORT='16379'
$env:JWZZ_CORS_ORIGINS='http://localhost:3002,http://127.0.0.1:3002'
$env:DEMO_DOCTOR_EMAIL=''; $env:DEMO_DOCTOR_PASSWORD=''
$backend=Start-Process java -ArgumentList '-Xmx384m','-jar',(Join-Path $projectRoot 'server/target/server-0.1.0-SNAPSHOT.jar'),'--spring.profiles.active=dev','--server.port=8083','--spring.datasource.hikari.maximum-pool-size=4','--spring.data.redis.database=1' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $recordDir 'production-backend.log') -RedirectStandardError (Join-Path $recordDir 'production-backend-error.log') -PassThru
[pscustomobject]@{backendPid=$backend.Id;database='jwzz_quality_prod_r3';port=8083;redisDatabase=1} | ConvertTo-Json | Out-File (Join-Path $recordDir 'production-processes.json') -Encoding utf8
Remove-Item Env:DB_PASSWORD
Write-Output "Started production-test backend $($backend.Id) on 8083; credentials not saved"
