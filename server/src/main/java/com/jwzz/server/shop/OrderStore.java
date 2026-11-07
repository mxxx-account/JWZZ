package com.jwzz.server.shop;

import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class OrderStore {
    public record Order(long id, long userId, long storeId, String storeName, String status,
                        long totalCents, LocalDateTime expiresAt, LocalDateTime createdAt,
                        LocalDateTime paidAt, LocalDateTime acceptedAt, LocalDateTime closedAt) {}
    public record Item(long id, long skuId, String productName, long unitPriceCents, int quantity) {}
    public record Detail(Order order, List<Item> items) {}
    public record Stock(long skuId, long storeId, String storeStatus, String skuStatus,
                        String productName, long priceCents, int available, int reserved) {}

    private static final String ORDER_SELECT = """
        SELECT o.id, o.user_id, o.store_id, m.name AS store_name, o.status, o.total_cents,
               o.expires_at, o.created_at, o.paid_at, o.accepted_at, o.closed_at
        FROM shop_order o JOIN merchant_store m ON m.id=o.store_id
        """;
    private final JdbcTemplate jdbc;
    public OrderStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Optional<Order> byKey(long userId, String key) {
        return jdbc.query(ORDER_SELECT + " WHERE o.user_id=? AND o.idempotency_key=?",
            (rs, row) -> map(rs), userId, key).stream().findFirst();
    }

    public Optional<Order> byId(long id) {
        return jdbc.query(ORDER_SELECT + " WHERE o.id=?", (rs, row) -> map(rs), id).stream().findFirst();
    }

    public Optional<Order> lock(long id) {
        return jdbc.query(ORDER_SELECT + " WHERE o.id=? FOR UPDATE", (rs, row) -> map(rs), id).stream().findFirst();
    }

    public List<Order> forUser(long userId) {
        return jdbc.query(ORDER_SELECT + " WHERE o.user_id=? ORDER BY o.id DESC LIMIT 100",
            (rs, row) -> map(rs), userId);
    }

    public List<Order> forMerchant(long merchantId) {
        return jdbc.query(ORDER_SELECT + " WHERE m.merchant_id=? ORDER BY o.id DESC LIMIT 100",
            (rs, row) -> map(rs), merchantId);
    }

    public Detail detail(Order order) {
        List<Item> items = jdbc.query("""
            SELECT id, sku_id, product_name, unit_price_cents, quantity
            FROM shop_order_item WHERE order_id=? ORDER BY id
            """, (rs, row) -> new Item(rs.getLong("id"), rs.getLong("sku_id"), rs.getString("product_name"),
                rs.getLong("unit_price_cents"), rs.getInt("quantity")), order.id());
        return new Detail(order, items);
    }

    private Order map(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Order(rs.getLong("id"), rs.getLong("user_id"), rs.getLong("store_id"),
            rs.getString("store_name"), rs.getString("status"), rs.getLong("total_cents"),
            rs.getTimestamp("expires_at").toLocalDateTime(), rs.getTimestamp("created_at").toLocalDateTime(),
            timestamp(rs, "paid_at"), timestamp(rs, "accepted_at"), timestamp(rs, "closed_at"));
    }

    private LocalDateTime timestamp(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        var value = rs.getTimestamp(column);
        return value == null ? null : value.toLocalDateTime();
    }

    public Optional<Stock> lockStock(long skuId) {
        return jdbc.query("""
            SELECT s.id, s.store_id, m.status AS store_status, s.status AS sku_status,
                   s.name, s.price_cents, i.available, i.reserved
            FROM store_inventory i JOIN store_sku s ON s.id=i.sku_id
            JOIN merchant_store m ON m.id=s.store_id WHERE s.id=? FOR UPDATE
            """, (rs, row) -> new Stock(rs.getLong("id"), rs.getLong("store_id"),
                rs.getString("store_status"), rs.getString("sku_status"), rs.getString("name"),
                rs.getLong("price_cents"), rs.getInt("available"), rs.getInt("reserved")), skuId)
            .stream().findFirst();
    }

    public void reserve(Stock stock, int quantity, long actorId) {
        int changed = jdbc.update("""
            UPDATE store_inventory SET available=available-?, reserved=reserved+?
            WHERE sku_id=? AND available>=?
            """, quantity, quantity, stock.skuId(), quantity);
        if (changed != 1) throw new IllegalStateException("Inventory reservation lost race");
        ledger(stock.skuId(), actorId, -quantity, stock.available(), stock.available() - quantity,
            "ORDER_RESERVED", "模拟订单预留");
    }

    public void release(long skuId, int quantity, long actorId, String reason) {
        Stock stock = lockStock(skuId).orElseThrow();
        int changed = jdbc.update("""
            UPDATE store_inventory SET available=available+?, reserved=reserved-?
            WHERE sku_id=? AND reserved>=?
            """, quantity, quantity, skuId, quantity);
        if (changed != 1) throw new IllegalStateException("Reserved inventory missing");
        ledger(skuId, actorId, quantity, stock.available(), stock.available() + quantity, reason, "模拟订单释放");
    }

    public void consume(long skuId, int quantity, long actorId) {
        Stock stock = lockStock(skuId).orElseThrow();
        int changed = jdbc.update("UPDATE store_inventory SET reserved=reserved-? WHERE sku_id=? AND reserved>=?",
            quantity, skuId, quantity);
        if (changed != 1) throw new IllegalStateException("Reserved inventory missing");
        ledger(skuId, actorId, 0, stock.available(), stock.available(), "ORDER_ACCEPTED", "模拟接单，预留转已售");
    }

    private void ledger(long skuId, long actorId, int delta, int before, int after, String reason, String note) {
        jdbc.update("""
            INSERT INTO inventory_ledger (sku_id, actor_id, delta, before_available, after_available, reason, note)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, skuId, actorId, delta, before, after, reason, note);
    }

    public long create(long userId, long storeId, String key, long total, LocalDateTime expiresAt) {
        var keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("""
                INSERT INTO shop_order (user_id, store_id, idempotency_key, status, total_cents, expires_at)
                VALUES (?, ?, ?, 'PENDING_PAYMENT', ?, ?)
                """, Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, userId);
            statement.setLong(2, storeId);
            statement.setString(3, key);
            statement.setLong(4, total);
            statement.setObject(5, expiresAt);
            return statement;
        }, keys);
        return keys.getKey().longValue();
    }

    public void addItem(long orderId, Stock stock, int quantity) {
        jdbc.update("""
            INSERT INTO shop_order_item (order_id, sku_id, product_name, unit_price_cents, quantity)
            VALUES (?, ?, ?, ?, ?)
            """, orderId, stock.skuId(), stock.productName(), stock.priceCents(), quantity);
    }

    public void clearCart(long userId) { jdbc.update("DELETE FROM shopping_cart_item WHERE user_id=?", userId); }

    public void transition(long orderId, String from, String to, String timestampColumn) {
        String column = switch (timestampColumn) {
            case "paid_at", "accepted_at", "closed_at" -> timestampColumn;
            default -> throw new IllegalArgumentException("Unknown timestamp column");
        };
        int changed = jdbc.update("UPDATE shop_order SET status=?, " + column + "=CURRENT_TIMESTAMP(6) WHERE id=? AND status=?",
            to, orderId, from);
        if (changed != 1) throw new IllegalStateException("Order status changed concurrently");
    }

    public List<Long> dueIds() {
        return jdbc.query("""
            SELECT id FROM shop_order WHERE status='PENDING_PAYMENT' AND expires_at<=CURRENT_TIMESTAMP(6)
            ORDER BY expires_at LIMIT 100
            """, (rs, row) -> rs.getLong("id"));
    }
}
