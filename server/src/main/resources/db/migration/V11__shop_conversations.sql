CREATE TABLE shop_conversation (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  store_id BIGINT NOT NULL,
  user_last_read_message_id BIGINT NOT NULL DEFAULT 0,
  merchant_last_read_message_id BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_shop_conversation_order UNIQUE (order_id),
  CONSTRAINT fk_shop_conversation_order FOREIGN KEY (order_id) REFERENCES shop_order(id),
  CONSTRAINT fk_shop_conversation_user FOREIGN KEY (user_id) REFERENCES app_user(id),
  CONSTRAINT fk_shop_conversation_store FOREIGN KEY (store_id) REFERENCES merchant_store(id),
  INDEX idx_shop_conversation_user (user_id, updated_at),
  INDEX idx_shop_conversation_store (store_id, updated_at)
);

CREATE TABLE shop_message (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT NOT NULL,
  sender_id BIGINT NOT NULL,
  body VARCHAR(2000) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_shop_message_conversation FOREIGN KEY (conversation_id) REFERENCES shop_conversation(id),
  CONSTRAINT fk_shop_message_sender FOREIGN KEY (sender_id) REFERENCES app_user(id),
  INDEX idx_shop_message_thread (conversation_id, id)
);
