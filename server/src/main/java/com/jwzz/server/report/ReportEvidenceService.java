package com.jwzz.server.report;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import com.jwzz.server.auth.UserStore;
import com.jwzz.server.indicator.IndicatorService;
import com.jwzz.server.indicator.IndicatorStore;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ReportEvidenceService {
    private static final String UNIT = "mmHg";
    private static final String SYSTOLIC = "systolic_bp";
    private static final String DIASTOLIC = "diastolic_bp";
    private static final List<IndicatorDefinition> BLOOD_PRESSURE_DICTIONARY = List.of(
        new IndicatorDefinition(SYSTOLIC, "收缩压", UNIT, "记录心脏收缩时的动脉压力。"),
        new IndicatorDefinition(DIASTOLIC, "舒张压", UNIT, "记录心脏舒张时的动脉压力。")
    );
    private static final String NOTICE = "仅整理记录与数值变化，不提供诊断、治疗或用药建议。";

    public enum Status { AVAILABLE, NO_COMPARABLE_HISTORY, UNSUPPORTED_CATEGORY, UNSUPPORTED_SNAPSHOT }
    public record IndicatorDefinition(String code, String label, String unit, String description) {}
    public record Reading(LocalDateTime measuredAt, String context, BigDecimal systolic, BigDecimal diastolic) {}
    public record Change(BigDecimal systolic, BigDecimal diastolic) {}
    public record Evidence(long reportId, Status status, List<IndicatorDefinition> indicators,
                           Reading current, Reading previous, Change change, String notice) {}
    private record Anchor(String entryId, Reading reading) {}

    private final ReportStore reports;
    private final IndicatorStore indicators;
    private final ObjectReader snapshotReader;

    public ReportEvidenceService(ReportStore reports, IndicatorStore indicators, ObjectMapper mapper) {
        this.reports = reports;
        this.indicators = indicators;
        this.snapshotReader = mapper.reader().with(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
    }

    public Evidence forOwner(UserStore.User actor, long reportId) {
        if (!"USER".equals(actor.role())) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        var report = reports.findOwnedById(actor.id(), reportId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        JsonNode snapshot;
        try {
            snapshot = snapshotReader.readTree(report.content());
        } catch (JsonProcessingException exception) {
            return unavailable(reportId, Status.UNSUPPORTED_SNAPSHOT);
        }
        if (!ReportGenerationService.SNAPSHOT_SCHEMA_VERSION.equals(snapshot.path("schemaVersion").asText()))
            return unavailable(reportId, Status.UNSUPPORTED_SNAPSHOT);
        String category = snapshot.path("category").asText();
        if ("GLUCOSE".equals(category) || "LIPID".equals(category))
            return unavailable(reportId, Status.UNSUPPORTED_CATEGORY);
        if (!"BP".equals(category)) return unavailable(reportId, Status.UNSUPPORTED_SNAPSHOT);
        Anchor anchor = bloodPressureAnchor(snapshot);
        if (anchor == null) return unavailable(reportId, Status.UNSUPPORTED_SNAPSHOT);

        Reading current = anchor.reading();
        var match = indicators.previousBloodPressure(actor.id(), anchor.entryId(), current.context(), current.measuredAt());
        if (match.isEmpty()) {
            return new Evidence(reportId, Status.NO_COMPARABLE_HISTORY, BLOOD_PRESSURE_DICTIONARY,
                current, null, null, NOTICE);
        }
        var pair = match.get();
        Reading previous = new Reading(pair.measuredAt(), current.context(), pair.systolic(), pair.diastolic());
        Change change = new Change(current.systolic().subtract(previous.systolic()),
            current.diastolic().subtract(previous.diastolic()));
        return new Evidence(reportId, Status.AVAILABLE, BLOOD_PRESSURE_DICTIONARY, current, previous, change, NOTICE);
    }

    private Evidence unavailable(long reportId, Status status) {
        return new Evidence(reportId, status, List.of(), null, null, null, NOTICE);
    }

    private Anchor bloodPressureAnchor(JsonNode snapshot) {
        String entryId = snapshot.path("sourceEntryId").asText();
        String context = snapshot.path("context").asText();
        JsonNode values = snapshot.path("values");
        if (!"HOME".equals(context) && !"CLINIC".equals(context)) return null;
        if (!values.isArray() || values.size() != 2) return null;

        LocalDateTime measuredAt;
        try {
            if (!UUID.fromString(entryId).toString().equals(entryId)) return null;
            measuredAt = LocalDateTime.parse(snapshot.path("measuredAt").asText());
        } catch (IllegalArgumentException | DateTimeParseException exception) {
            return null;
        }

        BigDecimal systolic = null, diastolic = null;
        for (JsonNode value : values) {
            if (!UNIT.equals(value.path("unit").asText())
                || !IndicatorService.CONVERSION_VERSION.equals(value.path("conversionVersion").asText())
                || !value.path("value").isNumber()) return null;
            BigDecimal amount = value.path("value").decimalValue();
            switch (value.path("code").asText()) {
                case SYSTOLIC -> systolic = amount;
                case DIASTOLIC -> diastolic = amount;
                default -> { return null; }
            }
        }
        if (systolic == null || diastolic == null || diastolic.signum() <= 0 || systolic.compareTo(diastolic) <= 0)
            return null;
        return new Anchor(entryId, new Reading(measuredAt, context, systolic, diastolic));
    }
}
