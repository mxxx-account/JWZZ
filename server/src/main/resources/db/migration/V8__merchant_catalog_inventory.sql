CREATE TABLE product_template (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(80) NOT NULL,
  category VARCHAR(32) NOT NULL,
  description VARCHAR(500) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_product_template_code UNIQUE (code)
);

CREATE TABLE store_sku (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT NOT NULL,
  template_id BIGINT NULL,
  name VARCHAR(80) NOT NULL,
  category VARCHAR(32) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  price_cents BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'OFF_SHELF',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_store_sku_store FOREIGN KEY (store_id) REFERENCES merchant_store(id),
  CONSTRAINT fk_store_sku_template FOREIGN KEY (template_id) REFERENCES product_template(id),
  CONSTRAINT uq_store_sku_template UNIQUE (store_id, template_id),
  CONSTRAINT ck_store_sku_price CHECK (price_cents > 0),
  INDEX idx_store_sku_status (store_id, status)
);

CREATE TABLE store_inventory (
  sku_id BIGINT NOT NULL PRIMARY KEY,
  available INT NOT NULL DEFAULT 0,
  reserved INT NOT NULL DEFAULT 0,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_store_inventory_sku FOREIGN KEY (sku_id) REFERENCES store_sku(id),
  CONSTRAINT ck_store_inventory_available CHECK (available >= 0),
  CONSTRAINT ck_store_inventory_reserved CHECK (reserved >= 0)
);

CREATE TABLE inventory_ledger (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sku_id BIGINT NOT NULL,
  actor_id BIGINT NOT NULL,
  delta INT NOT NULL,
  before_available INT NOT NULL,
  after_available INT NOT NULL,
  reason VARCHAR(32) NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_inventory_ledger_sku FOREIGN KEY (sku_id) REFERENCES store_sku(id),
  CONSTRAINT fk_inventory_ledger_actor FOREIGN KEY (actor_id) REFERENCES app_user(id),
  INDEX idx_inventory_ledger_sku_time (sku_id, id)
);

INSERT INTO product_template (code, name, category, description) VALUES
  ('BP_MONITOR', '电子血压计', '健康器械', '演示用品：了解测量方式与袖带规格，不作为医疗推荐'),
  ('GLUCOSE_METER', '血糖仪', '健康器械', '演示用品：了解试纸兼容性与使用步骤'),
  ('THERMOMETER', '电子体温计', '健康器械', '演示用品：了解不同测温方式'),
  ('MASK', '防护口罩', '日常用品', '演示用品：核对包装标识与适用场景'),
  ('VITAMIN_C', '维生素 C', '营养补充', '演示品类：不代表适合个人，不能替代药物'),
  ('FISH_OIL', '鱼油', '营养补充', '演示品类：不代表适合个人，不能替代药物');

-- Existing draft stores receive the same three starter SKUs as newly created stores.
INSERT INTO store_sku (store_id, template_id, name, category, description, price_cents)
SELECT store.id, template.id, template.name, template.category, template.description, 10000
FROM merchant_store store JOIN product_template template
  ON template.code IN ('BP_MONITOR', 'GLUCOSE_METER', 'THERMOMETER');

INSERT INTO store_inventory (sku_id)
SELECT id FROM store_sku;
