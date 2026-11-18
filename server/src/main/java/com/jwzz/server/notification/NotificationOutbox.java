package com.jwzz.server.notification;

import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Repository
public class NotificationOutbox {
    public enum Type { CONSULTATION_SUBMITTED, DOCTOR_REPLIED, ORDER_ACCEPTED, ORDER_EXPIRED }
    public record Event(long id, Type type, long recipientId, long resourceId, int attempts) {}
    private final JdbcTemplate jdbc;
    public NotificationOutbox(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void enqueue(String key, Type type, long recipientId, long resourceId) {
        // Fail closed if a future producer forgets its business transaction.
        if (!TransactionSynchronizationManager.isActualTransactionActive())
            throw new IllegalStateException("Notification event requires a business transaction");
        jdbc.update("""
            INSERT INTO notification_outbox (event_key,event_type,recipient_id,resource_id) VALUES (?,?,?,?)
            ON DUPLICATE KEY UPDATE event_key=event_key
            """, key, type.name(), recipientId, resourceId);
        var event = jdbc.queryForMap("SELECT event_type,recipient_id,resource_id FROM notification_outbox WHERE event_key=?", key);
        if (!type.name().equals(event.get("event_type")) || ((Number)event.get("recipient_id")).longValue()!=recipientId
            || ((Number)event.get("resource_id")).longValue()!=resourceId)
            throw new IllegalStateException("Notification idempotency key conflict");
    }

    public Optional<Event> lockNext() {
        return jdbc.query("""
            SELECT id,event_type,recipient_id,resource_id,attempts FROM notification_outbox
            WHERE status='PENDING' AND available_at<=CURRENT_TIMESTAMP(6)
            ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
            """, (rs,row) -> new Event(rs.getLong("id"),Type.valueOf(rs.getString("event_type")),
                rs.getLong("recipient_id"),rs.getLong("resource_id"),rs.getInt("attempts"))).stream().findFirst();
    }

    public void delivered(Event event) {
        jdbc.update("UPDATE notification_outbox SET status='DELIVERED',attempts=attempts+1,delivered_at=CURRENT_TIMESTAMP(6),last_error=NULL WHERE id=?",
            event.id());
    }

    public void failed(Event event, RuntimeException exception) {
        int attempt = event.attempts()+1;
        int seconds = Math.min(300, 5 * (1 << Math.min(attempt-1,6)));
        String code = exception.getClass().getSimpleName(); // No exception message / report / chat content.
        jdbc.update("""
            UPDATE notification_outbox SET status=?,attempts=?,last_error=?,
            available_at=TIMESTAMPADD(SECOND,?,CURRENT_TIMESTAMP(6)) WHERE id=?
            """, attempt>=5 ? "FAILED":"PENDING", attempt, code.substring(0,Math.min(100,code.length())), seconds,event.id());
    }
}
