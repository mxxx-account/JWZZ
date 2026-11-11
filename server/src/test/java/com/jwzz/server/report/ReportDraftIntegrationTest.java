package com.jwzz.server.report;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
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
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

@EnabledIfEnvironmentVariable(named = "JWZZ_IT_DB_URL", matches = ".+")
@SpringBootTest(properties = {"app.redis.enabled=false", "app.agent.model-enabled=false", "demo.doctor.email=", "demo.doctor.password="})
@AutoConfigureMockMvc
@Transactional
class ReportDraftIntegrationTest {
    private static final LocalDateTime ANCHOR = LocalDateTime.of(2026, 1, 5, 9, 0);
    private static final String PASSWORD = "SyntheticAgentDraft123!";
    private static final String DRAFT_PATH = "/api/reports/{reportId}/assistant";
    private static final String PREPARE = "{\"action\":\"PREPARE_CONSULTATION\"}";

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
    void rendersDeterministicTemplatesForVerifiedHistoryOrCurrentOnlyWithoutWrites() throws Exception {
        String firstEntry = bloodPressure(ANCHOR.minusDays(2), "HOME");
        long currentOnly = generation.generate(owner.id(), firstEntry).id();
        bloodPressure(ANCHOR.minusDays(1), "CLINIC");
        String latestEntry = bloodPressure(ANCHOR, "HOME");
        long withHistory = generation.generate(owner.id(), latestEntry).id();
        var beforeRecords = indicators.latest(owner.id());
        var beforeReports = reports.ownedBy(owner.id());

        draft(ownerSession, currentOnly, PREPARE).andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.reportId").value(currentOnly))
            .andExpect(jsonPath("$.mode").value("TEMPLATE"))
            .andExpect(jsonPath("$.modelStatus").value("NOT_REQUESTED"))
            .andExpect(jsonPath("$.questions.length()").value(2))
            .andExpect(jsonPath("$.draft").value(containsString("本次测量")))
            .andExpect(jsonPath("$.draft").value(not(containsString("上次"))));
        byte[] first = draft(ownerSession, withHistory, PREPARE).andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.reportId").value(withHistory))
            .andExpect(jsonPath("$.mode").value("TEMPLATE"))
            .andExpect(jsonPath("$.questions.length()").value(2))
            .andExpect(jsonPath("$.draft").value(containsString("同条件的上次记录")))
            .andExpect(jsonPath("$.draft").value(not(containsString("128"))))
            .andReturn().getResponse().getContentAsByteArray();
        byte[] repeated = draft(ownerSession, withHistory, PREPARE).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsByteArray();
        assertEquals(mapper.readTree(first), mapper.readTree(repeated));

        assertEquals(beforeRecords, indicators.latest(owner.id()));
        assertEquals(beforeReports, reports.ownedBy(owner.id()));
        assertEquals(0L, jdbc.queryForObject(
            "SELECT COUNT(*) FROM report_access_grant WHERE report_id IN (?, ?)", Long.class, currentOnly, withHistory));
        assertEquals(0L, jdbc.queryForObject(
            "SELECT COUNT(*) FROM consultation_request WHERE user_id=?", Long.class, owner.id()));
    }

    @Test
    void requiresOwnerSessionAndCsrfEvenWhenDoctorAlreadyHasReportGrant() throws Exception {
        long report = generation.generate(owner.id(), bloodPressure(ANCHOR, "HOME")).id();
        var other = login(syntheticUser("USER").email());
        var doctor = syntheticUser("DOCTOR");
        var doctorSession = login(doctor.email());
        var merchant = login(syntheticUser("MERCHANT").email());
        reports.grant(report, doctor.id());

        draft(null, report, PREPARE).andExpect(status().isUnauthorized());
        mvc.perform(post(DRAFT_PATH, report).session(ownerSession)
                .contentType(MediaType.APPLICATION_JSON).content(PREPARE))
            .andExpect(status().isForbidden());
        draft(other, report, PREPARE).andExpect(status().isNotFound());
        draft(ownerSession, Long.MAX_VALUE, PREPARE).andExpect(status().isNotFound());
        draft(merchant, report, PREPARE).andExpect(status().isForbidden());
        draft(doctorSession, report, PREPARE).andExpect(status().isForbidden());
        mvc.perform(get("/api/reports/{id}", report).session(doctorSession)).andExpect(status().isOk());
    }

