CREATE TABLE notification_outbox (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_key VARCHAR(128) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  recipient_id BIGINT NOT NULL,
  resource_id BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  attempts INT NOT NULL DEFAULT 0,
  available_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  delivered_at DATETIME(6) NULL,
  last_error VARCHAR(100) NULL,
  CONSTRAINT uq_notification_event UNIQUE (event_key),
  CONSTRAINT fk_notification_event_user FOREIGN KEY (recipient_id) REFERENCES app_user(id),
  CONSTRAINT ck_notification_event_status CHECK (status IN ('PENDING','DELIVERED','FAILED')),
  CONSTRAINT ck_notification_event_type CHECK (event_type IN ('CONSULTATION_SUBMITTED','DOCTOR_REPLIED','ORDER_ACCEPTED','ORDER_EXPIRED')),
  INDEX idx_notification_due (status, available_at, id)
);

CREATE TABLE user_notification (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT NOT NULL,
  recipient_id BIGINT NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  resource_id BIGINT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  read_at DATETIME(6) NULL,
  CONSTRAINT uq_notification_delivery UNIQUE (event_id),
  CONSTRAINT fk_notification_source FOREIGN KEY (event_id) REFERENCES notification_outbox(id),
  CONSTRAINT fk_notification_recipient FOREIGN KEY (recipient_id) REFERENCES app_user(id),
  INDEX idx_notification_list (recipient_id, id DESC),
  INDEX idx_notification_unread (recipient_id, read_at, id)
);
