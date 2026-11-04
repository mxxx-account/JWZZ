package com.jwzz.server.report;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jwzz.server.indicator.DraftRuleEngine;
import com.jwzz.server.indicator.IndicatorService;
import com.jwzz.server.indicator.IndicatorStore;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ReportGenerationService {
    public record Snapshot(String schemaVersion, String title, String message, String sourceEntryId,
                           String category, String context, LocalDateTime measuredAt, LocalDateTime generatedAt,
                           Integer ageYears, Boolean pregnant, String rulesStatus, String ruleVersion,
                           List<IndicatorService.NormalizedValue> values,
                           List<DraftRuleEngine.Interpretation> interpretations) {}
    private final IndicatorStore indicators;
    private final ReportStore reports;
    private final DraftRuleEngine rules;
    private final Environment environment;
    private final ObjectMapper mapper;
    public ReportGenerationService(IndicatorStore indicators, ReportStore reports, DraftRuleEngine rules,
                                   Environment environment, ObjectMapper mapper) {
        this.indicators = indicators; this.reports = reports; this.rules = rules;
        this.environment = environment; this.mapper = mapper;
    }

    // Under MySQL's default REPEATABLE READ, a retry can hit the unique key but
    // still fail to see the winner in its earlier snapshot. READ COMMITTED fixes that.
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ReportStore.Report generate(long userId, String entryId) {
        try { UUID.fromString(entryId); }
        catch (RuntimeException exception) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid entry ID"); }
        // A retry must return the original snapshot, even if source rules later change.
        var existing = reports.findByUserKey(userId, entryId);
        if (existing.isPresent()) return existing.get();
        var stored = indicators.byEntry(userId, entryId);
        if (stored.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        var first = stored.get(0);
        if (stored.stream().anyMatch(value -> !Objects.equals(value.context(), first.context())
            || !Objects.equals(value.measuredAt(), first.measuredAt()) || !Objects.equals(value.ageYears(), first.ageYears())
            || !Objects.equals(value.pregnant(), first.pregnant()) || value.conversionVersion().equals("legacy-unverified")))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Inconsistent entry");
        String category = first.code().endsWith("_bp") ? "BP"
            : first.code().equals("blood_glucose") || first.code().equals("hba1c") ? "GLUCOSE" : "LIPID";
        Map<String, IndicatorService.ValueInput> input = new LinkedHashMap<>();
        List<IndicatorService.NormalizedValue> values = stored.stream().map(value -> {
            input.put(value.code(), new IndicatorService.ValueInput(value.rawValue(), value.rawUnit()));
            return new IndicatorService.NormalizedValue(value.code(), value.rawValue(), value.rawUnit(),
                value.value(), value.unit(), value.conversionVersion());
        }).toList();
        if (input.size() != stored.size() || stored.stream().anyMatch(value -> !codeMatchesCategory(value.code(), category)))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Inconsistent entry");
        var request = new IndicatorService.EntryRequest(category, first.measuredAt(), first.context(),
            first.ageYears(), first.pregnant(), input);
        var prepared = new IndicatorService.PreparedEntry(entryId, request, values);
        boolean dev = environment.acceptsProfiles(Profiles.of("dev"));
        String version = dev ? DraftRuleEngine.RULE_VERSION : "no-active-rules";
        var snapshot = new Snapshot("indicator-report-v1", "指标记录快照",
            "仅供信息整理与研发演示；单次录入不能用于疾病诊断或治疗决策。",
            entryId, category, first.context(), first.measuredAt(), LocalDateTime.now(),
            first.ageYears(), first.pregnant(), "AWAITING_CLINICAL_REVIEW", version,
            values, dev ? rules.evaluate(prepared) : List.of());
        try {
            return reports.saveGenerated(userId, entryId, version, mapper.writeValueAsString(snapshot));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Could not serialize report snapshot", exception);
        }
    }

    private boolean codeMatchesCategory(String code, String category) {
        return switch (category) {
            case "BP" -> code.equals("systolic_bp") || code.equals("diastolic_bp");
            case "GLUCOSE" -> code.equals("blood_glucose") || code.equals("hba1c");
            case "LIPID" -> code.equals("total_cholesterol") || code.equals("ldl_cholesterol")
                || code.equals("hdl_cholesterol") || code.equals("triglycerides");
            default -> false;
        };
    }
}
