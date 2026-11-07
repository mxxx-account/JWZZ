package com.jwzz.server.merchant;

import static org.junit.jupiter.api.Assertions.*;
import java.util.UUID;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import com.jwzz.server.auth.UserStore;

/** Opt-in real-MySQL test for one-store-per-merchant and owner isolation. */
class MerchantStoreIntegrationTest {
    @Test void storesAreIsolatedAndMerchantCannotCreateTwo() {
        String url = System.getenv("JWZZ_IT_DB_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Set JWZZ_IT_DB_URL to run merchant store integration test");
        var source = new DriverManagerDataSource(url, System.getenv("DB_USER"), System.getenv("DB_PASSWORD"));
        var jdbc = new JdbcTemplate(source);
        var users = new UserStore(jdbc);
        var stores = new MerchantStore(jdbc);
        String suffix = UUID.randomUUID().toString();
        String firstEmail = "merchant-one-" + suffix + "@example.invalid";
        String secondEmail = "merchant-two-" + suffix + "@example.invalid";
        long firstId = 0, secondId = 0;
        try {
            users.create(firstEmail, "test-hash", "MERCHANT", "商家甲");
            users.create(secondEmail, "test-hash", "MERCHANT", "商家乙");
            firstId = users.findByEmail(firstEmail).orElseThrow().id();
            secondId = users.findByEmail(secondEmail).orElseThrow().id();

            assertTrue(stores.ownedBy(firstId).isEmpty());
            var first = stores.create(firstId, "甲店", "演示", "武汉市", "甲路 1 号");
            var second = stores.create(secondId, "乙店", "演示", "上海市", "乙路 2 号");
            assertEquals("DRAFT", first.status());
            assertNotEquals(first.id(), second.id());
            assertEquals("甲店", stores.ownedBy(firstId).orElseThrow().name());
            assertEquals("乙店", stores.ownedBy(secondId).orElseThrow().name());
            assertThrows(DuplicateKeyException.class, () -> stores.create(first.merchantId(),
                "重复店", "", "武汉市", "甲路 3 号"));

            var updated = stores.update(firstId, "甲店更新", "新介绍", "武汉市", "甲路 9 号").orElseThrow();
            assertEquals(first.id(), updated.id());
            assertEquals("甲店更新", updated.name());
            assertEquals("乙店", stores.ownedBy(secondId).orElseThrow().name());
        } finally {
            if (firstId > 0) jdbc.update("DELETE FROM merchant_store WHERE merchant_id=?", firstId);
            if (secondId > 0) jdbc.update("DELETE FROM merchant_store WHERE merchant_id=?", secondId);
            if (firstId > 0) jdbc.update("DELETE FROM app_user WHERE id=?", firstId);
            if (secondId > 0) jdbc.update("DELETE FROM app_user WHERE id=?", secondId);
        }
    }
}
