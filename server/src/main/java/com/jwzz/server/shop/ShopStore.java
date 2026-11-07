package com.jwzz.server.shop;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ShopStore {
    public record Offer(long skuId, long storeId, String storeName, String storeCity, String storeAddress,
                        String productName, String category, String description, long priceCents, int available) {}
    public record Page(List<Offer> items, long total, int page, int size) {}
    public record CartItem(long id, long skuId, long storeId, String storeName, String productName,
                           long priceCents, int quantity, int available, boolean purchasable) {}

    private static final String OFFER_SELECT = """
        SELECT s.id AS sku_id, m.id AS store_id, m.name AS store_name, m.city AS store_city,
               m.address AS store_address, s.name AS product_name, s.category, s.description,
               s.price_cents, i.available
        FROM store_sku s JOIN merchant_store m ON m.id=s.store_id
        JOIN store_inventory i ON i.sku_id=s.id
        WHERE m.status='OPEN' AND s.status='ON_SHELF' AND i.available>0
        """;

    private final JdbcTemplate jdbc;
    public ShopStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Page search(String query, String category, String sort, int page, int size) {
        StringBuilder filter = new StringBuilder();
        List<Object> arguments = new ArrayList<>();
        if (!query.isBlank()) {
            filter.append(" AND LOCATE(?, LOWER(CONCAT(s.name, ' ', m.name)))>0");
            arguments.add(query.toLowerCase(java.util.Locale.ROOT));
        }
        if (!category.isBlank()) { filter.append(" AND s.category=?"); arguments.add(category); }
        Long count = jdbc.queryForObject("""
            SELECT COUNT(*) FROM store_sku s JOIN merchant_store m ON m.id=s.store_id
            JOIN store_inventory i ON i.sku_id=s.id
            WHERE m.status='OPEN' AND s.status='ON_SHELF' AND i.available>0
            """ + filter, Long.class, arguments.toArray());
        String order = switch (sort) {
            case "PRICE_ASC" -> "s.price_cents ASC, s.id DESC";
            case "PRICE_DESC" -> "s.price_cents DESC, s.id DESC";
            default -> "s.id DESC";
        };
        arguments.add(size); arguments.add(page * size);
        List<Offer> items = jdbc.query(OFFER_SELECT + filter + " ORDER BY " + order + " LIMIT ? OFFSET ?",
            (rs, row) -> offer(rs), arguments.toArray());
        return new Page(items, count == null ? 0 : count, page, size);
    }

    public Optional<Offer> offer(long skuId) {
        return jdbc.query(OFFER_SELECT + " AND s.id=?", (rs, row) -> offer(rs), skuId).stream().findFirst();
    }

    private Offer offer(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Offer(rs.getLong("sku_id"), rs.getLong("store_id"), rs.getString("store_name"),
            rs.getString("store_city"), rs.getString("store_address"), rs.getString("product_name"),
            rs.getString("category"), rs.getString("description"), rs.getLong("price_cents"),
            rs.getInt("available"));
    }

    public List<CartItem> cart(long userId) {
        return jdbc.query("""
            SELECT c.id, c.sku_id, s.store_id, m.name AS store_name, s.name AS product_name,
                   s.price_cents, c.quantity, i.available, m.status AS store_status, s.status AS sku_status
            FROM shopping_cart_item c JOIN store_sku s ON s.id=c.sku_id
            JOIN merchant_store m ON m.id=s.store_id JOIN store_inventory i ON i.sku_id=s.id
            WHERE c.user_id=? ORDER BY c.id
            """, (rs, row) -> new CartItem(rs.getLong("id"), rs.getLong("sku_id"), rs.getLong("store_id"),
                rs.getString("store_name"), rs.getString("product_name"), rs.getLong("price_cents"),
                rs.getInt("quantity"), rs.getInt("available"),
                rs.getString("store_status").equals("OPEN") && rs.getString("sku_status").equals("ON_SHELF")
                    && rs.getInt("available") >= rs.getInt("quantity")), userId);
    }

    public void lockUser(long userId) {
        jdbc.queryForObject("SELECT id FROM app_user WHERE id=? FOR UPDATE", Long.class, userId);
    }

    public Optional<CartItem> cartItem(long userId, long itemId) {
        return cart(userId).stream().filter(item -> item.id() == itemId).findFirst();
    }

    public void add(long userId, long skuId, int quantity) {
        jdbc.update("""
            INSERT INTO shopping_cart_item (user_id, sku_id, quantity) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)
            """, userId, skuId, quantity);
    }

    public int updateQuantity(long userId, long itemId, int quantity) {
        return jdbc.update("UPDATE shopping_cart_item SET quantity=? WHERE user_id=? AND id=?",
            quantity, userId, itemId);
    }

    public int remove(long userId, long itemId) {
        return jdbc.update("DELETE FROM shopping_cart_item WHERE user_id=? AND id=?", userId, itemId);
    }
}
