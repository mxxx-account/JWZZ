package com.jwzz.server.report;

import com.fasterxml.jackson.databind.JsonNode;
import com.jwzz.server.auth.UserStore;
import java.security.Principal;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class ReportConsultationDraftController {
    public record DraftRequest(String action, String focus, JsonNode useModel) {}

    private final UserStore users;
    private final ReportConsultationDraftService drafts;

    public ReportConsultationDraftController(UserStore users, ReportConsultationDraftService drafts) {
        this.users = users;
        this.drafts = drafts;
    }

    @PostMapping("/api/reports/{reportId}/assistant")
    public ResponseEntity<ReportConsultationDraftService.ConsultationDraft> prepare(
        @PathVariable long reportId, @RequestBody DraftRequest request, Principal principal) {
        if (!"PREPARE_CONSULTATION".equals(request.action()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "未知的报告助手操作。");
        ReportDraftModelGateway.Focus focus;
        try {
            focus = request.focus() == null ? ReportDraftModelGateway.Focus.BALANCED
                : ReportDraftModelGateway.Focus.valueOf(request.focus());
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "未知的咨询关注点。");
        }
        JsonNode optIn = request.useModel();
        if (optIn != null && !optIn.isBoolean())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "模型选项必须为布尔值。");
        var actor = users.findByEmail(principal.getName())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(drafts.prepare(actor, reportId, focus, optIn != null && optIn.booleanValue()));
    }
}
