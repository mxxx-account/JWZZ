package com.jwzz.server.indicator;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class IndicatorStore {
    public record StoredValue(long id, String entryId, String code, java.math.BigDecimal rawValue, String rawUnit,
                              java.math.BigDecimal value, String unit, String conversionVersion,
                              String context, LocalDateTime measuredAt, Integer ageYears, Boolean pregnant) {}
    public record BloodPressurePair(LocalDateTime measuredAt, BigDecimal systolic, BigDecimal diastolic) {}
    private final JdbcTemplate jdbc;
    public IndicatorStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    private final RowMapper<StoredValue> rowMapper = (rs, row) -> new StoredValue(
        rs.getLong("id"), rs.getString("entry_id"), rs.getString("indicator_code"),
        rs.getBigDecimal("raw_numeric_value"), rs.getString("raw_unit"), rs.getBigDecimal("numeric_value"),
        rs.getString("unit"), rs.getString("conversion_version"), rs.getString("measurement_context"),
        rs.getTimestamp("measured_at").toLocalDateTime(), (Integer) rs.getObject("age_years"),
        (Boolean) rs.getObject("pregnant"));
    private static final String COLUMNS = "id, entry_id, indicator_code, raw_numeric_value, raw_unit, numeric_value, unit, conversion_version, measurement_context, measured_at, age_years, pregnant";

    public void save(long userId, IndicatorService.PreparedEntry entry) {
        for (var value : entry.values()) {
            jdbc.update("INSERT INTO indicator_record (user_id, entry_id, indicator_code, numeric_value, unit, raw_numeric_value, raw_unit, conversion_version, measurement_context, measured_at, age_years, pregnant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                userId, entry.entryId(), value.code(), value.value(), value.unit(), value.rawValue(), value.rawUnit(),
                value.conversionVersion(), entry.request().context(), entry.request().measuredAt(),
                entry.request().ageYears(), entry.request().pregnant());
        }
    }

    public List<StoredValue> latest(long userId) {
        return jdbc.query("SELECT " + COLUMNS + " FROM indicator_record WHERE user_id=? ORDER BY measured_at DESC, id DESC LIMIT 100",
            rowMapper, userId);
    }

    public List<StoredValue> byEntry(long userId, String entryId) {
        return jdbc.query("SELECT " + COLUMNS + " FROM indicator_record WHERE user_id=? AND entry_id=? ORDER BY id",
            rowMapper, userId, entryId);
    }

    public List<StoredValue> trend(long userId, String code, String context) {
        return jdbc.query("SELECT " + COLUMNS + " FROM (SELECT " + COLUMNS + " FROM indicator_record WHERE user_id=? AND indicator_code=? AND measurement_context=? ORDER BY measured_at DESC, id DESC LIMIT 50) recent ORDER BY measured_at ASC, id ASC",
            rowMapper, userId, code, context);
    }

    public Optional<BloodPressurePair> previousBloodPressure(long userId, String sourceEntryId, String context,
                                                            LocalDateTime measuredBefore) {
        return jdbc.query("""
            SELECT s.measured_at, s.numeric_value AS systolic, d.numeric_value AS diastolic
            FROM indicator_record s
            JOIN indicator_record d ON d.user_id=s.user_id AND d.entry_id=s.entry_id
                AND d.indicator_code='diastolic_bp' AND d.measured_at=s.measured_at
                AND CAST(d.measurement_context AS BINARY)=CAST(s.measurement_context AS BINARY)
            WHERE s.user_id=? AND s.indicator_code='systolic_bp' AND s.measurement_context=?
                AND CAST(s.measurement_context AS BINARY)=CAST(? AS BINARY)
                AND s.measured_at<? AND s.entry_id<>?
                AND CAST(s.unit AS BINARY)='mmHg' AND CAST(d.unit AS BINARY)='mmHg'
                AND CAST(s.conversion_version AS BINARY)=CAST(? AS BINARY)
                AND CAST(d.conversion_version AS BINARY)=CAST(? AS BINARY)
                AND s.numeric_value>d.numeric_value AND d.numeric_value>0
                AND NOT EXISTS (
                    SELECT 1 FROM indicator_record extra
                    WHERE extra.user_id=s.user_id AND extra.entry_id=s.entry_id
                        AND extra.indicator_code IN ('systolic_bp', 'diastolic_bp')
                        AND extra.id NOT IN (s.id, d.id)
                )
            ORDER BY s.measured_at DESC, s.id DESC LIMIT 1
            """, (rs, row) -> new BloodPressurePair(rs.getTimestamp("measured_at").toLocalDateTime(),
                rs.getBigDecimal("systolic"), rs.getBigDecimal("diastolic")),
            userId, context, context, measuredBefore, sourceEntryId, IndicatorService.CONVERSION_VERSION,
            IndicatorService.CONVERSION_VERSION).stream().findFirst();
    }
}
