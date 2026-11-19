package com.jwzz.server.report;

import com.fasterxml.jackson.databind.JsonNode;
import com.jwzz.server.auth.UserStore;
import java.security.Principal;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/reports/{reportId}/assistant/knowledge")
public class ReportKnowledgeController {
    public record Question(JsonNode question) {}
    private final UserStore users;
    private final ReportStore reports;
    private final ReportKnowledge knowledge;

    public ReportKnowledgeController(UserStore users, ReportStore reports, ReportKnowledge knowledge) {
        this.users = users;
        this.reports = reports;
        this.knowledge = knowledge;
    }

    @GetMapping
    public ResponseEntity<List<ReportKnowledge.Topic>> topics(@PathVariable long reportId, Principal principal) {
        requireOwnedBpReport(reportId, principal);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(knowledge.topics());
    }

    @PostMapping
    public ResponseEntity<ReportKnowledge.Answer> ask(@PathVariable long reportId, Principal principal,
                                                     @RequestBody Question request) {
        requireOwnedBpReport(reportId, principal);
        var value = request.question();
        if (value == null || !value.isTextual() || value.textValue().isBlank() || value.textValue().length() > 200)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请输入 1 至 200 个字符的知识问题。");
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(knowledge.answer(value.textValue()));
    }

    // The default resolver can put rejected input in logs; return a fixed message instead.
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Void> invalidJson() {
        return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).build();
    }

    private void requireOwnedBpReport(long reportId, Principal principal) {
        var actor = users.findByEmail(principal.getName()).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        if (!actor.role().equals("USER")) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        var category = reports.ownedCategory(actor.id(), reportId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!"BP".equals(category)) throw new ResponseStatusException(HttpStatus.CONFLICT, "知识解释目前仅支持血压报告。");
    }
}
