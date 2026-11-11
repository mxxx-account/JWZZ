package com.jwzz.server.report;

import com.jwzz.server.auth.UserStore;
import java.security.Principal;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class ReportEvidenceController {
    private final UserStore users;
    private final ReportEvidenceService evidence;

    public ReportEvidenceController(UserStore users, ReportEvidenceService evidence) {
        this.users = users;
        this.evidence = evidence;
    }

    @GetMapping("/api/reports/{reportId}/assistant/evidence")
    public ResponseEntity<ReportEvidenceService.Evidence> reportEvidence(@PathVariable long reportId, Principal principal) {
        var actor = users.findByEmail(principal.getName())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(evidence.forOwner(actor, reportId));
    }
}
