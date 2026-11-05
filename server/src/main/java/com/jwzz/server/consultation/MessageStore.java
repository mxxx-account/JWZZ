package com.jwzz.server.consultation;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class MessageStore {
    public record Message(long id, long consultationId, long senderId, String body, LocalDateTime createdAt) {}

    private final JdbcTemplate jdbc;
    public MessageStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Message add(long consultationId, long senderId, String body) {
        var key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement(
                "INSERT INTO consultation_message (consultation_id, sender_id, body) VALUES (?, ?, ?)",
                java.sql.Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, consultationId);
            statement.setLong(2, senderId);
            statement.setString(3, body);
            return statement;
        }, key);
        return jdbc.query("SELECT id, consultation_id, sender_id, body, created_at FROM consultation_message WHERE id=?",
            (rs, row) -> map(rs), key.getKey().longValue()).get(0);
    }

    public List<Message> forConversation(long consultationId) {
        return jdbc.query("SELECT id, consultation_id, sender_id, body, created_at FROM consultation_message "
            + "WHERE consultation_id=? ORDER BY id ASC LIMIT 500", (rs, row) -> map(rs), consultationId);
    }

    public Optional<Message> latest(long consultationId) {
        return jdbc.query("SELECT id, consultation_id, sender_id, body, created_at FROM consultation_message "
            + "WHERE consultation_id=? ORDER BY id DESC LIMIT 1", (rs, row) -> map(rs), consultationId)
            .stream().findFirst();
    }

    public int unread(long consultationId, long readerId, boolean doctor) {
        String column = doctor ? "doctor_last_read_message_id" : "user_last_read_message_id";
        Integer result = jdbc.queryForObject("SELECT COUNT(*) FROM consultation_message m "
            + "JOIN consultation_request c ON c.id=m.consultation_id "
            + "WHERE c.id=? AND m.sender_id<>? AND m.id>c." + column,
            Integer.class, consultationId, readerId);
        return result == null ? 0 : result;
    }

    public void markRead(long consultationId, boolean doctor) {
        Long newest = jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) FROM consultation_message WHERE consultation_id=?",
            Long.class, consultationId);
        String column = doctor ? "doctor_last_read_message_id" : "user_last_read_message_id";
        jdbc.update("UPDATE consultation_request SET " + column + "=GREATEST(" + column + ", ?) WHERE id=?",
            newest == null ? 0L : newest, consultationId);
    }

    private Message map(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Message(rs.getLong("id"), rs.getLong("consultation_id"), rs.getLong("sender_id"),
            rs.getString("body"), rs.getTimestamp("created_at").toLocalDateTime());
    }
}
