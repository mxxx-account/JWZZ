package com.jwzz.server.consultation;

import com.jwzz.server.auth.UserStore;
import com.jwzz.server.auth.DoctorDirectoryStore;
import com.jwzz.server.common.RequestRateLimiter;
import com.jwzz.server.report.ReportStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.security.Principal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
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
    public record CreateRequest(@NotNull Long reportId, Long doctorId, @Size(max = 1000) String question) {}
    public record ReplyRequest(@NotBlank @Size(min = 10, max = 2000) String answer) {}

    private final UserStore users;
    private final ReportStore reports;
    private final ConsultationStore consultations;
    private final MessageStore messages;
    private final DoctorDirectoryStore doctors;
    private final RequestRateLimiter limiter;
    public ConsultationController(UserStore users, ReportStore reports, ConsultationStore consultations,
                                  MessageStore messages, DoctorDirectoryStore doctors, RequestRateLimiter limiter) {
        this.users = users; this.reports = reports; this.consultations = consultations;
        this.messages = messages; this.doctors = doctors; this.limiter = limiter;
    }

    @GetMapping("/consultations")
    public List<ConsultationStore.Consultation> mine(Principal principal) {
        return consultations.forUser(current(principal).id());
    }

    @PostMapping("/consultations")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ConsultationStore.Consultation create(@Valid @RequestBody CreateRequest request, Principal principal) {
        String question = request.question() == null || request.question().isBlank()
            ? "您好，请帮我看看我的指标报告！" : request.question().trim();
        long userId = current(principal).id();
        var report = reports.findById(request.reportId()).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (report.userId() != userId) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        var allowed = reports.activeDoctorIds(report.id());
        if (allowed.isEmpty())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Authorize a doctor for this report first");
        long doctorId;
        if (request.doctorId() != null) {
            doctorId = request.doctorId();
            if (!allowed.contains(doctorId)) throw new ResponseStatusException(HttpStatus.CONFLICT, "Doctor is not authorized");
        } else if (allowed.size() == 1) {
            doctorId = allowed.get(0);
        } else {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select a doctor");
        }
        if (doctors.find(doctorId).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        limiter.check("consultation-create", userId, 5);
        var created = consultations.create(report.id(), userId, doctorId, question);
        messages.add(created.id(), userId, question);
        return created;
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
    @Transactional
    public ConsultationStore.Consultation reply(@PathVariable long id, @Valid @RequestBody ReplyRequest request,
                                                Principal principal) {
        String answer = request.answer().trim();
        if (answer.length() < 10) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Answer is too short");
        long doctorId = current(principal).id();
        if (consultations.findForDoctor(id, doctorId).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        limiter.check("consultation-reply", doctorId, 20);
        if (!consultations.answer(id, doctorId, answer))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Claim this consultation or restore report access first");
        messages.add(id, doctorId, answer);
        return consultations.find(id).orElseThrow();
    }

    private UserStore.User current(Principal principal) {
        return users.findByEmail(principal.getName()).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }
}
