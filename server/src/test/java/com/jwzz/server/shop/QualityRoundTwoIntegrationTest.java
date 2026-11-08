package com.jwzz.server.shop;

import static org.junit.jupiter.api.Assertions.*;
import com.jwzz.server.auth.UserStore;
import com.jwzz.server.merchant.MerchantCatalogStore;
import com.jwzz.server.merchant.MerchantStore;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

class QualityRoundTwoIntegrationTest {
    static class Fixture implements AutoCloseable {
        final JdbcTemplate db;
        final TransactionTemplate tx;
        final ShopStore shop;
        final OrderStore orders;
        final OrderService service;
        final List<Long> users = new ArrayList<>();
        long merchant, store, sku;
        Fixture() {
            String url = System.getenv("JWZZ_IT_DB_URL");
            Assumptions.assumeTrue(url != null && !url.isBlank(), "Set JWZZ_IT_DB_URL");
            assertTrue(url.matches("jdbc:mysql://(localhost|127\\.0\\.0\\.1)(:|/).*"), "Local test database only");
            var ds = new DriverManagerDataSource(url, System.getenv("DB_USER"), System.getenv("DB_PASSWORD"));
            db = new JdbcTemplate(ds);
            tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
            shop = new ShopStore(db); orders = new OrderStore(db);
            var stores = new MerchantStore(db);
            service = new OrderService(shop, orders, stores);
            try {
                merchant = user("MERCHANT");
                store = stores.create(merchant, "二轮测试店-" + UUID.randomUUID(), "", "武汉", "虚构地址").id();
                var catalog = new MerchantCatalogStore(db);
                catalog.seedStarter(store);
                sku = catalog.products(store).get(0).id();
                catalog.setStatus(store, sku, "ON_SHELF");
                stores.setStatus(merchant, "OPEN");
                restock();
            } catch (RuntimeException | Error error) { close(); throw error; }
        }
        long user(String role) {
            var accounts = new UserStore(db);
            String email = "round2-" + UUID.randomUUID() + "@example.invalid";
            accounts.create(email, "test-hash", role, "二轮测试");
            long id = accounts.findByEmail(email).orElseThrow().id(); users.add(id); return id;
        }
        void restock() { db.update("UPDATE store_inventory SET available=1,reserved=0 WHERE sku_id=?", sku); }
        long checkout(long user, String key) {
            shop.add(user, sku, 1);
            return tx.execute(s -> service.checkout(user, key).order().id());
        }
        void inventory(int available, int reserved) {
            var row = db.queryForMap("SELECT available,reserved FROM store_inventory WHERE sku_id=?", sku);
            assertEquals(available, ((Number)row.get("available")).intValue());
            assertEquals(reserved, ((Number)row.get("reserved")).intValue());
        }
        int releases() { return db.queryForObject("SELECT COUNT(*) FROM inventory_ledger WHERE sku_id=? AND reason IN ('ORDER_CANCELLED','ORDER_EXPIRED')", Integer.class, sku); }
        public void close() {
            if (store > 0) {
                db.update("DELETE m FROM shop_message m JOIN shop_conversation c ON c.id=m.conversation_id WHERE c.store_id=?", store);
                db.update("DELETE FROM shop_conversation WHERE store_id=?", store);
                db.update("DELETE FROM shop_order_item WHERE order_id IN (SELECT id FROM shop_order WHERE store_id=?)", store);
                db.update("DELETE FROM shop_order WHERE store_id=?", store);
                db.update("DELETE FROM shopping_cart_item WHERE sku_id IN (SELECT id FROM store_sku WHERE store_id=?)", store);
                db.update("DELETE l FROM inventory_ledger l JOIN store_sku s ON s.id=l.sku_id WHERE s.store_id=?", store);
                db.update("DELETE i FROM store_inventory i JOIN store_sku s ON s.id=i.sku_id WHERE s.store_id=?", store);
                db.update("DELETE FROM store_sku WHERE store_id=?", store);
                db.update("DELETE FROM merchant_store WHERE id=?", store);
            }
            for (long id : users) db.update("DELETE FROM app_user WHERE id=?", id);
        }
    }