    @Test
    void rejectsUnknownActionsAndReportsWithoutUsableBloodPressureSnapshots() throws Exception {
        long report = generation.generate(owner.id(), bloodPressure(ANCHOR, "HOME")).id();
        var unsupported = indicatorService.prepare(new IndicatorService.EntryRequest("GLUCOSE", ANCHOR,
            "FASTING_PLASMA", 22, false, Map.of("blood_glucose", value("5.4", "mmol/L"))));
        indicators.save(owner.id(), unsupported);
        long glucoseReport = generation.generate(owner.id(), unsupported.entryId()).id();
        long oldReport = reports.saveGenerated(owner.id(), UUID.randomUUID().toString(), "legacy",
            "{\"title\":\"Old demo\",\"category\":\"BP\"}").id();

        draft(ownerSession, report, "{}").andExpect(status().isBadRequest());
        draft(ownerSession, report, "{\"action\":\"SEND_CONSULTATION\"}").andExpect(status().isBadRequest());
        draft(ownerSession, report, "{\"action\":\"PREPARE_CONSULTATION\",\"focus\":\"UNSAFE\"}").andExpect(status().isBadRequest());
        draft(ownerSession, report, "{\"action\":\"PREPARE_CONSULTATION\",\"useModel\":\"true\"}").andExpect(status().isBadRequest());
        draft(ownerSession, glucoseReport, PREPARE).andExpect(status().isConflict());
        draft(ownerSession, oldReport, PREPARE).andExpect(status().isConflict());
    }

    @Test
    void preservesFocusedTemplateWhenModelIsDisabledAndNoComparisonExists() throws Exception {
        long report = generation.generate(owner.id(), bloodPressure(ANCHOR, "CLINIC")).id();
        draft(ownerSession, report, "{\"action\":\"PREPARE_CONSULTATION\",\"focus\":\"COMPARISON\",\"useModel\":true}")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.mode").value("TEMPLATE"))
            .andExpect(jsonPath("$.modelStatus").value("DISABLED"))
            .andExpect(jsonPath("$.questions[0]").value(containsString("诊室测量")))
            .andExpect(jsonPath("$.draft").value(not(containsString("上次"))));
    }

    private UserStore.User syntheticUser(String role) {
        String email = "agent-stage2-" + UUID.randomUUID() + "@example.invalid";
        users.create(email, encoder.encode(PASSWORD), role, "Agent draft test " + role);
        return users.findByEmail(email).orElseThrow();
    }

    private MockHttpSession login(String email) throws Exception {
        var request = post("/api/auth/login").contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .param("email", email).param("password", PASSWORD);
        return (MockHttpSession) mvc.perform(withCsrf(request, null)).andExpect(status().isOk())
            .andReturn().getRequest().getSession(false);
    }

    private ResultActions draft(MockHttpSession session, long reportId, String body) throws Exception {
        return mvc.perform(withCsrf(post(DRAFT_PATH, reportId)
            .contentType(MediaType.APPLICATION_JSON).content(body), session));
    }

    private MockHttpServletRequestBuilder withCsrf(MockHttpServletRequestBuilder request, MockHttpSession session)
        throws Exception {
        var csrfRequest = get("/api/auth/csrf");
        if (session != null) {
            csrfRequest.session(session);
            request.session(session);
        }
        var csrf = mvc.perform(csrfRequest).andExpect(status().isOk()).andReturn().getResponse();
        String token = mapper.readTree(csrf.getContentAsString()).path("token").asText();
        return request.cookie(csrf.getCookie("XSRF-TOKEN")).header("X-XSRF-TOKEN", token);
    }

    private String bloodPressure(LocalDateTime measuredAt, String context) {
        var entry = indicatorService.prepare(new IndicatorService.EntryRequest("BP", measuredAt, context, 22, false,
            Map.of("systolic_bp", value("128", "mmHg"), "diastolic_bp", value("79", "mmHg"))));
        indicators.save(owner.id(), entry);
        return entry.entryId();
    }

    private static IndicatorService.ValueInput value(String amount, String unit) {
        return new IndicatorService.ValueInput(new BigDecimal(amount), unit);
    }
}
