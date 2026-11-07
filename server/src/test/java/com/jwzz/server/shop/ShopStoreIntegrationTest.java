package com.jwzz.server.shop;

import static org.junit.jupiter.api.Assertions.*;
import java.util.UUID;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import com.jwzz.server.auth.UserStore;
import com.jwzz.server.merchant.MerchantCatalogStore;
import com.jwzz.server.merchant.MerchantStore;

/** Opt-in MySQL test for visible offers and persistent cart snapshots. */
class ShopStoreIntegrationTest {
    @Test void onlyOpenListedStockedOffersAppearAndCartRetainsUnavailableItems() {
        String url = System.getenv("JWZZ_IT_DB_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Set JWZZ_IT_DB_URL to run shop integration test");
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(url, System.getenv("DB_USER"), System.getenv("DB_PASSWORD")));
        var users = new UserStore(jdbc);
        var stores = new MerchantStore(jdbc);
        var catalog = new MerchantCatalogStore(jdbc);
        var shop = new ShopStore(jdbc);
        String suffix = UUID.randomUUID().toString();
        long merchant1 = 0, merchant2 = 0, user = 0, otherUser = 0, store1 = 0, store2 = 0;
        try {
            String email1 = "shop-merchant-1-" + suffix + "@example.invalid";
            String email2 = "shop-merchant-2-" + suffix + "@example.invalid";
            String userEmail = "shop-user-" + suffix + "@example.invalid";
            String otherEmail = "shop-other-user-" + suffix + "@example.invalid";
            users.create(email1, "test-hash", "MERCHANT", "甲");
            users.create(email2, "test-hash", "MERCHANT", "乙");
            users.create(userEmail, "test-hash", "USER", "顾客");
            users.create(otherEmail, "test-hash", "USER", "另一顾客");
            merchant1 = users.findByEmail(email1).orElseThrow().id();
            merchant2 = users.findByEmail(email2).orElseThrow().id();
            user = users.findByEmail(userEmail).orElseThrow().id();
            otherUser = users.findByEmail(otherEmail).orElseThrow().id();
            store1 = stores.create(merchant1, "甲演示店-" + suffix, "", "武汉", "甲路").id();
            store2 = stores.create(merchant2, "乙演示店-" + suffix, "", "上海", "乙路").id();
            catalog.seedStarter(store1); catalog.seedStarter(store2);
            long sku1 = catalog.products(store1).stream().filter(item -> item.name().equals("电子血压计")).findFirst().orElseThrow().id();
            long sku2 = catalog.products(store2).stream().filter(item -> item.name().equals("电子血压计")).findFirst().orElseThrow().id();
            assertEquals(0, shop.search(suffix, "", "NEWEST", 0, 12).total());

            catalog.setStatus(store1, sku1, "ON_SHELF");
            catalog.setAvailable(sku1, merchant1, 0, 5, "演示备货");
            assertEquals(0, shop.search(suffix, "", "NEWEST", 0, 12).total(), "draft store is hidden");
            stores.setStatus(merchant1, "OPEN");
            assertEquals(1, shop.search(suffix, "", "NEWEST", 0, 12).total());
            assertEquals(sku1, shop.search(suffix, "", "NEWEST", 0, 12).items().get(0).skuId());
            assertEquals(0, shop.search(suffix, "日常用品", "NEWEST", 0, 12).total());
            assertTrue(shop.offer(sku2).isEmpty());

            catalog.setStatus(store2, sku2, "ON_SHELF");
            catalog.setAvailable(sku2, merchant2, 0, 3, "演示备货");
            stores.setStatus(merchant2, "OPEN");
            assertEquals(2, shop.search(suffix, "", "PRICE_ASC", 0, 12).total());
            shop.add(user, sku1, 2);
            assertEquals(1, shop.cart(user).size());
            assertTrue(shop.cart(user).get(0).purchasable());
            assertEquals(2, shop.cart(user).get(0).quantity());
            assertTrue(shop.cart(otherUser).isEmpty());
            assertEquals(0, shop.updateQuantity(otherUser, shop.cart(user).get(0).id(), 3));
            assertEquals(0, shop.remove(otherUser, shop.cart(user).get(0).id()));
            catalog.setStatus(store1, sku1, "OFF_SHELF");
            assertTrue(shop.offer(sku1).isEmpty());
            assertEquals(1, shop.cart(user).size(), "cart item remains so the user can remove it");
            assertFalse(shop.cart(user).get(0).purchasable());
        } finally {
            if (user > 0) jdbc.update("DELETE FROM shopping_cart_item WHERE user_id=?", user);
            if (store1 > 0) cleanup(jdbc, store1);
            if (store2 > 0) cleanup(jdbc, store2);
            if (user > 0) jdbc.update("DELETE FROM app_user WHERE id=?", user);
            if (otherUser > 0) jdbc.update("DELETE FROM app_user WHERE id=?", otherUser);
            if (merchant1 > 0) jdbc.update("DELETE FROM app_user WHERE id=?", merchant1);
            if (merchant2 > 0) jdbc.update("DELETE FROM app_user WHERE id=?", merchant2);
        }
    }

    private void cleanup(JdbcTemplate jdbc, long storeId) {
        jdbc.update("DELETE l FROM inventory_ledger l JOIN store_sku s ON s.id=l.sku_id WHERE s.store_id=?", storeId);
        jdbc.update("DELETE i FROM store_inventory i JOIN store_sku s ON s.id=i.sku_id WHERE s.store_id=?", storeId);
        jdbc.update("DELETE FROM store_sku WHERE store_id=?", storeId);
        jdbc.update("DELETE FROM merchant_store WHERE id=?", storeId);
    }
}
