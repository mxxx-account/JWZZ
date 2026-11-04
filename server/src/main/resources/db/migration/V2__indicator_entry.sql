ALTER TABLE indicator_record
  ADD COLUMN entry_id CHAR(36) NULL,
  ADD COLUMN raw_numeric_value DECIMAL(12, 4) NULL,
  ADD COLUMN raw_unit VARCHAR(32) NULL,
  ADD COLUMN conversion_version VARCHAR(32) NOT NULL DEFAULT 'legacy-unverified',
  ADD COLUMN age_years INT NULL,
  ADD COLUMN pregnant BOOLEAN NULL;

UPDATE indicator_record
SET entry_id = UUID(), raw_numeric_value = numeric_value, raw_unit = unit
WHERE entry_id IS NULL;

ALTER TABLE indicator_record
  MODIFY entry_id CHAR(36) NOT NULL,
  MODIFY raw_numeric_value DECIMAL(12, 4) NOT NULL,
  MODIFY raw_unit VARCHAR(32) NOT NULL,
  ADD INDEX idx_record_user_entry (user_id, entry_id);
