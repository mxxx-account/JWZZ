package com.jwzz.server.report;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.ArrayList;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ReportStore {
    public record Report(long id, long userId, String ruleVersion, String content, LocalDateTime createdAt) {}
    public record Summary(long id, String title, String category, LocalDateTime createdAt) {}
    public record Page(List<Summary> items, long total, int page, int size) {}

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

    public Page archive(long userId, String category, LocalDateTime from, LocalDateTime before,
                        Long reportId, boolean oldestFirst, int page, int size) {
        StringBuilder where = new StringBuilder(" WHERE user_id=?");
        var parameters = new ArrayList<Object>();
        parameters.add(userId);
        if (category != null) {
            where.append(" AND JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.category'))=?");
            parameters.add(category);
        }
        if (from != null) { where.append(" AND created_at>=?"); parameters.add(from); }
        if (before != null) { where.append(" AND created_at<?"); parameters.add(before); }
        if (reportId != null) { where.append(" AND id=?"); parameters.add(reportId); }
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM assessment_report" + where, Long.class, parameters.toArray());
        var pageParameters = new ArrayList<>(parameters);
        pageParameters.add(size);
        pageParameters.add(page * size);
        String direction = oldestFirst ? "ASC" : "DESC";
        var items = jdbc.query("SELECT id, created_at, JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.title')) AS title, "
                + "JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.category')) AS category FROM assessment_report"
                + where + " ORDER BY created_at " + direction + ", id " + direction + " LIMIT ? OFFSET ?",
            (rs, row) -> new Summary(rs.getLong("id"), rs.getString("title"), rs.getString("category"),
                rs.getTimestamp("created_at").toLocalDateTime()), pageParameters.toArray());
        return new Page(items, count == null ? 0 : count, page, size);
    }

    public List<Report> latestByCategory(long userId) {
        var result = new ArrayList<Report>();
        for (String category : List.of("BP", "GLUCOSE", "LIPID")) {
            result.addAll(jdbc.query("SELECT id, user_id, rule_set_version, report_json, created_at FROM assessment_report "
                + "WHERE user_id=? AND JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.category'))=? ORDER BY id DESC LIMIT 1",
                (rs, row) -> new Report(rs.getLong("id"), rs.getLong("user_id"), rs.getString("rule_set_version"),
                    rs.getString("report_json"), rs.getTimestamp("created_at").toLocalDateTime()), userId, category));
        }
        return result;
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
