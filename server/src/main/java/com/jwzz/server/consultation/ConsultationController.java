package com.jwzz.server.consultation;

import com.jwzz.server.auth.UserStore;
import com.jwzz.server.common.RequestRateLimiter;
import com.jwzz.server.report.ReportStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.security.Principal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class ConsultationController {
    public record CreateRequest(@NotNull Long reportId, @NotBlank @Size(min = 10, max = 1000) String question) {}
    public record ReplyRequest(@NotBlank @Size(min = 10, max = 2000) String answer) {}

    private final UserStore users;
    private final ReportStore reports;
    private final ConsultationStore consultations;
    private final RequestRateLimiter limiter;
    public ConsultationController(UserStore users, ReportStore reports, ConsultationStore consultations,
                                  RequestRateLimiter limiter) {
        this.users = users; this.reports = reports; this.consultations = consultations; this.limiter = limiter;
    }

    @GetMapping("/consultations")
    public List<ConsultationStore.Consultation> mine(Principal principal) {
        return consultations.forUser(current(principal).id());
    }

    @PostMapping("/consultations")
    @ResponseStatus(HttpStatus.CREATED)
    public ConsultationStore.Consultation create(@Valid @RequestBody CreateRequest request, Principal principal) {
        String question = request.question().trim();
        if (question.length() < 10) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Question is too short");
        long userId = current(principal).id();
        var report = reports.findById(request.reportId()).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (report.userId() != userId) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if (reports.activeDoctorIds(report.id()).isEmpty())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Authorize a doctor for this report first");
        limiter.check("consultation-create", userId, 5);
        return consultations.create(report.id(), userId, question);
    }

    @GetMapping("/doctor/consultations")
    public List<ConsultationStore.Consultation> forDoctor(Principal principal) {
        return consultations.forDoctor(current(principal).id());
    }

    @PostMapping("/doctor/consultations/{id}/claim")
    public ConsultationStore.Consultation claim(@PathVariable long id, Principal principal) {
        long doctorId = current(principal).id();
        if (consultations.findForDoctor(id, doctorId).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if (!consultations.claim(id, doctorId))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Consultation already claimed or access revoked");
        return consultations.find(id).orElseThrow();
    }

    @PostMapping("/doctor/consultations/{id}/reply")
    public ConsultationStore.Consultation reply(@PathVariable long id, @Valid @RequestBody ReplyRequest request,
                                                Principal principal) {
        String answer = request.answer().trim();
        if (answer.length() < 10) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Answer is too short");
        long doctorId = current(principal).id();
        if (consultations.findForDoctor(id, doctorId).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        limiter.check("consultation-reply", doctorId, 20);
        if (!consultations.answer(id, doctorId, answer))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Claim this consultation or restore report access first");
        return consultations.find(id).orElseThrow();
    }

    private UserStore.User current(Principal principal) {
        return users.findByEmail(principal.getName()).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }
}
