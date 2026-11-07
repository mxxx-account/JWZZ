package com.jwzz.server.merchant;

import static org.junit.jupiter.api.Assertions.*;
import java.util.UUID;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import com.jwzz.server.auth.UserStore;

/** Opt-in MySQL test for template seeding, tenant isolation and inventory audit. */
class MerchantCatalogIntegrationTest {
    @Test void starterProductsAreUnsoldAndInventoryChangesAreAuditedPerStore() {
        String url = System.getenv("JWZZ_IT_DB_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Set JWZZ_IT_DB_URL to run catalog integration test");
        var source = new DriverManagerDataSource(url, System.getenv("DB_USER"), System.getenv("DB_PASSWORD"));
        var jdbc = new JdbcTemplate(source);
        var users = new UserStore(jdbc);
        var stores = new MerchantStore(jdbc);
        var catalog = new MerchantCatalogStore(jdbc);
        var tx = new TransactionTemplate(new DataSourceTransactionManager(source));
        String suffix = UUID.randomUUID().toString();
        long firstOwner = 0, secondOwner = 0, firstStore = 0, secondStore = 0;
        try {
            String firstEmail = "catalog-one-" + suffix + "@example.invalid";
            String secondEmail = "catalog-two-" + suffix + "@example.invalid";
            users.create(firstEmail, "test-hash", "MERCHANT", "甲商家");
            users.create(secondEmail, "test-hash", "MERCHANT", "乙商家");
            firstOwner = users.findByEmail(firstEmail).orElseThrow().id();
            secondOwner = users.findByEmail(secondEmail).orElseThrow().id();
            firstStore = stores.create(firstOwner, "甲店", "", "武汉", "甲路").id();
            secondStore = stores.create(secondOwner, "乙店", "", "上海", "乙路").id();
            catalog.seedStarter(firstStore);
            catalog.seedStarter(secondStore);
            assertEquals(6, catalog.templates().size());
            assertEquals(3, catalog.products(firstStore).size());
            assertEquals(3, catalog.products(secondStore).size());
            assertTrue(catalog.products(firstStore).stream().allMatch(item -> item.available() == 0
                && item.reserved() == 0 && item.status().equals("OFF_SHELF")));

            long skuId = catalog.products(firstStore).get(0).id();
            assertTrue(catalog.product(secondStore, skuId).isEmpty(), "another store cannot resolve this SKU");
            assertTrue(catalog.update(secondStore, skuId, "越权修改", "", 2000).isEmpty());
            assertTrue(catalog.setStatus(secondStore, skuId, "ON_SHELF").isEmpty());
            var edited = catalog.update(firstStore, skuId, "改名的演示用品", "说明", 12345).orElseThrow();
            assertEquals(12345, edited.priceCents());
            assertEquals("ON_SHELF", catalog.setStatus(firstStore, skuId, "ON_SHELF").orElseThrow().status());

            long finalStore = firstStore, finalOwner = firstOwner;
            assertThrows(IllegalStateException.class, () -> tx.executeWithoutResult(status -> {
                int before = catalog.lockAvailable(finalStore, skuId).orElseThrow();
                catalog.setAvailable(skuId, finalOwner, before, 5, "应回滚的入库");
                throw new IllegalStateException("force rollback");
            }));
            assertEquals(0, catalog.product(firstStore, skuId).orElseThrow().available());
            assertTrue(catalog.ledger(firstStore, skuId).isEmpty(), "stock and ledger must roll back together");
            tx.executeWithoutResult(status -> {
                int before = catalog.lockAvailable(finalStore, skuId).orElseThrow();
                catalog.setAvailable(skuId, finalOwner, before, 7, "演示入库");
            });
            assertEquals(7, catalog.product(firstStore, skuId).orElseThrow().available());
            var movements = catalog.ledger(firstStore, skuId);
            assertEquals(1, movements.size());
            assertEquals(7, movements.get(0).delta());
            assertEquals(0, movements.get(0).beforeAvailable());
            assertEquals(7, movements.get(0).afterAvailable());
            assertEquals("演示入库", movements.get(0).note());
            tx.executeWithoutResult(status -> catalog.setAvailable(skuId, finalOwner,
                catalog.lockAvailable(finalStore, skuId).orElseThrow(), 7, "无变化"));
            assertEquals(1, catalog.ledger(firstStore, skuId).size(), "no-op adjustment should not add a movement");
            assertTrue(catalog.ledger(secondStore, skuId).isEmpty());

            var mask = catalog.templates().stream().filter(item -> item.code().equals("MASK")).findFirst().orElseThrow();
            catalog.create(firstStore, mask.id(), mask.name(), mask.category(), mask.description(), 2999);
            assertThrows(DuplicateKeyException.class, () -> catalog.create(finalStore, mask.id(), mask.name(), mask.category(), mask.description(), 2999));
            var custom = catalog.create(secondStore, null, "自定义演示用品", "日常用品", "", 3999);
            assertNull(custom.templateId());
            assertEquals(0, custom.available());
        } finally {
            if (firstStore > 0) cleanup(jdbc, firstStore);
            if (secondStore > 0) cleanup(jdbc, secondStore);
            if (firstOwner > 0) jdbc.update("DELETE FROM app_user WHERE id=?", firstOwner);
            if (secondOwner > 0) jdbc.update("DELETE FROM app_user WHERE id=?", secondOwner);
        }
    }

    private void cleanup(JdbcTemplate jdbc, long storeId) {
        jdbc.update("DELETE l FROM inventory_ledger l JOIN store_sku s ON s.id=l.sku_id WHERE s.store_id=?", storeId);
        jdbc.update("DELETE i FROM store_inventory i JOIN store_sku s ON s.id=i.sku_id WHERE s.store_id=?", storeId);
        jdbc.update("DELETE FROM store_sku WHERE store_id=?", storeId);
        jdbc.update("DELETE FROM merchant_store WHERE id=?", storeId);
    }
}
