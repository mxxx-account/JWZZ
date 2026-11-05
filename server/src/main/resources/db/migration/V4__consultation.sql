CREATE TABLE consultation_request (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  report_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  question VARCHAR(1000) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  claimed_doctor_id BIGINT NULL,
  answer VARCHAR(2000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TIMESTAMP NULL,
  answered_at TIMESTAMP NULL,
  CONSTRAINT fk_consultation_report FOREIGN KEY (report_id) REFERENCES assessment_report(id),
  CONSTRAINT fk_consultation_user FOREIGN KEY (user_id) REFERENCES app_user(id),
  CONSTRAINT fk_consultation_doctor FOREIGN KEY (claimed_doctor_id) REFERENCES app_user(id),
  INDEX idx_consultation_user (user_id, created_at),
  INDEX idx_consultation_report_status (report_id, status)
);
