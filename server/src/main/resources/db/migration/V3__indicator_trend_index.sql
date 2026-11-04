CREATE INDEX idx_record_trend
  ON indicator_record (user_id, indicator_code, measurement_context, measured_at);
