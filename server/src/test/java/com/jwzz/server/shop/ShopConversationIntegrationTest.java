package com.jwzz.server.shop;

import static org.junit.jupiter.api.Assertions.*;

import com.jwzz.server.auth.UserStore;
import com.jwzz.server.common.RequestRateLimiter;
import com.jwzz.server.merchant.MerchantStore;
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

class ShopConversationIntegrationTest {
    @Test void orderConversationIsIsolatedIdempotentTransactionalAndConcurrent() throws Exception {
        String url = System.getenv("JWZZ_IT_DB_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Set JWZZ_IT_DB_URL for shop conversation test");
        var dataSource = new DriverManagerDataSource(url, System.getenv("DB_USER"), System.getenv("DB_PASSWORD"));
        var jdbc = new JdbcTemplate(dataSource);
        var tx = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        var users = new UserStore(jdbc);
        var merchants = new MerchantStore(jdbc);
        var orders = new OrderStore(jdbc);
        var conversations = new ShopConversationStore(jdbc);
        var service = new ShopConversationService(orders, conversations, new RequestRateLimiter(null, false));
        String suffix = UUID.randomUUID().toString();
        long user1 = 0, user2 = 0, merchant1 = 0, merchant2 = 0, store1 = 0, store2 = 0;
        try {
            String u1 = "shop-chat-u1-" + suffix + "@example.invalid";
            String u2 = "shop-chat-u2-" + suffix + "@example.invalid";
            String m1 = "shop-chat-m1-" + suffix + "@example.invalid";
            String m2 = "shop-chat-m2-" + suffix + "@example.invalid";
            users.create(u1, "test-hash", "USER", "用户甲");
            users.create(u2, "test-hash", "USER", "用户乙");
            users.create(m1, "test-hash", "MERCHANT", "商家甲");
            users.create(m2, "test-hash", "MERCHANT", "商家乙");
            user1 = users.findByEmail(u1).orElseThrow().id();
            user2 = users.findByEmail(u2).orElseThrow().id();
            merchant1 = users.findByEmail(m1).orElseThrow().id();
            merchant2 = users.findByEmail(m2).orElseThrow().id();
            store1 = merchants.create(merchant1, "测试店甲", "", "武汉", "甲路").id();
            store2 = merchants.create(merchant2, "测试店乙", "", "武汉", "乙路").id();
            long order1 = orders.create(user1, store1, "chat-test-one", 10000, LocalDateTime.now().plusMinutes(15));
            long order2 = orders.create(user2, store2, "chat-test-two", 10000, LocalDateTime.now().plusMinutes(15));

            final long buyer = user1;
            final long secondBuyer = user2, seller = merchant1, secondSeller = merchant2, secondStore = store2;
            var start = new CountDownLatch(1);
            var pool = Executors.newFixedThreadPool(8);
            try {
                Callable<Long> open = () -> {
                    start.await();
                    return tx.execute(status -> service.open(buyer, order1, "咨询订单商品").conversation().id());
                };
                var a = pool.submit(open);
                var b = pool.submit(open);
                start.countDown();
                long id = a.get(10, TimeUnit.SECONDS);
                assertEquals(id, b.get(10, TimeUnit.SECONDS));
                assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM shop_conversation WHERE order_id=?", Integer.class, order1));
                assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM shop_message WHERE conversation_id=?", Integer.class, id));
                assertEquals(1, service.list(user1, false).size());
                assertEquals(1, service.list(merchant1, true).size());
                assertTrue(service.list(user2, false).isEmpty());
                assertTrue(service.list(merchant2, true).isEmpty());
                assertEquals(HttpStatus.NOT_FOUND, assertThrows(ResponseStatusException.class,
                    () -> service.detail(secondBuyer, false, id)).getStatusCode());
                assertEquals(HttpStatus.NOT_FOUND, assertThrows(ResponseStatusException.class,
                    () -> service.detail(secondSeller, true, id)).getStatusCode());
                assertEquals(HttpStatus.NOT_FOUND, assertThrows(ResponseStatusException.class,
                    () -> tx.execute(status -> service.send(secondBuyer, false, id, "越权"))).getStatusCode());
                assertEquals(HttpStatus.NOT_FOUND, assertThrows(ResponseStatusException.class,
                    () -> tx.executeWithoutResult(status -> service.markRead(secondSeller, true, id))).getStatusCode());

                assertEquals(1, service.list(merchant1, true).get(0).unreadCount());
                tx.executeWithoutResult(status -> service.markRead(seller, true, id));
                assertEquals(0, service.list(merchant1, true).get(0).unreadCount());
                tx.execute(status -> service.send(seller, true, id, "您的订单可以咨询"));
                assertEquals(1, service.list(user1, false).get(0).unreadCount());

                var sendStart = new CountDownLatch(1);
                var sent = new java.util.ArrayList<java.util.concurrent.Future<?>>();
                for (int i = 0; i < 8; i++) {
                    final int number = i;
                    sent.add(pool.submit(() -> {
                        sendStart.await();
                        tx.execute(status -> service.send(buyer, false, id, "并发消息 " + number));
                        return null;
                    }));
                }
                sendStart.countDown();
                for (var future : sent) future.get(10, TimeUnit.SECONDS);
                assertEquals(10, jdbc.queryForObject("SELECT COUNT(*) FROM shop_message WHERE conversation_id=?", Integer.class, id));
                assertEquals(8, service.list(merchant1, true).get(0).unreadCount());

                assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () ->
                    tx.executeWithoutResult(status -> {
                        long bad = conversations.create(order2, secondBuyer, secondStore);
                        conversations.addMessage(bad, Long.MAX_VALUE, "外键失败");
                    }));
                assertTrue(conversations.byOrder(order2).isEmpty(), "failed first message must roll back its conversation");
                long secondId = tx.execute(status -> service.open(secondBuyer, order2, "第二个店铺的消息").conversation().id());
                assertNotEquals(id, secondId);
                assertEquals(1, service.list(merchant2, true).size());
                assertEquals(1, service.list(user2, false).size());
            } finally { pool.shutdownNow(); }
        } finally {
            if (store1 > 0) cleanupStore(jdbc, store1);
            if (store2 > 0) cleanupStore(jdbc, store2);
            if (user1 > 0) jdbc.update("DELETE FROM app_user WHERE id=?", user1);
            if (user2 > 0) jdbc.update("DELETE FROM app_user WHERE id=?", user2);
            if (merchant1 > 0) jdbc.update("DELETE FROM app_user WHERE id=?", merchant1);
            if (merchant2 > 0) jdbc.update("DELETE FROM app_user WHERE id=?", merchant2);
        }
    }

    private void cleanupStore(JdbcTemplate jdbc, long storeId) {
        jdbc.update("DELETE sm FROM shop_message sm JOIN shop_conversation c ON c.id=sm.conversation_id WHERE c.store_id=?", storeId);
        jdbc.update("DELETE FROM shop_conversation WHERE store_id=?", storeId);
        jdbc.update("DELETE FROM shop_order WHERE store_id=?", storeId);
        jdbc.update("DELETE FROM merchant_store WHERE id=?", storeId);
    }
}
