package com.jwzz.server.report;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jwzz.server.auth.UserStore;
import com.jwzz.server.indicator.IndicatorService;
import com.jwzz.server.indicator.IndicatorStore;
import com.jwzz.server.shop.OrderExpiryJob;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@EnabledIfEnvironmentVariable(named = "JWZZ_IT_DB_URL", matches = ".+")
@SpringBootTest(properties = {"app.redis.enabled=false", "demo.doctor.email=", "demo.doctor.password="})
@AutoConfigureMockMvc
@Transactional
class ReportEvidenceIntegrationTest {
    private static final LocalDateTime ANCHOR = LocalDateTime.of(2026, 1, 5, 9, 0);
    private static final String SYS = "systolic_bp";
    private static final String DIA = "diastolic_bp";
    private static final String PASSWORD = "SyntheticAgentDemo123!";
    private static final String EVIDENCE = "/api/reports/{reportId}/assistant/evidence";
    private static final String KNOWLEDGE = "/api/reports/{reportId}/assistant/knowledge";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired UserStore users;
    @Autowired PasswordEncoder encoder;
    @Autowired IndicatorService indicatorService;
    @Autowired IndicatorStore indicators;
    @Autowired ReportGenerationService generation;
    @Autowired ReportStore reports;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean OrderExpiryJob orderExpiryJob;
    private UserStore.User owner;
    private MockHttpSession ownerSession;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("JWZZ_IT_DB_URL"));
    }

    @BeforeEach
    void signInOwner() throws Exception {
        owner = syntheticUser("USER");
        ownerSession = login(owner.email());
    }

    @Test
    void oldReportUsesItsImmutableSnapshotAndLatestEarlierSameContextPair() throws Exception {
        long report = generation.generate(owner.id(), bloodPressure(owner.id(), ANCHOR, "HOME", "129.5001", "76")).id();
        bloodPressure(owner.id(), ANCHOR.minusDays(4), "HOME", "115", "80");
        bloodPressure(owner.id(), ANCHOR.minusDays(3), "HOME", "122.2500", "78");
        bloodPressure(owner.id(), ANCHOR.minusDays(2), "CLINIC", "170", "95");
        bloodPressure(owner.id(), ANCHOR, "HOME", "166", "91");
        bloodPressure(owner.id(), ANCHOR.plusDays(2), "HOME", "155", "92");
        var anotherUser = syntheticUser("USER");
        bloodPressure(anotherUser.id(), ANCHOR.minusHours(1), "HOME", "145", "89");
        String originalReport = reports.findById(report).orElseThrow().content();
        jdbc.update("UPDATE indicator_record SET numeric_value=160 WHERE user_id=? AND indicator_code=? AND measured_at=?",
            owner.id(), SYS, ANCHOR);

        mvc.perform(get(EVIDENCE, report).session(ownerSession))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.status").value("AVAILABLE"))
            .andExpect(jsonPath("$.current.measuredAt").value("2026-01-05T09:00:00"))
            .andExpect(jsonPath("$.current.context").value("HOME"))
            .andExpect(jsonPath("$.current.systolic").value(129.5001))
            .andExpect(jsonPath("$.previous.measuredAt").value("2026-01-02T09:00:00"))
            .andExpect(jsonPath("$.previous.systolic").value(122.25))
            .andExpect(jsonPath("$.previous.diastolic").value(78))
            .andExpect(jsonPath("$.change.systolic").value(7.2501))
            .andExpect(jsonPath("$.change.diastolic").value(-2))
            .andExpect(jsonPath("$.indicators[0].label").value("收缩压"))
            .andExpect(jsonPath("$.indicators[0].unit").value("mmHg"))
            .andExpect(jsonPath("$.ownerId").doesNotExist())
            .andExpect(jsonPath("$.current.ageYears").doesNotExist())
            .andExpect(jsonPath("$.interpretations").doesNotExist());
        assertEquals(originalReport, reports.findById(report).orElseThrow().content());
    }

    @Test
    void skipsUnverifiedIncompatibleIncompleteAndAmbiguousEntriesWithoutMixingRows() throws Exception {
        long report = generation.generate(owner.id(), bloodPressure(owner.id(), ANCHOR, "HOME", "129", "76")).id();
        var legacy = bloodPressure(owner.id(), ANCHOR.minusHours(1), "HOME", "140", "80");
        var wrongUnit = bloodPressure(owner.id(), ANCHOR.minusHours(2), "HOME", "145", "81");
        var missingDiastolic = bloodPressure(owner.id(), ANCHOR.minusHours(3), "HOME", "150", "85");
        var missingSystolic = bloodPressure(owner.id(), ANCHOR.minusHours(3), "HOME", "151", "86");
        var inconsistent = bloodPressure(owner.id(), ANCHOR.minusHours(4), "HOME", "152", "87");
        var duplicate = bloodPressure(owner.id(), ANCHOR.minusHours(5), "HOME", "153", "88");
        jdbc.update("UPDATE indicator_record SET conversion_version='legacy-unverified' WHERE user_id=? AND entry_id=?",
            owner.id(), legacy);
        jdbc.update("UPDATE indicator_record SET unit='kPa' WHERE user_id=? AND entry_id=? AND indicator_code=?",
            owner.id(), wrongUnit, SYS);
        jdbc.update("DELETE FROM indicator_record WHERE user_id=? AND entry_id=? AND indicator_code=?",
            owner.id(), missingDiastolic, DIA);
        jdbc.update("DELETE FROM indicator_record WHERE user_id=? AND entry_id=? AND indicator_code=?",
            owner.id(), missingSystolic, SYS);
        jdbc.update("UPDATE indicator_record SET measurement_context='CLINIC' WHERE user_id=? AND entry_id=? AND indicator_code=?",
            owner.id(), inconsistent, DIA);
        jdbc.update("""
            INSERT INTO indicator_record (user_id, entry_id, indicator_code, numeric_value, unit, raw_numeric_value,
                raw_unit, conversion_version, measurement_context, measured_at, age_years, pregnant)
            SELECT user_id, entry_id, indicator_code, numeric_value, unit, raw_numeric_value,
                raw_unit, conversion_version, measurement_context, measured_at, age_years, pregnant
            FROM indicator_record WHERE user_id=? AND entry_id=? AND indicator_code=?
            """, owner.id(), duplicate, SYS);

        mvc.perform(get(EVIDENCE, report).session(ownerSession))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("NO_COMPARABLE_HISTORY"))
            .andExpect(jsonPath("$.current.systolic").value(129))
            .andExpect(jsonPath("$.previous").doesNotExist()).andExpect(jsonPath("$.change").doesNotExist());

        bloodPressure(owner.id(), ANCHOR.minusHours(7), "HOME", "119", "75");
        mvc.perform(get(EVIDENCE, report).session(ownerSession))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("AVAILABLE"))
            .andExpect(jsonPath("$.previous.measuredAt").value("2026-01-05T02:00:00"))
            .andExpect(jsonPath("$.change.systolic").value(10)).andExpect(jsonPath("$.change.diastolic").value(1));
    }

    @Test
    void singleReadingIsNotComparedWithItself() throws Exception {
        long report = generation.generate(owner.id(), bloodPressure(owner.id(), ANCHOR, "HOME", "123", "79")).id();
        mvc.perform(get(EVIDENCE, report).session(ownerSession))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("NO_COMPARABLE_HISTORY"))
            .andExpect(jsonPath("$.current.systolic").value(123))
            .andExpect(jsonPath("$.previous").doesNotExist()).andExpect(jsonPath("$.change").doesNotExist());
    }

    @Test
    void unsupportedCategoryAndLegacySnapshotHaveExplicitStatuses() throws Exception {
        String glucose = save(owner.id(), "GLUCOSE", ANCHOR, "FASTING_PLASMA",
            Map.of("blood_glucose", new IndicatorService.ValueInput(new BigDecimal("5.4"), "mmol/L")));
        long glucoseReport = generation.generate(owner.id(), glucose).id();
        long legacyReport = reports.saveGenerated(owner.id(), UUID.randomUUID().toString(), "legacy",
            "{\"title\":\"Old demo\",\"category\":\"BP\"}").id();
        mvc.perform(get(EVIDENCE, glucoseReport).session(ownerSession))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UNSUPPORTED_CATEGORY"))
            .andExpect(jsonPath("$.current").doesNotExist());
        mvc.perform(get(EVIDENCE, legacyReport).session(ownerSession))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UNSUPPORTED_SNAPSHOT"))
            .andExpect(jsonPath("$.current").doesNotExist());
    }

    @Test
    void onlyOwnerCanReadEvenWhenDoctorHasOriginalReportGrant() throws Exception {
        long report = generation.generate(owner.id(), bloodPressure(owner.id(), ANCHOR, "HOME", "128", "79")).id();
        var other = login(syntheticUser("USER").email());
        var doctor = syntheticUser("DOCTOR");
        var doctorSession = login(doctor.email());
        var merchant = login(syntheticUser("MERCHANT").email());
        reports.grant(report, doctor.id());

        mvc.perform(get(EVIDENCE, report)).andExpect(status().isUnauthorized());
        mvc.perform(get(EVIDENCE, report).session(other)).andExpect(status().isNotFound());
        mvc.perform(get(EVIDENCE, Long.MAX_VALUE).session(ownerSession)).andExpect(status().isNotFound());
        mvc.perform(get(EVIDENCE, report).session(merchant)).andExpect(status().isForbidden());
        mvc.perform(get(EVIDENCE, report).session(doctorSession)).andExpect(status().isForbidden());
        mvc.perform(get("/api/reports/{id}", report).session(doctorSession)).andExpect(status().isOk());
        mvc.perform(get(EVIDENCE, report).session(ownerSession)).andExpect(status().isOk());
    }

    @Test
    void knowledgeAnswersWithVersionAndSourcesOrAbstainsWithoutReportValues() throws Exception {
        long report = generation.generate(owner.id(), bloodPressure(owner.id(), ANCHOR, "HOME", "129.5001", "79")).id();
        mvc.perform(get(KNOWLEDGE, report).session(ownerSession))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$[0].id").value("bp-measurement-context"));
        mvc.perform(question(report, ownerSession, "家里和诊室量的血压能直接比吗？"))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.status").value("ANSWERED"))
            .andExpect(jsonPath("$.topic.id").value("bp-comparable-records"))
            .andExpect(jsonPath("$.corpusVersion").value("bp-basics-2026-11-19-v1"))
            .andExpect(jsonPath("$.passages[0].section").value("Things that can affect your blood pressure reading"))
            .andExpect(jsonPath("$.passages[1].url").isNotEmpty())
            .andExpect(jsonPath("$.current").doesNotExist());
        mvc.perform(question(report, ownerSession, "为什么要记录测量条件，我需要停药吗？"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("INSUFFICIENT_EVIDENCE"))
            .andExpect(jsonPath("$.passages").isEmpty());
        mvc.perform(question(report, ownerSession, "KNOWLEDGE-LOG-PRIVACY-SENTINEL".repeat(10))).andExpect(status().isBadRequest());
        mvc.perform(question(report, ownerSession, "   ")).andExpect(status().isBadRequest());
    }

    @Test
    void knowledgeChecksReportKindOwnershipRoleAndCsrf() throws Exception {
        long report = generation.generate(owner.id(), bloodPressure(owner.id(), ANCHOR, "HOME", "128", "79")).id();
        long glucose = reports.saveGenerated(owner.id(), UUID.randomUUID().toString(), "test", "{\"category\":\"GLUCOSE\"}").id();
        var stranger = login(syntheticUser("USER").email());
        var doctor = syntheticUser("DOCTOR");
        var doctorSession = login(doctor.email());
        reports.grant(report, doctor.id());
        mvc.perform(get(KNOWLEDGE, report)).andExpect(status().isUnauthorized());
        mvc.perform(get(KNOWLEDGE, report).session(stranger)).andExpect(status().isNotFound());
        mvc.perform(get(KNOWLEDGE, glucose).session(ownerSession)).andExpect(status().isConflict());
        mvc.perform(question(report, doctorSession, "为什么要记录测量条件？")).andExpect(status().isForbidden());
        mvc.perform(question(report, stranger, "为什么要记录测量条件？")).andExpect(status().isNotFound());
        mvc.perform(post(KNOWLEDGE, report).session(ownerSession)
            .contentType(MediaType.APPLICATION_JSON).content("{\"question\":\"为什么要记录测量条件？\"}"))
            .andExpect(status().isForbidden());
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder question(
        long id, MockHttpSession session, String text) throws Exception {
        var csrf = mvc.perform(get("/api/auth/csrf").session(session)).andExpect(status().isOk()).andReturn().getResponse();
        String token = mapper.readTree(csrf.getContentAsString()).path("token").asText();
        return post(KNOWLEDGE, id).session(session).contentType(MediaType.APPLICATION_JSON)
            .cookie(csrf.getCookie("XSRF-TOKEN")).header("X-XSRF-TOKEN", token)
            .content(mapper.writeValueAsString(Map.of("question", text)));
    }

    private UserStore.User syntheticUser(String role) {
        String email = "agent-stage1-" + UUID.randomUUID() + "@example.invalid";
        users.create(email, encoder.encode(PASSWORD), role, "Agent test " + role);
        return users.findByEmail(email).orElseThrow();
    }

    private MockHttpSession login(String email) throws Exception {
        var csrf = mvc.perform(get("/api/auth/csrf")).andExpect(status().isOk()).andReturn().getResponse();
        String token = mapper.readTree(csrf.getContentAsString()).path("token").asText();
        return (MockHttpSession) mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED).param("email", email).param("password", PASSWORD)
                .cookie(csrf.getCookie("XSRF-TOKEN")).header("X-XSRF-TOKEN", token))
            .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }

    private String bloodPressure(long userId, LocalDateTime time, String context, String systolic, String diastolic) {
        return save(userId, "BP", time, context, Map.of(
            SYS, new IndicatorService.ValueInput(new BigDecimal(systolic), "mmHg"),
            DIA, new IndicatorService.ValueInput(new BigDecimal(diastolic), "mmHg")));
    }

    private String save(long userId, String category, LocalDateTime time, String context,
                        Map<String, IndicatorService.ValueInput> values) {
        var entry = indicatorService.prepare(new IndicatorService.EntryRequest(category, time, context, 22, false, values));
        indicators.save(userId, entry);
        return entry.entryId();
    }
}
