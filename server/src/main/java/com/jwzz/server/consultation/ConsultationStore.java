package com.jwzz.server.consultation;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class ConsultationStore {
    public record Consultation(long id, long reportId, long userId, Long targetDoctorId,
                               String question, String status, Long claimedDoctorId, String answer, LocalDateTime createdAt,
                               LocalDateTime claimedAt, LocalDateTime answeredAt) {}

    private static final RowMapper<Consultation> ROW = (rs, row) -> new Consultation(
        rs.getLong("id"), rs.getLong("report_id"), rs.getLong("user_id"),
        rs.getObject("target_doctor_id", Long.class), rs.getString("question"),
        rs.getString("status"), rs.getObject("claimed_doctor_id", Long.class), rs.getString("answer"),
        rs.getTimestamp("created_at").toLocalDateTime(),
        rs.getTimestamp("claimed_at") == null ? null : rs.getTimestamp("claimed_at").toLocalDateTime(),
        rs.getTimestamp("answered_at") == null ? null : rs.getTimestamp("answered_at").toLocalDateTime());

    private final JdbcTemplate jdbc;
    public ConsultationStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Consultation create(long reportId, long userId, long doctorId, String question) {
        var key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement(
                "INSERT INTO consultation_request (report_id, user_id, target_doctor_id, question) VALUES (?, ?, ?, ?)",
                java.sql.Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, reportId);
            statement.setLong(2, userId);
            statement.setLong(3, doctorId);
            statement.setString(4, question);
            return statement;
        }, key);
        return find(key.getKey().longValue()).orElseThrow();
    }

    public Optional<Consultation> find(long id) {
        return jdbc.query("SELECT * FROM consultation_request WHERE id=?", ROW, id).stream().findFirst();
    }

    public Optional<Consultation> findForDoctor(long id, long doctorId) {
        return jdbc.query("SELECT c.* FROM consultation_request c JOIN report_access_grant g "
            + "ON g.report_id=c.report_id AND g.doctor_id=? AND g.revoked_at IS NULL "
            + "WHERE c.id=? AND (c.target_doctor_id=? OR (c.target_doctor_id IS NULL "
            + "AND (c.claimed_doctor_id IS NULL OR c.claimed_doctor_id=?)))",
            ROW, doctorId, id, doctorId, doctorId).stream().findFirst();
    }

    public List<Consultation> forUser(long userId) {
        return jdbc.query("SELECT * FROM consultation_request WHERE user_id=? ORDER BY id DESC LIMIT 100", ROW, userId);
    }

    public List<Consultation> forDoctor(long doctorId) {
        return jdbc.query("SELECT DISTINCT c.* FROM consultation_request c "
            + "JOIN report_access_grant g ON g.report_id=c.report_id AND g.doctor_id=? AND g.revoked_at IS NULL "
            + "WHERE c.target_doctor_id=? OR (c.target_doctor_id IS NULL "
            + "AND (c.claimed_doctor_id IS NULL OR c.claimed_doctor_id=?)) "
            + "ORDER BY c.id DESC LIMIT 100", ROW, doctorId, doctorId, doctorId);
    }

    // The status predicate makes two simultaneous claims a single-winner operation in MySQL.
    public boolean claim(long id, long doctorId) {
        return jdbc.update("UPDATE consultation_request c JOIN report_access_grant g "
            + "ON g.report_id=c.report_id AND g.doctor_id=? AND g.revoked_at IS NULL "
            + "SET c.status='CLAIMED', c.target_doctor_id=?, c.claimed_doctor_id=?, c.claimed_at=CURRENT_TIMESTAMP "
            + "WHERE c.id=? AND c.status='OPEN' AND (c.target_doctor_id IS NULL OR c.target_doctor_id=?)",
            doctorId, doctorId, doctorId, id, doctorId) == 1;
    }

    public boolean answer(long id, long doctorId, String answer) {
        return jdbc.update("UPDATE consultation_request c JOIN report_access_grant g "
            + "ON g.report_id=c.report_id AND g.doctor_id=? AND g.revoked_at IS NULL "
            + "SET c.status='ANSWERED', c.answer=?, c.answered_at=CURRENT_TIMESTAMP "
            + "WHERE c.id=? AND c.status='CLAIMED' AND c.claimed_doctor_id=?",
            doctorId, answer, id, doctorId) == 1;
    }

    public void updateLatestDoctorAnswer(long id, long doctorId, String answer) {
        jdbc.update("UPDATE consultation_request SET status='ANSWERED', answer=?, answered_at=CURRENT_TIMESTAMP "
            + "WHERE id=? AND claimed_doctor_id=?", answer, id, doctorId);
    }
}
