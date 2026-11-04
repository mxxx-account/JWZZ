package com.jwzz.server.indicator;

import java.time.LocalDateTime;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class IndicatorStore {
    public record StoredValue(long id, String entryId, String code, java.math.BigDecimal rawValue, String rawUnit,
                              java.math.BigDecimal value, String unit, String conversionVersion,
                              String context, LocalDateTime measuredAt, Integer ageYears, Boolean pregnant) {}
    private final JdbcTemplate jdbc;
    public IndicatorStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void save(long userId, IndicatorService.PreparedEntry entry) {
        for (var value : entry.values()) {
            jdbc.update("INSERT INTO indicator_record (user_id, entry_id, indicator_code, numeric_value, unit, raw_numeric_value, raw_unit, conversion_version, measurement_context, measured_at, age_years, pregnant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                userId, entry.entryId(), value.code(), value.value(), value.unit(), value.rawValue(), value.rawUnit(),
                value.conversionVersion(), entry.request().context(), entry.request().measuredAt(),
                entry.request().ageYears(), entry.request().pregnant());
        }
    }

    public List<StoredValue> latest(long userId) {
        return jdbc.query("SELECT id, entry_id, indicator_code, raw_numeric_value, raw_unit, numeric_value, unit, conversion_version, measurement_context, measured_at, age_years, pregnant FROM indicator_record WHERE user_id=? ORDER BY measured_at DESC, id DESC LIMIT 100",
            (rs, row) -> new StoredValue(rs.getLong("id"), rs.getString("entry_id"), rs.getString("indicator_code"),
                rs.getBigDecimal("raw_numeric_value"), rs.getString("raw_unit"), rs.getBigDecimal("numeric_value"),
                rs.getString("unit"), rs.getString("conversion_version"), rs.getString("measurement_context"),
                rs.getTimestamp("measured_at").toLocalDateTime(), (Integer) rs.getObject("age_years"),
                (Boolean) rs.getObject("pregnant")), userId);
    }
}
