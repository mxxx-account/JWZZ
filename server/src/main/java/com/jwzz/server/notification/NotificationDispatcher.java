package com.jwzz.server.notification;

import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class NotificationDispatcher {
    private static final Logger log=LoggerFactory.getLogger(NotificationDispatcher.class);
    private final NotificationOutbox outbox;
    private final NotificationStore notifications;
    private final TransactionTemplate tx;
    public NotificationDispatcher(DataSource dataSource, NotificationOutbox outbox, NotificationStore notifications) {
        this.outbox=outbox; this.notifications=notifications;
        // Only this JDBC-only worker uses its own transaction template; business JPA transactions are unchanged.
        this.tx=new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        this.tx.setTimeout(10);
    }

    public boolean dispatchOne() {
        return Boolean.TRUE.equals(tx.execute(status -> {
            var next=outbox.lockNext();
            if(next.isEmpty()) return false;
            var event=next.get();
            Object savepoint=status.createSavepoint();
            try {
                notifications.deliver(event);
                outbox.delivered(event);
            } catch (RuntimeException failure) {
                // Keep the event row lock, roll back any partial notification, then persist retry state.
                status.rollbackToSavepoint(savepoint);
                outbox.failed(event,failure);
                log.warn("Notification event {} delivery failed (attempt {}, type {})",event.id(),event.attempts()+1,failure.getClass().getSimpleName());
            } finally { status.releaseSavepoint(savepoint); }
            return true;
        }));
    }
}
