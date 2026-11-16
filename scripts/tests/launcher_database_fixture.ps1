# Synthetic test data only. This is NOT a usable database configuration.
$env:DB_URL = 'jdbc:mysql://127.0.0.1:1/launcher_test_not_connected'
$env:DB_USER = 'launcher_test_user'
$env:DB_PASSWORD = 'SyntheticDatabaseOnly'
$env:DEMO_DOCTOR_PASSWORD = 'SyntheticDoctorOnly'
$env:JWZZ_REDIS_ENABLED = 'false'
$env:JWZZ_AGENT_SHARED_TOKEN = 'DoNotInheritFromDatabaseConfig'
