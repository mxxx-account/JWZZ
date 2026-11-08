ALTER TABLE consultation_message ADD COLUMN client_message_id VARCHAR(64) NULL,
  ADD UNIQUE KEY uq_consultation_client_message (consultation_id, sender_id, client_message_id);
ALTER TABLE shop_message ADD COLUMN client_message_id VARCHAR(64) NULL,
  ADD UNIQUE KEY uq_shop_client_message (conversation_id, sender_id, client_message_id);
