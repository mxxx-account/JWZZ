CREATE TABLE shop_order (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  store_id BIGINT NOT NULL,
  idempotency_key VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL,
  total_cents BIGINT NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  paid_at DATETIME(6) NULL,
  accepted_at DATETIME(6) NULL,
  closed_at DATETIME(6) NULL,
  CONSTRAINT fk_shop_order_user FOREIGN KEY (user_id) REFERENCES app_user(id),
  CONSTRAINT fk_shop_order_store FOREIGN KEY (store_id) REFERENCES merchant_store(id),
  CONSTRAINT uq_shop_order_idempotency UNIQUE (user_id, idempotency_key),
  CONSTRAINT ck_shop_order_total CHECK (total_cents > 0),
  INDEX idx_shop_order_user (user_id, id DESC),
  INDEX idx_shop_order_store (store_id, id DESC),
  INDEX idx_shop_order_expiry (status, expires_at)
);

CREATE TABLE shop_order_item (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  sku_id BIGINT NOT NULL,
  product_name VARCHAR(80) NOT NULL,
  unit_price_cents BIGINT NOT NULL,
  quantity INT NOT NULL,
  CONSTRAINT fk_shop_order_item_order FOREIGN KEY (order_id) REFERENCES shop_order(id),
  CONSTRAINT fk_shop_order_item_sku FOREIGN KEY (sku_id) REFERENCES store_sku(id),
  CONSTRAINT ck_shop_order_item_quantity CHECK (quantity BETWEEN 1 AND 99),
  CONSTRAINT ck_shop_order_item_price CHECK (unit_price_cents > 0),
  INDEX idx_shop_order_item_order (order_id)
);
