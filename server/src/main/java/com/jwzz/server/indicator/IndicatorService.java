package com.jwzz.server.indicator;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class IndicatorService {
    public static final String CONVERSION_VERSION = "units-2026-01";
    public record ValueInput(BigDecimal value, String unit) {}
    public record EntryRequest(String category, LocalDateTime measuredAt, String context,
                               Integer ageYears, Boolean pregnant, Map<String, ValueInput> values) {}
    public record NormalizedValue(String code, BigDecimal rawValue, String rawUnit,
                                  BigDecimal value, String unit, String conversionVersion) {}
    public record PreparedEntry(String entryId, EntryRequest request, List<NormalizedValue> values) {}

    private static final Map<String, String> CATEGORY = Map.of(
        "systolic_bp", "BP", "diastolic_bp", "BP",
        "blood_glucose", "GLUCOSE", "hba1c", "GLUCOSE",
        "total_cholesterol", "LIPID", "ldl_cholesterol", "LIPID",
        "hdl_cholesterol", "LIPID", "triglycerides", "LIPID");
    private static final Set<String> BP_CONTEXT = Set.of("HOME", "CLINIC");
    private static final Set<String> GLUCOSE_CONTEXT = Set.of("FASTING_PLASMA", "RANDOM", "POST_MEAL", "CAPILLARY");
    private static final Set<String> LIPID_CONTEXT = Set.of("FASTING", "NON_FASTING");

    public PreparedEntry prepare(EntryRequest request) {
        if (request == null || request.category() == null || request.measuredAt() == null || request.context() == null
            || request.ageYears() == null || request.pregnant() == null || request.values() == null)
            throw bad("分类、时间、测量条件、年龄、妊娠状态和指标均为必填项");
        if (request.measuredAt().isAfter(LocalDateTime.now().plusHours(1))) throw bad("测量时间不能晚于当前时间");
        if (request.ageYears() < 0 || request.ageYears() > 120) throw bad("年龄必须在 0 至 120 岁之间");
        Set<String> contexts = switch (request.category()) {
            case "BP" -> BP_CONTEXT;
            case "GLUCOSE" -> GLUCOSE_CONTEXT;
            case "LIPID" -> LIPID_CONTEXT;
            default -> throw bad("未知指标分类");
        };
        if (!contexts.contains(request.context())) throw bad("测量条件不适用于当前分类");
        if (request.values().isEmpty() || request.values().size() > 4) throw bad("指标数量不正确");
        if (request.category().equals("BP") && !request.values().keySet().equals(Set.of("systolic_bp", "diastolic_bp")))
            throw bad("血压需要同时录入收缩压和舒张压");
        if (request.category().equals("GLUCOSE") && !request.values().containsKey("blood_glucose"))
            throw bad("血糖分类需要录入血糖值");
        List<NormalizedValue> values = new ArrayList<>();
        Map<String, BigDecimal> normalized = new LinkedHashMap<>();
        for (var entry : request.values().entrySet()) {
            String code = entry.getKey();
            ValueInput input = entry.getValue();
            if (!request.category().equals(CATEGORY.get(code)) || input == null || input.value() == null || input.unit() == null)
                throw bad("指标编码、数值或单位不正确");
            BigDecimal raw = input.value();
            if (raw.scale() > 4 || raw.precision() > 12 || raw.signum() <= 0) throw bad("指标数值必须为正数且最多四位小数");
            String standardUnit = code.endsWith("_bp") ? "mmHg" : code.equals("hba1c") ? "%" : "mmol/L";
            BigDecimal standard = convert(code, raw, input.unit());
            BigDecimal min = code.equals("systolic_bp") ? new BigDecimal("40")
                : code.equals("diastolic_bp") ? new BigDecimal("20")
                : code.equals("hba1c") ? new BigDecimal("2")
                : code.equals("blood_glucose") ? new BigDecimal("0.5") : new BigDecimal("0.1");
            BigDecimal max = code.endsWith("_bp") ? new BigDecimal("350") : code.equals("hba1c") ? new BigDecimal("25")
                : new BigDecimal("100");
            if (standard.compareTo(min) < 0 || standard.compareTo(max) > 0)
                throw bad("数值超出录入范围，请核对单位与原始报告");
            normalized.put(code, standard);
            values.add(new NormalizedValue(code, raw, input.unit(), standard.setScale(4, RoundingMode.HALF_UP), standardUnit, CONVERSION_VERSION));
        }
        if (request.category().equals("BP") && normalized.get("systolic_bp").compareTo(normalized.get("diastolic_bp")) <= 0)
            throw bad("收缩压必须高于舒张压");
        return new PreparedEntry(UUID.randomUUID().toString(), request, List.copyOf(values));
    }

    public void validateTrendFilter(String code, String context) {
        String category = CATEGORY.get(code);
        if (category == null || context == null) throw bad("未知指标或测量条件");
        Set<String> allowed = switch (category) {
            case "BP" -> BP_CONTEXT;
            case "GLUCOSE" -> GLUCOSE_CONTEXT;
            case "LIPID" -> LIPID_CONTEXT;
            default -> throw bad("未知指标分类");
        };
        if (!allowed.contains(context)) throw bad("测量条件不适用于当前指标");
    }

    private BigDecimal convert(String code, BigDecimal raw, String unit) {
        if (code.endsWith("_bp")) {
            if (!unit.equals("mmHg")) throw bad("血压单位只能为 mmHg");
            return raw;
        }
        if (code.equals("hba1c")) {
            if (!unit.equals("%")) throw bad("糖化血红蛋白单位只能为 %");
            return raw;
        }
        if (unit.equals("mmol/L")) return raw;
        if (!unit.equals("mg/dL")) throw bad("该指标只支持 mmol/L 或 mg/dL");
        BigDecimal divisor = code.equals("blood_glucose") ? new BigDecimal("18.0182")
            : code.equals("triglycerides") ? new BigDecimal("88.57") : new BigDecimal("38.67");
        return raw.divide(divisor, 8, RoundingMode.HALF_UP);
    }

    private ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
}
