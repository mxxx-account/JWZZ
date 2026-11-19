package com.jwzz.server.shop;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Repository
public class RefundLedger {
    private final JdbcTemplate db;
    public RefundLedger(JdbcTemplate db) {this.db=db;}
    public void record(long order,long refund,long amount) {
        if(!TransactionSynchronizationManager.isActualTransactionActive()) throw new IllegalStateException("Refund requires transaction");
        db.update("INSERT INTO shop_refund_ledger(order_id,refund_id,amount_cents) VALUES (?,?,?)",order,refund,amount);
    }
}
