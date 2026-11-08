$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $projectRoot 'server/.env.local.ps1')
Set-Location (Join-Path $projectRoot 'server')
java -jar target/server-0.1.0-SNAPSHOT.jar --spring.profiles.active=dev
