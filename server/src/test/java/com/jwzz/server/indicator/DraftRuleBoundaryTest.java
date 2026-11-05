package com.jwzz.server.indicator;

import static org.junit.jupiter.api.Assertions.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Map;
import org.junit.jupiter.api.Test;

class DraftRuleBoundaryTest {
    private final IndicatorService indicators = new IndicatorService();
    private final DraftRuleEngine rules = new DraftRuleEngine();

    private String bp(String systolic, String diastolic) {
        var entry = indicators.prepare(new IndicatorService.EntryRequest("BP", LocalDateTime.now().minusMinutes(1),
            "HOME", 30, false, Map.of("systolic_bp", new IndicatorService.ValueInput(new BigDecimal(systolic), "mmHg"),
            "diastolic_bp", new IndicatorService.ValueInput(new BigDecimal(diastolic), "mmHg"))));
        return rules.evaluate(entry).get(0).label();
    }

    private String glucose(String value, String context) {
        var entry = indicators.prepare(new IndicatorService.EntryRequest("GLUCOSE", LocalDateTime.now().minusMinutes(1),
            context, 30, false, Map.of("blood_glucose", new IndicatorService.ValueInput(new BigDecimal(value), "mg/dL"))));
        var result = rules.evaluate(entry);
        return result.isEmpty() ? "NO_RULE" : result.get(0).label();
    }

    @Test void bloodPressureBoundariesAndHighestComponentWin() {
        assertEquals("正常参考区间", bp("119", "79"));
        assertEquals("血压升高参考区间", bp("120", "79"));
        assertEquals("高血压 1 级参考区间", bp("130", "79"));
        assertEquals("高血压 1 级参考区间", bp("119", "80"));
        assertEquals("高血压 2 级参考区间", bp("140", "79"));
        assertEquals("高血压 2 级参考区间", bp("119", "90"));
        assertEquals("高血压 2 级参考区间", bp("180", "90"));
        assertTrue(bp("181", "90").contains("读数极高"));
    }

    @Test void glucoseRuleOnlyForAdultFastingPlasmaAndBoundaries() {
        assertEquals("NO_RULE", glucose("99", "CAPILLARY"));
        assertTrue(glucose("99", "FASTING_PLASMA").contains("低于"));
        assertTrue(glucose("100", "FASTING_PLASMA").contains("中间"));
        assertTrue(glucose("125", "FASTING_PLASMA").contains("中间"));
        assertTrue(glucose("126", "FASTING_PLASMA").contains("高值"));
    }

    @Test void pregnantAndChildrenDoNotReceiveAdultRule() {
        for (int age : new int[] {12, 17}) {
            var request = new IndicatorService.EntryRequest("BP", LocalDateTime.now().minusMinutes(1), "HOME", age, false,
                Map.of("systolic_bp", new IndicatorService.ValueInput(new BigDecimal("150"), "mmHg"),
                    "diastolic_bp", new IndicatorService.ValueInput(new BigDecimal("95"), "mmHg")));
            assertTrue(rules.evaluate(indicators.prepare(request)).isEmpty());
        }
        var pregnant = new IndicatorService.EntryRequest("BP", LocalDateTime.now().minusMinutes(1), "HOME", 30, true,
            Map.of("systolic_bp", new IndicatorService.ValueInput(new BigDecimal("150"), "mmHg"),
                "diastolic_bp", new IndicatorService.ValueInput(new BigDecimal("95"), "mmHg")));
        assertTrue(rules.evaluate(indicators.prepare(pregnant)).isEmpty());
    }

    @Test void triglycerideBoundary() {
        for (String value : new String[] {"149", "150"}) {
            var entry = indicators.prepare(new IndicatorService.EntryRequest("LIPID", LocalDateTime.now().minusMinutes(1),
                "FASTING", 30, false, Map.of("triglycerides", new IndicatorService.ValueInput(new BigDecimal(value), "mg/dL"))));
            assertEquals(value.equals("150"), rules.evaluate(entry).get(0).label().contains("不低于"));
        }
    }
}
