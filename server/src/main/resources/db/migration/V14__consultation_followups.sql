CREATE TABLE consultation_closure (
  consultation_id BIGINT NOT NULL PRIMARY KEY,
  summary VARCHAR(2000) NOT NULL,
  request_json JSON NOT NULL,
  closed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (consultation_id) REFERENCES consultation_request(id)
);
CREATE TABLE followup_task (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  consultation_id BIGINT NOT NULL,
  creator_id BIGINT NOT NULL,
  client_key VARCHAR(64) NOT NULL,
  title VARCHAR(300) NOT NULL,
  due_at DATETIME(6) NULL COMMENT 'UTC; user must confirm doctor proposals',
  original_due_at DATETIME(6) NULL,
  status VARCHAR(16) NOT NULL,
  report_id BIGINT NULL,
  completed_at DATETIME(6) NULL,
  UNIQUE KEY uq_followup_client (consultation_id,client_key),
  FOREIGN KEY (consultation_id) REFERENCES consultation_request(id),
  FOREIGN KEY (creator_id) REFERENCES app_user(id),
  FOREIGN KEY (report_id) REFERENCES assessment_report(id),
  CONSTRAINT ck_followup_status CHECK (status IN ('PROPOSED','ACTIVE','NOTIFIED','COMPLETED','CANCELLED')),
  INDEX idx_followup_due (status,due_at,id)
);
ALTER TABLE notification_outbox DROP CHECK ck_notification_event_type;
ALTER TABLE notification_outbox ADD CONSTRAINT ck_notification_event_type CHECK
  (event_type IN ('CONSULTATION_SUBMITTED','DOCTOR_REPLIED','ORDER_ACCEPTED','ORDER_EXPIRED','CONSULTATION_CLOSED','RECORD_REMINDER_DUE'));
