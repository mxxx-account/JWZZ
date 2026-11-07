package com.jwzz.server.shop;

import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class ShopConversationStore {
    public record Conversation(long id, long orderId, long userId, long storeId, long merchantId) {}
    public record Summary(long id, long orderId, long peerId, String peerName, String orderStatus,
                          String lastMessage, LocalDateTime updatedAt, int unreadCount) {}
    public record Message(long id, long conversationId, long senderId, String body, LocalDateTime createdAt) {}
    public record Detail(Summary conversation, List<Message> messages) {}

    private final JdbcTemplate jdbc;
    public ShopConversationStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Optional<Conversation> byOrder(long orderId) {
        return jdbc.query("""
            SELECT c.id, c.order_id, c.user_id, c.store_id, m.merchant_id
            FROM shop_conversation c JOIN merchant_store m ON m.id=c.store_id WHERE c.order_id=?
            """, (rs, row) -> conversation(rs), orderId).stream().findFirst();
    }

    public Optional<Conversation> lock(long id) {
        return jdbc.query("""
            SELECT c.id, c.order_id, c.user_id, c.store_id, m.merchant_id
            FROM shop_conversation c JOIN merchant_store m ON m.id=c.store_id WHERE c.id=? FOR UPDATE
            """, (rs, row) -> conversation(rs), id).stream().findFirst();
    }

    private Conversation conversation(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Conversation(rs.getLong("id"), rs.getLong("order_id"), rs.getLong("user_id"),
            rs.getLong("store_id"), rs.getLong("merchant_id"));
    }

    public long create(long orderId, long userId, long storeId) {
        var keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("""
                INSERT INTO shop_conversation (order_id, user_id, store_id) VALUES (?, ?, ?)
                """, Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, orderId);
            statement.setLong(2, userId);
            statement.setLong(3, storeId);
            return statement;
        }, keys);
        return keys.getKey().longValue();
    }

    public Message addMessage(long conversationId, long senderId, String body) {
        var keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("""
                INSERT INTO shop_message (conversation_id, sender_id, body) VALUES (?, ?, ?)
                """, Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, conversationId);
            statement.setLong(2, senderId);
            statement.setString(3, body);
            return statement;
        }, keys);
        jdbc.update("UPDATE shop_conversation SET updated_at=CURRENT_TIMESTAMP(6) WHERE id=?", conversationId);
        return jdbc.query("SELECT id,conversation_id,sender_id,body,created_at FROM shop_message WHERE id=?",
            (rs, row) -> message(rs), keys.getKey().longValue()).get(0);
    }

    public List<Message> messages(long conversationId) {
        return jdbc.query("""
            SELECT id,conversation_id,sender_id,body,created_at FROM (
              SELECT id,conversation_id,sender_id,body,created_at FROM shop_message
              WHERE conversation_id=? ORDER BY id DESC LIMIT 200
            ) recent ORDER BY id
            """, (rs, row) -> message(rs), conversationId);
    }

    private Message message(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Message(rs.getLong("id"), rs.getLong("conversation_id"), rs.getLong("sender_id"),
            rs.getString("body"), rs.getTimestamp("created_at").toLocalDateTime());
    }

    public List<Summary> summaries(long actorId, boolean merchant) {
        return jdbc.query(summarySql(merchant) + " ORDER BY c.updated_at DESC,c.id DESC LIMIT 100",
            (rs, row) -> summary(rs), actorId, actorId);
    }

    public Optional<Summary> summary(long actorId, boolean merchant, long conversationId) {
        return jdbc.query(summarySql(merchant) + " AND c.id=?",
            (rs, row) -> summary(rs), actorId, actorId, conversationId).stream().findFirst();
    }

    private String summarySql(boolean merchant) {
        String peerId = merchant ? "c.user_id" : "m.merchant_id";
        String peerName = merchant ? "COALESCE(NULLIF(u.display_name,''),u.email)" : "m.name";
        String readColumn = merchant ? "c.merchant_last_read_message_id" : "c.user_last_read_message_id";
        String owner = merchant ? "m.merchant_id" : "c.user_id";
        return """
            SELECT c.id,c.order_id,%s AS peer_id,%s AS peer_name,o.status AS order_status,
              COALESCE((SELECT sm.body FROM shop_message sm WHERE sm.conversation_id=c.id ORDER BY sm.id DESC LIMIT 1),'') AS last_message,
              c.updated_at,
              (SELECT COUNT(*) FROM shop_message sm WHERE sm.conversation_id=c.id AND sm.sender_id<>? AND sm.id>%s) AS unread_count
            FROM shop_conversation c JOIN merchant_store m ON m.id=c.store_id
            JOIN app_user u ON u.id=c.user_id JOIN shop_order o ON o.id=c.order_id
            WHERE %s=?
            """.formatted(peerId, peerName, readColumn, owner);
    }

    private Summary summary(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Summary(rs.getLong("id"), rs.getLong("order_id"), rs.getLong("peer_id"),
            rs.getString("peer_name"), rs.getString("order_status"), rs.getString("last_message"),
            rs.getTimestamp("updated_at").toLocalDateTime(), rs.getInt("unread_count"));
    }

    public void markRead(long id, boolean merchant) {
        Long latest = jdbc.queryForObject("SELECT COALESCE(MAX(id),0) FROM shop_message WHERE conversation_id=?",
            Long.class, id);
        String column = merchant ? "merchant_last_read_message_id" : "user_last_read_message_id";
        jdbc.update("UPDATE shop_conversation SET " + column + "=GREATEST(" + column + ",?) WHERE id=?",
            latest == null ? 0L : latest, id);
    }
}
