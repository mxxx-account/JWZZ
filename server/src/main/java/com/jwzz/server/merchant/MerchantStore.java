package com.jwzz.server.merchant;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class MerchantStore {
    public record Store(long id, long merchantId, String name, String description, String city,
                        String address, String status, LocalDateTime createdAt, LocalDateTime updatedAt) {}

    private final JdbcTemplate jdbc;

    public MerchantStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Optional<Store> ownedBy(long merchantId) {
        List<Store> stores = jdbc.query("""
            SELECT id, merchant_id, name, description, city, address, status, created_at, updated_at
            FROM merchant_store WHERE merchant_id = ?
            """, (rs, row) -> new Store(rs.getLong("id"), rs.getLong("merchant_id"), rs.getString("name"),
                rs.getString("description"), rs.getString("city"), rs.getString("address"),
                rs.getString("status"), rs.getTimestamp("created_at").toLocalDateTime(),
                rs.getTimestamp("updated_at").toLocalDateTime()), merchantId);
        return stores.stream().findFirst();
    }

    public Store create(long merchantId, String name, String description, String city, String address) {
        jdbc.update("""
            INSERT INTO merchant_store (merchant_id, name, description, city, address)
            VALUES (?, ?, ?, ?, ?)
            """, merchantId, name, description, city, address);
        return ownedBy(merchantId).orElseThrow();
    }

    public Optional<Store> update(long merchantId, String name, String description, String city, String address) {
        int changed = jdbc.update("""
            UPDATE merchant_store SET name = ?, description = ?, city = ?, address = ?
            WHERE merchant_id = ?
            """, name, description, city, address, merchantId);
        return changed == 0 ? Optional.empty() : ownedBy(merchantId);
    }
}
