package com.jwzz.server.indicator;

import static org.junit.jupiter.api.Assertions.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class IndicatorServiceTest {
    private final IndicatorService service = new IndicatorService();
    private final DraftRuleEngine rules = new DraftRuleEngine();
    private IndicatorService.EntryRequest request(String category, String context, Map<String, IndicatorService.ValueInput> values) {
        return new IndicatorService.EntryRequest(category, LocalDateTime.now().minusHours(1), context, 22, false, values);
    }
    private IndicatorService.ValueInput value(String number, String unit) {
        return new IndicatorService.ValueInput(new BigDecimal(number), unit);
    }

    @Test void glucoseUnitConversionAndBoundary() {
        var lower = service.prepare(request("GLUCOSE", "FASTING_PLASMA", Map.of("blood_glucose", value("99", "mg/dL"))));
        var boundary = service.prepare(request("GLUCOSE", "FASTING_PLASMA", Map.of("blood_glucose", value("100", "mg/dL"))));
        var high = service.prepare(request("GLUCOSE", "FASTING_PLASMA", Map.of("blood_glucose", value("126", "mg/dL"))));
        assertEquals(new BigDecimal("5.5499"), boundary.values().get(0).value());
        assertTrue(rules.evaluate(lower).get(0).label().contains("低于"));
        assertTrue(rules.evaluate(boundary).get(0).label().contains("中间"));
        assertTrue(rules.evaluate(high).get(0).label().contains("高值"));
    }

    @Test void contextAndPopulationGateRules() {
        var capillary = service.prepare(request("GLUCOSE", "CAPILLARY", Map.of("blood_glucose", value("7.0", "mmol/L"))));
        assertTrue(rules.evaluate(capillary).isEmpty());
        var child = new IndicatorService.EntryRequest("BP", LocalDateTime.now(), "HOME", 14, false,
            Map.of("systolic_bp", value("130", "mmHg"), "diastolic_bp", value("80", "mmHg")));
        assertTrue(rules.evaluate(service.prepare(child)).isEmpty());
        var lowBp = service.prepare(request("BP", "HOME", Map.of("systolic_bp", value("88", "mmHg"), "diastolic_bp", value("58", "mmHg"))));
        assertTrue(rules.evaluate(lowBp).isEmpty());
        var lowGlucose = service.prepare(request("GLUCOSE", "FASTING_PLASMA", Map.of("blood_glucose", value("60", "mg/dL"))));
        assertTrue(rules.evaluate(lowGlucose).isEmpty());
    }

    @Test void bloodPressureUsesHigherCategory() {
        var entry = service.prepare(request("BP", "HOME", Map.of("systolic_bp", value("118", "mmHg"), "diastolic_bp", value("90", "mmHg"))));
        assertTrue(rules.evaluate(entry).get(0).label().contains("2 级"));
    }

    @Test void invalidInputsAreRejected() {
        assertThrows(ResponseStatusException.class, () -> service.prepare(request("BP", "HOME", Map.of("systolic_bp", value("120", "mmHg")))));
        assertThrows(ResponseStatusException.class, () -> service.prepare(request("BP", "HOME", Map.of("systolic_bp", value("70", "mmHg"), "diastolic_bp", value("80", "mmHg")))));
        assertThrows(ResponseStatusException.class, () -> service.prepare(request("LIPID", "FASTING", Map.of("triglycerides", value("150", "watts")))));
        assertThrows(ResponseStatusException.class, () -> service.prepare(request("GLUCOSE", "FASTING_PLASMA", Map.of("blood_glucose", value("-1", "mg/dL")))));
        assertThrows(ResponseStatusException.class, () -> service.prepare(request("BP", "HOME", Map.of("systolic_bp", value("30", "mmHg"), "diastolic_bp", value("20", "mmHg")))));
    }

    @Test void triglycerideThresholdAndCholesterolConversion() {
        var entry = service.prepare(request("LIPID", "FASTING", Map.of("triglycerides", value("150", "mg/dL"), "ldl_cholesterol", value("100", "mg/dL"))));
        assertEquals(2, entry.values().size());
        assertEquals("TG_REFERENCE", rules.evaluate(entry).get(0).ruleCode());
        assertTrue(rules.evaluate(entry).get(0).label().contains("不低于"));
    }
}
