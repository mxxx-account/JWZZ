package com.jwzz.server.shop;

import static org.junit.jupiter.api.Assertions.*;

import com.jwzz.server.auth.UserStore;
import com.jwzz.server.merchant.MerchantCatalogStore;
import com.jwzz.server.merchant.MerchantStore;
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

class OrderServiceIntegrationTest {
    @Test void lastItemIsNotOversoldAndIdempotentCancelPayAcceptAndExpiry() throws Exception {
        String url = System.getenv("JWZZ_IT_DB_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Set JWZZ_IT_DB_URL to run order integration test");
        var dataSource = new DriverManagerDataSource(url, System.getenv("DB_USER"), System.getenv("DB_PASSWORD"));
        var jdbc = new JdbcTemplate(dataSource);
        var tx = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        var users = new UserStore(jdbc);
        var merchants = new MerchantStore(jdbc);
        var catalog = new MerchantCatalogStore(jdbc);
        var shop = new ShopStore(jdbc);
        var orderStore = new OrderStore(jdbc);
        var service = new OrderService(shop, orderStore, merchants);
        String suffix = UUID.randomUUID().toString();
        long merchant = 0, user1 = 0, user2 = 0, store = 0;
        try {
            String merchantEmail = "order-merchant-" + suffix + "@example.invalid";
            String user1Email = "order-user1-" + suffix + "@example.invalid";
            String user2Email = "order-user2-" + suffix + "@example.invalid";
            users.create(merchantEmail, "test-hash", "MERCHANT", "测试商家");
            users.create(user1Email, "test-hash", "USER", "顾客甲");
            users.create(user2Email, "test-hash", "USER", "顾客乙");
            merchant = users.findByEmail(merchantEmail).orElseThrow().id();
            user1 = users.findByEmail(user1Email).orElseThrow().id();
            user2 = users.findByEmail(user2Email).orElseThrow().id();
            store = merchants.create(merchant, "订单测试店-" + suffix, "", "武汉", "演示地址").id();
            catalog.seedStarter(store);
            long sku = catalog.products(store).stream().filter(item -> item.name().equals("电子血压计"))
                .findFirst().orElseThrow().id();
            catalog.setStatus(store, sku, "ON_SHELF");
            catalog.setAvailable(sku, merchant, 0, 1, "并发测试备货");
            merchants.setStatus(merchant, "OPEN");
            shop.add(user1, sku, 1);
            shop.add(user2, sku, 1);
            final long buyer1 = user1, buyer2 = user2;
            var start = new CountDownLatch(1);
            var pool = Executors.newFixedThreadPool(2);
            try {
                Callable<Long> first = () -> attempt(tx, service, buyer1, "first-order-key", start);
                Callable<Long> second = () -> attempt(tx, service, buyer2, "second-order-key", start);
                var a = pool.submit(first);
                var b = pool.submit(second);
                start.countDown();
                long aId = a.get(10, TimeUnit.SECONDS);
                long bId = b.get(10, TimeUnit.SECONDS);
                assertTrue((aId > 0) != (bId > 0), "exactly one buyer can reserve the last unit");
                long winner = aId > 0 ? buyer1 : buyer2;
                long orderId = aId > 0 ? aId : bId;
                String key = aId > 0 ? "first-order-key" : "second-order-key";
                assertInventory(jdbc, sku, 0, 1);
                long other = winner == buyer1 ? buyer2 : buyer1;
                var forbiddenRead = assertThrows(ResponseStatusException.class,
                    () -> service.userDetail(other, orderId));
                assertEquals(HttpStatus.NOT_FOUND, forbiddenRead.getStatusCode());

                long repeated = tx.execute(status -> service.checkout(winner, key).order().id());
                assertEquals(orderId, repeated, "same key must return the original order even after cart clearing");
                assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM shop_order WHERE store_id=?", Integer.class, store));
                assertEquals("CANCELLED", tx.execute(status -> service.cancel(winner, orderId).order().status()));
                assertEquals("CANCELLED", tx.execute(status -> service.cancel(winner, orderId).order().status()));
                assertInventory(jdbc, sku, 1, 0);
                assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM inventory_ledger WHERE sku_id=? AND reason='ORDER_CANCELLED'", Integer.class, sku));

                shop.add(winner, sku, 1);
                var duplicateStart = new CountDownLatch(1);
                Callable<Long> duplicate = () -> {
                    duplicateStart.await();
                    return tx.execute(status -> service.checkout(winner, "same-key-concurrent").order().id());
                };
                var duplicateA = pool.submit(duplicate);
                var duplicateB = pool.submit(duplicate);
                duplicateStart.countDown();
                long duplicateId = duplicateA.get(10, TimeUnit.SECONDS);
                assertEquals(duplicateId, duplicateB.get(10, TimeUnit.SECONDS));
                assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM shop_order WHERE store_id=?", Integer.class, store));
                assertInventory(jdbc, sku, 0, 1);
                tx.execute(status -> service.cancel(winner, duplicateId));
                assertInventory(jdbc, sku, 1, 0);

                shop.add(winner, sku, 1);
                long paidId = tx.execute(status -> service.checkout(winner, "paid-order-key").order().id());
                assertEquals("PAID", tx.execute(status -> service.pay(winner, paidId).order().status()));
                assertEquals("PAID", tx.execute(status -> service.pay(winner, paidId).order().status()));
                assertThrows(ResponseStatusException.class, () -> tx.execute(status -> service.cancel(winner, paidId)));
                final long seller = merchant;
                assertEquals("ACCEPTED", tx.execute(status -> service.accept(seller, paidId).order().status()));
                assertEquals("ACCEPTED", tx.execute(status -> service.accept(seller, paidId).order().status()));
                assertInventory(jdbc, sku, 0, 0);

                catalog.setAvailable(sku, merchant, 0, 1, "超时测试备货");
                shop.add(winner, sku, 1);
                long expiredId = tx.execute(status -> service.checkout(winner, "expired-order-key").order().id());
                jdbc.update("UPDATE shop_order SET expires_at=DATE_SUB(NOW(6), INTERVAL 1 MINUTE) WHERE id=?", expiredId);
                tx.executeWithoutResult(status -> service.expire(expiredId));
                tx.executeWithoutResult(status -> service.expire(expiredId));
                assertEquals("EXPIRED", service.userDetail(winner, expiredId).order().status());
                assertInventory(jdbc, sku, 1, 0);
                assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM inventory_ledger WHERE sku_id=? AND reason='ORDER_EXPIRED'", Integer.class, sku));
            } finally { pool.shutdownNow(); }
        } finally {
            if (store > 0) {
                jdbc.update("DELETE FROM shop_order_item WHERE order_id IN (SELECT id FROM shop_order WHERE store_id=?)", store);
                jdbc.update("DELETE FROM shop_order WHERE store_id=?", store);
            }
            if (user1 > 0) jdbc.update("DELETE FROM shopping_cart_item WHERE user_id=?", user1);
            if (user2 > 0) jdbc.update("DELETE FROM shopping_cart_item WHERE user_id=?", user2);
            if (store > 0) {
                jdbc.update("DELETE l FROM inventory_ledger l JOIN store_sku s ON s.id=l.sku_id WHERE s.store_id=?", store);
                jdbc.update("DELETE i FROM store_inventory i JOIN store_sku s ON s.id=i.sku_id WHERE s.store_id=?", store);
                jdbc.update("DELETE FROM store_sku WHERE store_id=?", store);
                jdbc.update("DELETE FROM merchant_store WHERE id=?", store);
            }
            if (user1 > 0) jdbc.update("DELETE FROM app_user WHERE id=?", user1);
            if (user2 > 0) jdbc.update("DELETE FROM app_user WHERE id=?", user2);
            if (merchant > 0) jdbc.update("DELETE FROM app_user WHERE id=?", merchant);
        }
    }

    private long attempt(TransactionTemplate tx, OrderService service, long user, String key, CountDownLatch start) throws Exception {
        start.await();
        try { return tx.execute(status -> service.checkout(user, key).order().id()); }
        catch (ResponseStatusException exception) {
            assertEquals(HttpStatus.CONFLICT, exception.getStatusCode());
            return 0;
        }
    }

    private void assertInventory(JdbcTemplate jdbc, long sku, int available, int reserved) {
        var row = jdbc.queryForMap("SELECT available, reserved FROM store_inventory WHERE sku_id=?", sku);
        assertEquals(available, ((Number) row.get("available")).intValue());
        assertEquals(reserved, ((Number) row.get("reserved")).intValue());
    }
}
