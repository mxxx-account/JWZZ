package com.jwzz.server.merchant;

import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class MerchantCatalogStore {
    public record Template(long id, String code, String name, String category, String description) {}
    public record Product(long id, long storeId, Long templateId, String name, String category,
                          String description, long priceCents, String status, int available, int reserved) {}
    public record Ledger(long id, long skuId, long actorId, int delta, int beforeAvailable,
                         int afterAvailable, String reason, String note, LocalDateTime createdAt) {}

    private final JdbcTemplate jdbc;

    public MerchantCatalogStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public List<Template> templates() {
        return jdbc.query("SELECT id, code, name, category, description FROM product_template WHERE active=TRUE ORDER BY id",
            (rs, row) -> new Template(rs.getLong("id"), rs.getString("code"), rs.getString("name"),
                rs.getString("category"), rs.getString("description")));
    }

    public Optional<Template> template(long id) {
        return templates().stream().filter(item -> item.id() == id).findFirst();
    }

    public void seedStarter(long storeId) {
        jdbc.update("""
            INSERT INTO store_sku (store_id, template_id, name, category, description, price_cents)
            SELECT ?, id, name, category, description, 10000 FROM product_template
            WHERE code IN ('BP_MONITOR', 'GLUCOSE_METER', 'THERMOMETER') AND active=TRUE
            """, storeId);
        jdbc.update("""
            INSERT INTO store_inventory (sku_id)
            SELECT id FROM store_sku WHERE store_id=?
            """, storeId);
    }

    public List<Product> products(long storeId) {
        return jdbc.query("""
            SELECT s.id, s.store_id, s.template_id, s.name, s.category, s.description,
                   s.price_cents, s.status, i.available, i.reserved
            FROM store_sku s JOIN store_inventory i ON i.sku_id=s.id
            WHERE s.store_id=? ORDER BY s.id DESC
            """, (rs, row) -> mapProduct(rs), storeId);
    }

    public Optional<Product> product(long storeId, long skuId) {
        return jdbc.query("""
            SELECT s.id, s.store_id, s.template_id, s.name, s.category, s.description,
                   s.price_cents, s.status, i.available, i.reserved
            FROM store_sku s JOIN store_inventory i ON i.sku_id=s.id
            WHERE s.store_id=? AND s.id=?
            """, (rs, row) -> mapProduct(rs), storeId, skuId).stream().findFirst();
    }

    private Product mapProduct(java.sql.ResultSet rs) throws java.sql.SQLException {
        long template = rs.getLong("template_id");
        boolean templateMissing = rs.wasNull();
        return new Product(rs.getLong("id"), rs.getLong("store_id"), templateMissing ? null : template,
            rs.getString("name"), rs.getString("category"), rs.getString("description"),
            rs.getLong("price_cents"), rs.getString("status"), rs.getInt("available"), rs.getInt("reserved"));
    }

    public Product create(long storeId, Long templateId, String name, String category, String description, long priceCents) {
        var keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("""
                INSERT INTO store_sku (store_id, template_id, name, category, description, price_cents)
                VALUES (?, ?, ?, ?, ?, ?)
                """, Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, storeId);
            if (templateId == null) statement.setNull(2, java.sql.Types.BIGINT);
            else statement.setLong(2, templateId);
            statement.setString(3, name);
            statement.setString(4, category);
            statement.setString(5, description);
            statement.setLong(6, priceCents);
            return statement;
        }, keys);
        long skuId = keys.getKey().longValue();
        jdbc.update("INSERT INTO store_inventory (sku_id) VALUES (?)", skuId);
        return product(storeId, skuId).orElseThrow();
    }

    public Optional<Product> update(long storeId, long skuId, String name, String description, long priceCents) {
        int changed = jdbc.update("""
            UPDATE store_sku SET name=?, description=?, price_cents=?
            WHERE store_id=? AND id=? AND status<>'ARCHIVED'
            """, name, description, priceCents, storeId, skuId);
        return changed == 0 ? Optional.empty() : product(storeId, skuId);
    }

    public Optional<Product> setStatus(long storeId, long skuId, String status) {
        int changed = jdbc.update("UPDATE store_sku SET status=? WHERE store_id=? AND id=?", status, storeId, skuId);
        return changed == 0 ? Optional.empty() : product(storeId, skuId);
    }

    public Optional<Integer> lockAvailable(long storeId, long skuId) {
        return jdbc.query("""
            SELECT i.available FROM store_inventory i JOIN store_sku s ON s.id=i.sku_id
            WHERE s.store_id=? AND s.id=? AND s.status<>'ARCHIVED' FOR UPDATE
            """, (rs, row) -> rs.getInt("available"), storeId, skuId).stream().findFirst();
    }

    public void setAvailable(long skuId, long actorId, int before, int target, String note) {
        jdbc.update("UPDATE store_inventory SET available=? WHERE sku_id=?", target, skuId);
        if (before != target) jdbc.update("""
            INSERT INTO inventory_ledger (sku_id, actor_id, delta, before_available, after_available, reason, note)
            VALUES (?, ?, ?, ?, ?, 'MERCHANT_ADJUSTMENT', ?)
            """, skuId, actorId, target - before, before, target, note);
    }

    public List<Ledger> ledger(long storeId, long skuId) {
        return jdbc.query("""
            SELECT l.id, l.sku_id, l.actor_id, l.delta, l.before_available, l.after_available,
                   l.reason, l.note, l.created_at
            FROM inventory_ledger l JOIN store_sku s ON s.id=l.sku_id
            WHERE s.store_id=? AND s.id=? ORDER BY l.id DESC LIMIT 100
            """, (rs, row) -> new Ledger(rs.getLong("id"), rs.getLong("sku_id"), rs.getLong("actor_id"),
                rs.getInt("delta"), rs.getInt("before_available"), rs.getInt("after_available"),
                rs.getString("reason"), rs.getString("note"), rs.getTimestamp("created_at").toLocalDateTime()),
            storeId, skuId);
    }

    public boolean hasSaleableProducts(long storeId) {
        Integer count = jdbc.queryForObject("""
            SELECT COUNT(*) FROM store_sku s JOIN store_inventory i ON i.sku_id=s.id
            WHERE s.store_id=? AND s.status='ON_SHELF' AND i.available>0
            """, Integer.class, storeId);
        return count != null && count > 0;
    }
}
