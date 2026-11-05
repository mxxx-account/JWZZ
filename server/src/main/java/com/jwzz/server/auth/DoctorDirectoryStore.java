package com.jwzz.server.auth;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class DoctorDirectoryStore {
    public record Doctor(long id, String email, String displayName, String specialty,
                         LocalDateTime lastSeenAt, boolean online) {}

    private final JdbcTemplate jdbc;
    public DoctorDirectoryStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void upsert(long doctorId, String displayName, String specialty) {
        jdbc.update("INSERT INTO doctor_profile (doctor_id, display_name, specialty) VALUES (?, ?, ?) "
            + "ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), specialty=VALUES(specialty)",
            doctorId, displayName, specialty);
    }

    public void heartbeat(long doctorId) {
        jdbc.update("UPDATE doctor_profile SET last_seen_at=NOW(6) WHERE doctor_id=?", doctorId);
    }

    public List<Doctor> list() {
        return jdbc.query("SELECT u.id, u.email, p.display_name, p.specialty, p.last_seen_at "
            + "FROM doctor_profile p JOIN app_user u ON u.id=p.doctor_id AND u.role='DOCTOR' "
            + "ORDER BY p.specialty, u.id", (rs, row) -> map(rs));
    }

    public Optional<Doctor> find(long doctorId) {
        return jdbc.query("SELECT u.id, u.email, p.display_name, p.specialty, p.last_seen_at "
            + "FROM doctor_profile p JOIN app_user u ON u.id=p.doctor_id AND u.role='DOCTOR' WHERE u.id=?",
            (rs, row) -> map(rs), doctorId).stream().findFirst();
    }

    private Doctor map(java.sql.ResultSet rs) throws java.sql.SQLException {
        var seen = rs.getTimestamp("last_seen_at");
        LocalDateTime lastSeen = seen == null ? null : seen.toLocalDateTime();
        boolean online = lastSeen != null && lastSeen.isAfter(LocalDateTime.now().minusSeconds(90));
        return new Doctor(rs.getLong("id"), rs.getString("email"), rs.getString("display_name"),
            rs.getString("specialty"), lastSeen, online);
    }
}
