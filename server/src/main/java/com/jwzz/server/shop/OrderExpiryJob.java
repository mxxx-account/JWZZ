package com.jwzz.server.shop;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class OrderExpiryJob {
    private static final Logger log = LoggerFactory.getLogger(OrderExpiryJob.class);
    private final OrderStore store;
    private final OrderService service;
    public OrderExpiryJob(OrderStore store, OrderService service) { this.store = store; this.service = service; }

    @Scheduled(fixedDelay = 30_000, initialDelay = 30_000)
    public void releaseExpired() {
        for (long id : store.dueIds()) {
            try { service.expire(id); }
            catch (RuntimeException exception) { log.error("Could not expire order {}", id, exception); }
        }
    }
}
