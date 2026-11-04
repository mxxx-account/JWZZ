# Copy this file to .env.local.ps1 and fill in the local database credentials.
$env:DB_URL = 'jdbc:mysql://127.0.0.1:3306/jwzz?useUnicode=true&characterEncoding=utf8'
$env:DB_USER = 'jwzz'
$env:DB_PASSWORD = 'replace-with-local-password'
$env:SPRING_PROFILES_ACTIVE = 'dev'
$env:DEMO_DOCTOR_EMAIL = 'doctor@jwzz.local'
$env:DEMO_DOCTOR_PASSWORD = 'replace-with-demo-password'
