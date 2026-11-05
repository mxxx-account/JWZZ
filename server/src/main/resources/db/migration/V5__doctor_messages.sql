CREATE TABLE doctor_profile (
  doctor_id BIGINT NOT NULL PRIMARY KEY,
  display_name VARCHAR(80) NOT NULL,
  specialty VARCHAR(32) NOT NULL,
  last_seen_at DATETIME(6) NULL,
  CONSTRAINT fk_profile_doctor FOREIGN KEY (doctor_id) REFERENCES app_user(id),
  INDEX idx_doctor_specialty_online (specialty, last_seen_at)
);

ALTER TABLE consultation_request
  ADD COLUMN target_doctor_id BIGINT NULL,
  ADD COLUMN user_last_read_message_id BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN doctor_last_read_message_id BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT fk_consultation_target_doctor FOREIGN KEY (target_doctor_id) REFERENCES app_user(id),
  ADD INDEX idx_consultation_target (target_doctor_id, status);

UPDATE consultation_request
SET target_doctor_id = claimed_doctor_id
WHERE claimed_doctor_id IS NOT NULL;

CREATE TABLE consultation_message (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  consultation_id BIGINT NOT NULL,
  sender_id BIGINT NOT NULL,
  body VARCHAR(2000) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_message_consultation FOREIGN KEY (consultation_id) REFERENCES consultation_request(id),
  CONSTRAINT fk_message_sender FOREIGN KEY (sender_id) REFERENCES app_user(id),
  INDEX idx_message_thread (consultation_id, id)
);

INSERT INTO consultation_message (consultation_id, sender_id, body, created_at)
SELECT id, user_id, question, created_at FROM consultation_request;

INSERT INTO consultation_message (consultation_id, sender_id, body, created_at)
SELECT id, claimed_doctor_id, answer, COALESCE(answered_at, created_at)
FROM consultation_request WHERE answer IS NOT NULL AND claimed_doctor_id IS NOT NULL;
