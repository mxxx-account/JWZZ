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
        return add(consultationId, senderId, body, null);
    }

    public void lockConversation(long id) {
        jdbc.queryForList("SELECT id FROM consultation_request WHERE id=? FOR UPDATE", id);
    }

    public Optional<Message> byClientId(long conversationId, long senderId, String clientId) {
        return jdbc.query("SELECT id,consultation_id,sender_id,body,created_at FROM consultation_message WHERE consultation_id=? AND sender_id=? AND client_message_id=? FOR UPDATE",
            (rs,row) -> map(rs), conversationId, senderId, clientId).stream().findFirst();
    }

    public Message add(long consultationId, long senderId, String body, String clientId) {
        var key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement(
                "INSERT INTO consultation_message (consultation_id, sender_id, body, client_message_id) VALUES (?, ?, ?, ?)",
                java.sql.Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, consultationId);
            statement.setLong(2, senderId);
            statement.setString(3, body);
            statement.setString(4, clientId);
            return statement;
        }, key);
        return jdbc.query("SELECT id, consultation_id, sender_id, body, created_at FROM consultation_message WHERE id=?",
            (rs, row) -> map(rs), key.getKey().longValue()).get(0);
    }

    public List<Message> forConversation(long consultationId) {
        return page(consultationId, null, null, 50).items();
    }

    public com.jwzz.server.common.ChatPage<Message> page(long id, Long before, Long after, int size) {
        com.jwzz.server.common.ChatPage.validate(before, after, size);
        String bound = before != null ? " AND id<?" : after != null ? " AND id>?" : "";
        var args = new java.util.ArrayList<Object>();
        args.add(id);
        if (before != null || after != null) args.add(before != null ? before : after);
        args.add(size + 1);
        var rows = jdbc.query("SELECT id,consultation_id,sender_id,body,created_at FROM consultation_message "
            + "WHERE consultation_id=?" + bound + " ORDER BY id " + (after == null ? "DESC" : "ASC") + " LIMIT ?",
            (rs,row) -> map(rs), args.toArray());
        return com.jwzz.server.common.ChatPage.of(rows, size, after == null);
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

    public void markRead(long consultationId, boolean doctor, long seenId) {
        Integer exists = jdbc.queryForObject("SELECT COUNT(*) FROM consultation_message WHERE consultation_id=? AND id=?",
            Integer.class, consultationId, seenId);
        if (exists == null || exists != 1) throw new org.springframework.web.server.ResponseStatusException(
            org.springframework.http.HttpStatus.BAD_REQUEST, "Read cursor must belong to this conversation");
        String column = doctor ? "doctor_last_read_message_id" : "user_last_read_message_id";
        jdbc.update("UPDATE consultation_request SET " + column + "=GREATEST(" + column + ", ?) WHERE id=?",
            seenId, consultationId);
    }

    private Message map(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Message(rs.getLong("id"), rs.getLong("consultation_id"), rs.getLong("sender_id"),
            rs.getString("body"), rs.getTimestamp("created_at").toLocalDateTime());
    }
}
