package com.jwzz.server.report;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.jwzz.server.auth.UserStore;
import com.jwzz.server.common.RequestRateLimiter;
import com.jwzz.server.report.ReportDraftModelGateway.Context;
import com.jwzz.server.report.ReportDraftModelGateway.Focus;
import com.jwzz.server.report.ReportDraftModelGateway.Opening;
import com.jwzz.server.report.ReportDraftModelGateway.Plan;
import com.jwzz.server.report.ReportDraftModelGateway.Topic;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class ReportConsultationDraftServiceTest {
    private static final UserStore.User OWNER = new UserStore.User(99, "fixture@example.invalid", "synthetic", "USER", "Fixture");
    private static final long REPORT_ID = 123;
    private final ReportEvidenceService evidence = mock(ReportEvidenceService.class);
    private final ReportDraftModelGateway model = mock(ReportDraftModelGateway.class);
    private final RequestRateLimiter limiter = mock(RequestRateLimiter.class);
    private final ReportConsultationDraftService enabled = new ReportConsultationDraftService(evidence, model, limiter, true);

    @Test
    void defaultDoesNotContactGatewayEvenWhenEnabled() {
        withHistory();
        var result = enabled.prepare(OWNER, REPORT_ID, Focus.BALANCED, false);
        assertEquals(ReportConsultationDraftService.Mode.TEMPLATE, result.mode());
        assertEquals(ReportConsultationDraftService.ModelStatus.NOT_REQUESTED, result.modelStatus());
        verifyNoInteractions(model, limiter);
    }

    @Test
    void modelPlanIsRenderedLocallyAfterEvidenceAndRateCheck() {
        withHistory();
        var context = new Context("HOME", true, Focus.COMPARISON);
        when(model.request(context)).thenReturn(Optional.of(new Plan(Opening.POLITE, List.of(Topic.COMPARE_RECORDS, Topic.FOLLOW_UP))));
        var result = enabled.prepare(OWNER, REPORT_ID, Focus.COMPARISON, true);
        assertEquals(ReportConsultationDraftService.Mode.MODEL, result.mode());
        assertEquals(ReportConsultationDraftService.ModelStatus.USED, result.modelStatus());
        assertTrue(result.draft().startsWith("医生您好"));
        assertTrue(result.questions().get(0).contains("同条件的上次记录"));
        assertFalse(result.draft().contains("128"));
        var order = inOrder(evidence, limiter, model);
        order.verify(evidence).forOwner(OWNER, REPORT_ID);
        order.verify(limiter).check("report-draft-model", OWNER.id(), 5);
        order.verify(model).request(context);
    }

    @Test
    void fallsBackAfterUnavailableModelAndNormalizesMissingHistory() {
        var current = reading();
        when(evidence.forOwner(OWNER, REPORT_ID)).thenReturn(new ReportEvidenceService.Evidence(REPORT_ID,
            ReportEvidenceService.Status.NO_COMPARABLE_HISTORY, List.of(), current, null, null, ""));
        var context = new Context("HOME", false, Focus.MEASUREMENT);
        when(model.request(context)).thenReturn(Optional.empty());
        var result = enabled.prepare(OWNER, REPORT_ID, Focus.COMPARISON, true);
        assertEquals(ReportConsultationDraftService.Mode.TEMPLATE, result.mode());
        assertEquals(ReportConsultationDraftService.ModelStatus.UNAVAILABLE, result.modelStatus());
        assertTrue(result.questions().get(0).contains("居家测量"));
        assertFalse(result.draft().contains("上次"));
        verify(model).request(context);
    }

    @Test
    void inaccessibleReportAndExhaustedQuotaDoNotContactModel() {
        when(evidence.forOwner(OWNER, REPORT_ID)).thenThrow(new ResponseStatusException(HttpStatus.NOT_FOUND));
        assertEquals(HttpStatus.NOT_FOUND, assertThrows(ResponseStatusException.class,
            () -> enabled.prepare(OWNER, REPORT_ID, Focus.BALANCED, true)).getStatusCode());
        verifyNoInteractions(model, limiter);

        doReturn(history()).when(evidence).forOwner(OWNER, REPORT_ID);
        doThrow(new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS)).when(limiter).check("report-draft-model", OWNER.id(), 5);
        assertEquals(ReportConsultationDraftService.ModelStatus.UNAVAILABLE,
            enabled.prepare(OWNER, REPORT_ID, Focus.BALANCED, true).modelStatus());
        verifyNoInteractions(model);
    }

    private void withHistory() { when(evidence.forOwner(OWNER, REPORT_ID)).thenReturn(history()); }

    private static ReportEvidenceService.Evidence history() {
        return new ReportEvidenceService.Evidence(REPORT_ID, ReportEvidenceService.Status.AVAILABLE, List.of(),
            reading(), reading(), new ReportEvidenceService.Change(BigDecimal.ZERO, BigDecimal.ZERO), "");
    }

    private static ReportEvidenceService.Reading reading() {
        return new ReportEvidenceService.Reading(LocalDateTime.of(2026, 1, 5, 9, 0), "HOME",
            new BigDecimal("128"), new BigDecimal("76"));
    }
}
