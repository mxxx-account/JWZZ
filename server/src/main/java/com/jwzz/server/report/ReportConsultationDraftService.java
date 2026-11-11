package com.jwzz.server.report;

import com.jwzz.server.auth.UserStore;
import com.jwzz.server.common.RequestRateLimiter;
import com.jwzz.server.report.ReportDraftModelGateway.Context;
import com.jwzz.server.report.ReportDraftModelGateway.Focus;
import com.jwzz.server.report.ReportDraftModelGateway.Opening;
import com.jwzz.server.report.ReportDraftModelGateway.Plan;
import com.jwzz.server.report.ReportDraftModelGateway.Topic;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ReportConsultationDraftService {
    public enum Mode { TEMPLATE, MODEL }
    public enum ModelStatus { NOT_REQUESTED, DISABLED, USED, UNAVAILABLE }
    public record ConsultationDraft(long reportId, Mode mode, List<String> questions, String draft, ModelStatus modelStatus) {}

    private static final String MEASUREMENT_QUESTION = "下次测量时，我可以记录哪些信息，方便您后续查看？";
    private final ReportEvidenceService evidence;
    private final ReportDraftModelGateway model;
    private final RequestRateLimiter limiter;
    private final boolean modelEnabled;

    public ReportConsultationDraftService(ReportEvidenceService evidence, ReportDraftModelGateway model,
                                          RequestRateLimiter limiter, @Value("${app.agent.model-enabled}") boolean modelEnabled) {
        this.evidence = evidence;
        this.model = model;
        this.limiter = limiter;
        this.modelEnabled = modelEnabled;
    }

    ConsultationDraft prepare(UserStore.User actor, long reportId, Focus requestedFocus, boolean useModel) {
        // Verify ownership and facts before any contact with the separate model process.
        var reportEvidence = evidence.forOwner(actor, reportId);
        if (reportEvidence.status() == ReportEvidenceService.Status.UNSUPPORTED_CATEGORY
            || reportEvidence.status() == ReportEvidenceService.Status.UNSUPPORTED_SNAPSHOT)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "当前报告暂不支持生成咨询草稿。");
        boolean history = reportEvidence.status() == ReportEvidenceService.Status.AVAILABLE;
        Focus focus = requestedFocus == Focus.COMPARISON && !history ? Focus.MEASUREMENT : requestedFocus;
        var context = new Context(reportEvidence.current().context(), history, focus);

        if (!useModel) return template(reportId, context, ModelStatus.NOT_REQUESTED);
        if (!modelEnabled) return template(reportId, context, ModelStatus.DISABLED);
        try {
            limiter.check("report-draft-model", actor.id(), 5);
        } catch (ResponseStatusException exception) {
            if (!exception.getStatusCode().equals(HttpStatus.TOO_MANY_REQUESTS)) throw exception;
            return template(reportId, context, ModelStatus.UNAVAILABLE);
        }
        return model.request(context)
            .map(plan -> render(reportId, context, plan, Mode.MODEL, ModelStatus.USED))
            .orElseGet(() -> template(reportId, context, ModelStatus.UNAVAILABLE));
    }

    private static ConsultationDraft template(long reportId, Context context, ModelStatus modelStatus) {
        if (context.focus() != Focus.BALANCED) {
            Topic primary = context.focus().primary;
            Topic secondary = primary == Topic.FOLLOW_UP ? Topic.MEASUREMENT_DETAILS : Topic.FOLLOW_UP;
            return render(reportId, context, new Plan(Opening.DIRECT, List.of(primary, secondary)), Mode.TEMPLATE, modelStatus);
        }
        return context.hasComparableHistory() ? new ConsultationDraft(reportId, Mode.TEMPLATE,
                List.of("解读这份血压报告和同条件的上次记录时，有哪些测量信息需要我补充？", MEASUREMENT_QUESTION),
                "您好，想请您帮我看看这份血压报告和同条件的上次记录。解读这些记录时，有哪些测量信息需要我补充？", modelStatus)
            : new ConsultationDraft(reportId, Mode.TEMPLATE,
                List.of("仅有本次血压记录时，有哪些测量信息需要我补充？", MEASUREMENT_QUESTION),
                "您好，想请您帮我看看这份血压报告。关于本次测量，您需要我补充哪些信息？下次测量时，我可以记录哪些信息，方便您后续查看？", modelStatus);
    }

    private static ConsultationDraft render(long reportId, Context context, Plan plan, Mode mode, ModelStatus modelStatus) {
        String setting = "HOME".equals(context.context()) ? "居家" : "诊室";
        List<String> questions = plan.topics().stream().map(topic -> switch (topic) {
            case CURRENT_REVIEW -> "查看本次血压报告时，有哪些信息需要我补充？";
            case MEASUREMENT_DETAILS -> "关于本次" + setting + "测量，您希望我补充哪些测量条件？";
            case COMPARE_RECORDS -> "对照同条件的上次记录时，还需要我说明哪些情况？";
            case FOLLOW_UP -> MEASUREMENT_QUESTION;
        }).toList();
        String opening = plan.opening() == Opening.POLITE ? "医生您好，方便时想请您帮我看看这份血压报告。"
            : "您好，想请您帮我看看这份血压报告。";
        return new ConsultationDraft(reportId, mode, questions, opening + String.join("", questions), modelStatus);
    }
}
