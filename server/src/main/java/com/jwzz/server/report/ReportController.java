package com.jwzz.server.report;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jwzz.server.auth.UserStore;
import java.security.Principal;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class ReportController {
    public record ReportView(long id, long ownerId, String ruleVersion, JsonNode content, LocalDateTime createdAt) {}
    public record GrantRequest(String doctorEmail) {}
    public record GrantView(long doctorId, String doctorEmail) {}

    private final UserStore users;
    private final ReportStore reports;
    private final ObjectMapper mapper;
    public ReportController(UserStore users, ReportStore reports, ObjectMapper mapper) {
        this.users = users; this.reports = reports; this.mapper = mapper;
    }

    @GetMapping("/reports")
    public List<ReportView> ownReports(Principal principal) {
        UserStore.User user = current(principal);
        if (!user.role().equals("USER")) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        return reports.ownedBy(user.id()).stream().map(this::view).toList();
    }

    @GetMapping("/doctor/reports")
    public List<ReportView> sharedReports(Principal principal) {
        return reports.sharedWith(current(principal).id()).stream().map(this::view).toList();
    }

    @GetMapping("/reports/{id}")
    public ReportView report(@PathVariable long id, Principal principal) {
        UserStore.User user = current(principal);
        ReportStore.Report report = reports.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        boolean owner = user.role().equals("USER") && report.userId() == user.id();
        boolean doctor = user.role().equals("DOCTOR") && reports.activeGrant(id, user.id());
        if (!owner && !doctor) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        return view(report);
    }

    @GetMapping("/reports/{id}/grants")
    public List<GrantView> grants(@PathVariable long id, Principal principal) {
        requireOwner(id, current(principal));
        return reports.activeDoctorIds(id).stream()
            .map(doctorId -> users.findById(doctorId).orElseThrow())
            .map(doctor -> new GrantView(doctor.id(), doctor.email())).toList();
    }

    @Transactional
    @PostMapping("/reports/{id}/grants")
    public GrantView grant(@PathVariable long id, @RequestBody GrantRequest request, Principal principal) {
        requireOwner(id, current(principal));
        if (request.doctorEmail() == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Doctor email is required");
        UserStore.User doctor = users.findByEmail(request.doctorEmail().trim().toLowerCase(java.util.Locale.ROOT))
            .filter(user -> user.role().equals("DOCTOR"))
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Doctor not found"));
        reports.grant(id, doctor.id());
        return new GrantView(doctor.id(), doctor.email());
    }

    @Transactional
    @DeleteMapping("/reports/{id}/grants/{doctorId}")
    public void revoke(@PathVariable long id, @PathVariable long doctorId, Principal principal) {
        requireOwner(id, current(principal));
        reports.revoke(id, doctorId);
    }

    private void requireOwner(long id, UserStore.User user) {
        if (!user.role().equals("USER") || reports.findById(id).filter(report -> report.userId() == user.id()).isEmpty())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    private UserStore.User current(Principal principal) {
        return users.findByEmail(principal.getName()).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }

    private ReportView view(ReportStore.Report report) {
        try {
            return new ReportView(report.id(), report.userId(), report.ruleVersion(), mapper.readTree(report.content()), report.createdAt());
        } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
            throw new IllegalStateException("Stored report is invalid", exception);
        }
    }
}
