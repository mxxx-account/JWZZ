CREATE TABLE shop_shipment (
  order_id BIGINT NOT NULL PRIMARY KEY,
  tracking_code VARCHAR(64) NOT NULL,
  shipped_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  received_at DATETIME(6) NULL,
  FOREIGN KEY (order_id) REFERENCES shop_order(id)
);
CREATE TABLE shop_refund (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  client_key VARCHAR(64) NOT NULL,
  original_status VARCHAR(24) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'REQUESTED',
  reason VARCHAR(500) NOT NULL,
  review_note VARCHAR(500) NULL,
  return_code VARCHAR(64) NULL,
  disposition VARCHAR(24) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  reviewed_at DATETIME(6) NULL,
  returned_at DATETIME(6) NULL,
  completed_at DATETIME(6) NULL,
  FOREIGN KEY (order_id) REFERENCES shop_order(id),
  UNIQUE KEY uq_refund_request (order_id,client_key),
  CONSTRAINT ck_refund_status CHECK (status IN ('REQUESTED','REJECTED','AWAITING_RETURN','RETURNED','REFUNDED')),
  CONSTRAINT ck_refund_origin CHECK (original_status IN ('PAID','ACCEPTED','SHIPPED','COMPLETED')),
  CONSTRAINT ck_refund_disposition CHECK (disposition IS NULL OR disposition IN ('RELEASE_RESERVED','UNSHIPPED_RESTOCK','RESTOCK','DISCARD')),
  INDEX idx_refund_order (order_id,id)
);
CREATE TABLE shop_refund_ledger (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  refund_id BIGINT NOT NULL,
  amount_cents BIGINT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (order_id) REFERENCES shop_order(id),
  FOREIGN KEY (refund_id) REFERENCES shop_refund(id),
  UNIQUE KEY uq_refunded_order (order_id),
  UNIQUE KEY uq_refund_ledger (refund_id),
  CONSTRAINT ck_refund_amount CHECK (amount_cents > 0)
);
