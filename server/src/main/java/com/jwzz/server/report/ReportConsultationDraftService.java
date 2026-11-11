package com.jwzz.server.report;

import com.jwzz.server.auth.UserStore;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ReportConsultationDraftService {
    public enum Mode { TEMPLATE }
    public record ConsultationDraft(long reportId, Mode mode, List<String> questions, String draft) {}

    private static final String MEASUREMENT_QUESTION = "下次测量时，我可以记录哪些信息，方便您后续查看？";
    private final ReportEvidenceService evidence;

    public ReportConsultationDraftService(ReportEvidenceService evidence) {
        this.evidence = evidence;
    }

    public ConsultationDraft prepare(UserStore.User actor, long reportId) {
        // Authorize ownership and determine whether a comparable record actually exists on the server.
        var reportEvidence = evidence.forOwner(actor, reportId);
        return switch (reportEvidence.status()) {
            case AVAILABLE -> new ConsultationDraft(reportId, Mode.TEMPLATE,
                List.of("解读这份血压报告和同条件的上次记录时，有哪些测量信息需要我补充？", MEASUREMENT_QUESTION),
                "您好，想请您帮我看看这份血压报告和同条件的上次记录。解读这些记录时，有哪些测量信息需要我补充？");
            case NO_COMPARABLE_HISTORY -> new ConsultationDraft(reportId, Mode.TEMPLATE,
                List.of("仅有本次血压记录时，有哪些测量信息需要我补充？", MEASUREMENT_QUESTION),
                "您好，想请您帮我看看这份血压报告。关于本次测量，您需要我补充哪些信息？下次测量时，我可以记录哪些信息，方便您后续查看？");
            case UNSUPPORTED_CATEGORY, UNSUPPORTED_SNAPSHOT ->
                throw new ResponseStatusException(HttpStatus.CONFLICT, "当前报告暂不支持生成咨询草稿。");
        };
    }
}