    private List<String> race(List<Callable<String>> actions) throws Exception {
        var ready = new CountDownLatch(actions.size());
        var start = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(actions.size());
        try {
            var futures = new ArrayList<Future<String>>();
            for (var action : actions) futures.add(pool.submit(() -> {
                ready.countDown(); assertTrue(start.await(10, TimeUnit.SECONDS));
                try { return action.call(); }
                catch (ResponseStatusException e) { assertEquals(HttpStatus.CONFLICT, e.getStatusCode()); return "CONFLICT"; }
            }));
            assertTrue(ready.await(10, TimeUnit.SECONDS)); start.countDown();
            var result = new ArrayList<String>();
            for (var future : futures) result.add(future.get(20, TimeUnit.SECONDS));
            return result;
        } finally { pool.shutdownNow(); assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS)); }
    }

    @Test void twentyBuyersAndTwentyDuplicateSubmissions() throws Exception {
        try (var f = new Fixture()) {
            var actions = new ArrayList<Callable<String>>();
            for (int i=0; i<20; i++) {
                long buyer = f.user("USER"); f.shop.add(buyer, f.sku, 1);
                actions.add(() -> f.tx.execute(s -> String.valueOf(f.service.checkout(buyer, "race-last-one").order().id())));
            }
            var result = race(actions);
            assertEquals(19, Collections.frequency(result, "CONFLICT")); f.inventory(0,1);
            assertEquals(1, f.db.queryForObject("SELECT COUNT(*) FROM shop_order WHERE store_id=?", Integer.class, f.store));
            var winner = f.db.queryForMap("SELECT id,user_id FROM shop_order WHERE store_id=?", f.store);
            long buyer = ((Number)winner.get("user_id")).longValue(), order = ((Number)winner.get("id")).longValue();
            f.tx.execute(s -> f.service.cancel(buyer,order)); f.inventory(1,0);
            f.shop.add(buyer,f.sku,1);
            actions.clear();
            for (int i=0; i<20; i++) actions.add(() -> f.tx.execute(s -> String.valueOf(f.service.checkout(buyer,"same-twenty-key").order().id())));
            var duplicate = race(actions);
            assertEquals(1,new HashSet<>(duplicate).size()); assertFalse(duplicate.contains("CONFLICT")); f.inventory(0,1);
            assertEquals(2, f.db.queryForObject("SELECT COUNT(*) FROM shop_order WHERE store_id=?", Integer.class, f.store));
            System.out.println("ROUND2 stock-race: buyers=20 winners=1 conflicts=19; duplicate-submit=20 unique-order=1");
        }
    }

    @Test void paymentVersusCancellationThirtyTimes() throws Exception {
        try (var f = new Fixture()) {
            long buyer = f.user("USER"); var outcomes = new TreeMap<String,Integer>();
            for (int i=0; i<30; i++) {
                f.restock(); long order = f.checkout(buyer,"pay-cancel-"+i); int before=f.releases();
                race(List.of(() -> f.tx.execute(s -> f.service.pay(buyer,order).order().status()),
                    () -> f.tx.execute(s -> f.service.cancel(buyer,order).order().status())));
                String state=f.service.userDetail(buyer,order).order().status(); outcomes.merge(state,1,Integer::sum);
                if (state.equals("PAID")) {
                    f.inventory(0,1); assertEquals(before,f.releases());
                    f.tx.execute(s -> f.service.accept(f.merchant,order)); f.inventory(0,0);
                } else {
                    assertEquals("CANCELLED",state); f.inventory(1,0); assertEquals(before+1,f.releases());
                }
            }
            System.out.println("ROUND2 pay-cancel 30 iterations: " + outcomes);
        }
    }

    @Test void paymentExpiryAndCancellationTwentyTimes() throws Exception {
        try (var f = new Fixture()) {
            long buyer=f.user("USER");
            for (int i=0; i<20; i++) {
                f.restock(); long order=f.checkout(buyer,"expiry-race-"+i); int before=f.releases();
                f.db.update("UPDATE shop_order SET expires_at=DATE_SUB(NOW(6), INTERVAL 1 MINUTE) WHERE id=?",order);
                race(List.of(() -> f.tx.execute(s -> f.service.pay(buyer,order).order().status()),
                    () -> { f.tx.executeWithoutResult(s -> f.service.expire(order)); return "SCANNED"; },
                    () -> f.tx.execute(s -> f.service.cancel(buyer,order).order().status())));
                assertEquals("EXPIRED",f.service.userDetail(buyer,order).order().status());
                f.inventory(1,0); assertEquals(before+1,f.releases());
            }
            System.out.println("ROUND2 pay-expire-cancel: 20 expired orders, exactly one release each");
        }
    }

    @Test void persistedMessageHistoryAt199200201() {
        try (var f = new Fixture()) {
            long buyer=f.user("USER"), order=f.checkout(buyer,"history-limit");
            var chats=new ShopConversationStore(f.db);
            long chat=chats.create(order,buyer,f.store);
            for (int i=1; i<=201; i++) {
                chats.addMessage(chat,buyer,"persistent-message-"+i);
                if (i>=199) {
                    var messages=chats.messages(chat);
                    assertEquals(Math.min(i,200),messages.size());
                    assertEquals("persistent-message-"+(i==201?2:1),messages.get(0).body());
                    assertEquals("persistent-message-"+i,messages.get(messages.size()-1).body());
                }
            }
            assertEquals(201,f.db.queryForObject("SELECT COUNT(*) FROM shop_message WHERE conversation_id=?",Integer.class,chat));
            System.out.println("ROUND2 persisted messages=201; detail capped=200; oldest persisted row retained");
        }
    }
}
