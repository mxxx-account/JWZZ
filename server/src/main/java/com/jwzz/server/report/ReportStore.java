package com.jwzz.server.report;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ReportStore {
    public record Report(long id, long userId, String ruleVersion, String content, LocalDateTime createdAt) {}

    private final JdbcTemplate jdbc;
    public ReportStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Optional<Report> findById(long id) {
        return jdbc.query("SELECT id, user_id, rule_set_version, report_json, created_at FROM assessment_report WHERE id=?",
            (rs, row) -> new Report(rs.getLong("id"), rs.getLong("user_id"), rs.getString("rule_set_version"), rs.getString("report_json"), rs.getTimestamp("created_at").toLocalDateTime()), id).stream().findFirst();
    }

    public Optional<Report> findByUserKey(long userId, String idempotencyKey) {
        return jdbc.query("SELECT id, user_id, rule_set_version, report_json, created_at FROM assessment_report WHERE user_id=? AND idempotency_key=?",
            (rs, row) -> new Report(rs.getLong("id"), rs.getLong("user_id"), rs.getString("rule_set_version"), rs.getString("report_json"), rs.getTimestamp("created_at").toLocalDateTime()),
            userId, idempotencyKey).stream().findFirst();
    }

    public Report saveGenerated(long userId, String entryId, String ruleVersion, String content) {
        try {
            jdbc.update("INSERT INTO assessment_report (user_id, idempotency_key, rule_set_version, report_json) VALUES (?, ?, ?, ?)",
                userId, entryId, ruleVersion, content);
        } catch (DuplicateKeyException ignored) {
            // The unique (user_id, idempotency_key) index wins concurrent retries.
        }
        return findByUserKey(userId, entryId).orElseThrow();
    }

    public List<Report> ownedBy(long userId) {
        return jdbc.query("SELECT id, user_id, rule_set_version, report_json, created_at FROM assessment_report WHERE user_id=? ORDER BY id DESC",
            (rs, row) -> new Report(rs.getLong("id"), rs.getLong("user_id"), rs.getString("rule_set_version"), rs.getString("report_json"), rs.getTimestamp("created_at").toLocalDateTime()), userId);
    }

    public List<Report> sharedWith(long doctorId) {
        return jdbc.query("SELECT r.id, r.user_id, r.rule_set_version, r.report_json, r.created_at FROM assessment_report r JOIN report_access_grant g ON g.report_id=r.id WHERE g.doctor_id=? AND g.revoked_at IS NULL ORDER BY r.id DESC",
            (rs, row) -> new Report(rs.getLong("id"), rs.getLong("user_id"), rs.getString("rule_set_version"), rs.getString("report_json"), rs.getTimestamp("created_at").toLocalDateTime()), doctorId);
    }

    public boolean activeGrant(long reportId, long doctorId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM report_access_grant WHERE report_id=? AND doctor_id=? AND revoked_at IS NULL", Integer.class, reportId, doctorId);
        return count != null && count > 0;
    }

    public List<Long> activeDoctorIds(long reportId) {
        return jdbc.queryForList("SELECT doctor_id FROM report_access_grant WHERE report_id=? AND revoked_at IS NULL", Long.class, reportId);
    }

    public void grant(long reportId, long doctorId) {
        jdbc.update("INSERT INTO report_access_grant (report_id, doctor_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE revoked_at=NULL, granted_at=CURRENT_TIMESTAMP", reportId, doctorId);
    }

    public void revoke(long reportId, long doctorId) {
        jdbc.update("UPDATE report_access_grant SET revoked_at=CURRENT_TIMESTAMP WHERE report_id=? AND doctor_id=? AND revoked_at IS NULL", reportId, doctorId);
    }

}
