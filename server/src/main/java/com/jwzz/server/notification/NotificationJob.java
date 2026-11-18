package com.jwzz.server.notification;

import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name="app.notifications.dispatch-enabled",havingValue="true",matchIfMissing=true)
public class NotificationJob {
    private final NotificationDispatcher dispatcher;
    public NotificationJob(NotificationDispatcher dispatcher) { this.dispatcher=dispatcher; }
    @Scheduled(fixedDelayString="${app.notifications.poll-ms:2000}",initialDelay=3000)
    public void dispatch() {
        try { for(int i=0;i<50;i++) if(!dispatcher.dispatchOne()) break; }
        catch(RuntimeException failure) {
            LoggerFactory.getLogger(NotificationJob.class).warn("Notification worker unavailable: {}",failure.getClass().getSimpleName());
        }
    }
}
