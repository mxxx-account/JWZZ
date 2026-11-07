CREATE TABLE shopping_cart_item (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  sku_id BIGINT NOT NULL,
  quantity INT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_cart_user FOREIGN KEY (user_id) REFERENCES app_user(id),
  CONSTRAINT fk_cart_sku FOREIGN KEY (sku_id) REFERENCES store_sku(id),
  CONSTRAINT uq_cart_user_sku UNIQUE (user_id, sku_id),
  CONSTRAINT ck_cart_quantity CHECK (quantity BETWEEN 1 AND 99),
  INDEX idx_cart_user (user_id, id)
);
