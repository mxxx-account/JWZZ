CREATE TABLE app_user (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_app_user_email UNIQUE (email)
);

CREATE TABLE indicator_record (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  indicator_code VARCHAR(64) NOT NULL,
  numeric_value DECIMAL(12, 4) NOT NULL,
  unit VARCHAR(32) NOT NULL,
  measurement_context VARCHAR(64),
  measured_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_record_user FOREIGN KEY (user_id) REFERENCES app_user(id),
  INDEX idx_record_user_time (user_id, measured_at)
);

CREATE TABLE assessment_report (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  idempotency_key VARCHAR(64) NOT NULL,
  rule_set_version VARCHAR(64) NOT NULL,
  report_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_report_user FOREIGN KEY (user_id) REFERENCES app_user(id),
  CONSTRAINT uq_report_user_key UNIQUE (user_id, idempotency_key),
  INDEX idx_report_user_time (user_id, created_at)
);

CREATE TABLE report_access_grant (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  report_id BIGINT NOT NULL,
  doctor_id BIGINT NOT NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP NULL,
  CONSTRAINT fk_grant_report FOREIGN KEY (report_id) REFERENCES assessment_report(id),
  CONSTRAINT fk_grant_doctor FOREIGN KEY (doctor_id) REFERENCES app_user(id),
  CONSTRAINT uq_grant_report_doctor UNIQUE (report_id, doctor_id)
);
