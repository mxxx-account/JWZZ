package com.jwzz.server.indicator;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
public class DraftRuleEngine {
    public static final String RULE_VERSION = "draft-2026-01";
    public record Interpretation(String ruleCode, String ruleVersion, String reviewStatus,
                                 String label, String explanation, String applicability,
                                 String sourceTitle, String sourceUrl) {}
    private static final String BP_SOURCE = "AHA/ACC 2025 High Blood Pressure Guideline";
    private static final String BP_URL = "https://professional.heart.org/en/science-news/2025-high-blood-pressure-guideline/top-things-to-know";
    private static final String GLUCOSE_SOURCE = "ADA Standards of Care in Diabetes—2026, Diagnosis and Classification";
    private static final String GLUCOSE_URL = "https://diabetesjournals.org/care/article/49/Supplement_1/S27/163926";
    private static final String TG_SOURCE = "American Heart Association, What Your Cholesterol Levels Mean";
    private static final String TG_URL = "https://www.heart.org/en/health-topics/cholesterol/about-cholesterol/what-your-cholesterol-levels-mean";

    public List<Interpretation> evaluate(IndicatorService.PreparedEntry entry) {
        var request = entry.request();
        if (request.ageYears() < 18 || request.pregnant()) return List.of();
        Map<String, IndicatorService.NormalizedValue> values = entry.values().stream()
            .collect(Collectors.toMap(IndicatorService.NormalizedValue::code, value -> value));
        List<Interpretation> result = new ArrayList<>();
        if (request.category().equals("BP")) {
            BigDecimal systolic = values.get("systolic_bp").value();
            BigDecimal diastolic = values.get("diastolic_bp").value();
            if (systolic.compareTo(new BigDecimal("90")) < 0 || diastolic.compareTo(new BigDecimal("60")) < 0)
                return List.of(); // AHA high-BP categories must not label unusually low readings "normal".
            String label = systolic.compareTo(new BigDecimal("180")) > 0 || diastolic.compareTo(new BigDecimal("120")) > 0
                ? "读数极高，需复测并尽快联系医疗人员"
                : systolic.compareTo(new BigDecimal("140")) >= 0 || diastolic.compareTo(new BigDecimal("90")) >= 0
                ? "高血压 2 级参考区间"
                : systolic.compareTo(new BigDecimal("130")) >= 0 || diastolic.compareTo(new BigDecimal("80")) >= 0
                ? "高血压 1 级参考区间"
                : systolic.compareTo(new BigDecimal("120")) >= 0 ? "血压升高参考区间" : "正常参考区间";
            result.add(draft("BP_CATEGORY", label, "仅按这一次读数对照 AHA 成人分类，不能据此确诊。若读数极高或出现不适，请及时寻求医疗帮助。",
                "非妊娠成年人；单次家庭或诊室血压，仅供参考", BP_SOURCE, BP_URL));
        }
        if (request.category().equals("GLUCOSE") && request.context().equals("FASTING_PLASMA")) {
            IndicatorService.NormalizedValue glucose = values.get("blood_glucose");
            BigDecimal mgdl = glucose.rawUnit().equals("mg/dL") ? glucose.rawValue()
                : glucose.value().multiply(new BigDecimal("18.0182"));
            if (mgdl.compareTo(new BigDecimal("70")) < 0) return List.of(); // The FPG high-range table does not interpret low glucose.
            String label = mgdl.compareTo(new BigDecimal("126")) >= 0 ? "达到 ADA 空腹血浆血糖高值参考界限"
                : mgdl.compareTo(new BigDecimal("100")) >= 0 ? "处于 ADA 空腹血浆血糖中间参考区间" : "低于 ADA 空腹血浆血糖中间区间起点";
            result.add(draft("FPG_CATEGORY", label, "只适用于实验室空腹血浆血糖；单次自填数值不能确诊或排除糖尿病，需由医疗人员结合复检和其他信息判断。",
                "非妊娠成年人；空腹实验室血浆，非指尖血糖", GLUCOSE_SOURCE, GLUCOSE_URL));
        }
        if (request.category().equals("LIPID") && values.containsKey("triglycerides")) {
            IndicatorService.NormalizedValue tg = values.get("triglycerides");
            BigDecimal mgdl = tg.rawUnit().equals("mg/dL") ? tg.rawValue()
                : tg.value().multiply(new BigDecimal("88.57"));
            String label = mgdl.compareTo(new BigDecimal("150")) >= 0 ? "甘油三酯不低于常用参考界限" : "甘油三酯低于常用参考界限";
            result.add(draft("TG_REFERENCE", label, "AHA 将低于 150 mg/dL 视作通常正常；甘油三酯须结合其他血脂和个人风险由医生解读。",
                "非妊娠成年人；实验室血脂检查", TG_SOURCE, TG_URL));
        }
        return List.copyOf(result);
    }

    private Interpretation draft(String code, String label, String explanation, String applicability, String source, String url) {
        return new Interpretation(code, RULE_VERSION, "AWAITING_CLINICAL_REVIEW", label, explanation, applicability, source, url);
    }
}
