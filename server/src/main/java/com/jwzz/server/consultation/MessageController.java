package com.jwzz.server.consultation;

import com.jwzz.server.auth.DoctorDirectoryStore;
import com.jwzz.server.auth.UserStore;
import com.jwzz.server.common.RequestRateLimiter;
import com.jwzz.server.report.ReportStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.security.Principal;
import java.time.LocalDateTime;
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
@RequestMapping("/api/messages")
public class MessageController {
    public record SendRequest(@NotBlank @Size(max = 2000) String body) {}
    public record Summary(long id, long reportId, long peerId, String peerName, String peerSpecialty,
                          boolean peerOnline, String status, String lastMessage, LocalDateTime updatedAt,
                          int unreadCount, boolean canSend) {}
    public record Detail(Summary conversation, List<MessageStore.Message> messages) {}

    private final UserStore users;
    private final DoctorDirectoryStore doctors;
    private final ConsultationStore consultations;
    private final MessageStore messages;
    private final ReportStore reports;
    private final RequestRateLimiter limiter;
    public MessageController(UserStore users, DoctorDirectoryStore doctors, ConsultationStore consultations,
                             MessageStore messages, ReportStore reports, RequestRateLimiter limiter) {
        this.users = users; this.doctors = doctors; this.consultations = consultations;
        this.messages = messages; this.reports = reports; this.limiter = limiter;
    }

    @GetMapping("/conversations")
    public List<Summary> conversations(Principal principal) {
        var user = current(principal);
        boolean doctor = user.role().equals("DOCTOR");
        var list = doctor ? consultations.forDoctor(user.id()) : consultations.forUser(user.id());
        return list.stream().filter(item -> !doctor || (item.claimedDoctorId() != null && item.claimedDoctorId() == user.id()))
            .map(item -> summary(item, user, doctor)).toList();
    }

    @GetMapping("/conversations/{id}")
    public Detail conversation(@PathVariable long id, Principal principal) {
        var user = current(principal);
        boolean doctor = user.role().equals("DOCTOR");
        var item = accessible(id, user, doctor);
        return new Detail(summary(item, user, doctor), messages.forConversation(id));
    }

    @Transactional
    @PostMapping("/conversations/{id}")
    @ResponseStatus(HttpStatus.CREATED)
    public MessageStore.Message send(@PathVariable long id, @Valid @RequestBody SendRequest request,
                                     Principal principal) {
        String body = request.body().trim();
        if (body.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Message is empty");
        var user = current(principal);
        boolean doctor = user.role().equals("DOCTOR");
        var item = accessible(id, user, doctor);
        if (doctor) {
            if (item.claimedDoctorId() == null || item.claimedDoctorId() != user.id())
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Claim this consultation first");
            limiter.check("message-doctor", user.id(), 60);
            consultations.updateLatestDoctorAnswer(id, user.id(), body);
        } else {
            if (!patientCanSend(item)) throw new ResponseStatusException(HttpStatus.CONFLICT, "Doctor access was revoked");
            limiter.check("message-user", user.id(), 30);
        }
        return messages.add(id, user.id(), body);
    }

    @PostMapping("/conversations/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@PathVariable long id, Principal principal) {
        var user = current(principal);
        boolean doctor = user.role().equals("DOCTOR");
        accessible(id, user, doctor);
        messages.markRead(id, doctor);
    }

    private Summary summary(ConsultationStore.Consultation item, UserStore.User user, boolean doctor) {
        var latest = messages.latest(item.id());
        if (doctor) {
            String peerName = users.findById(item.userId()).map(UserStore.User::email).orElse("用户");
            return new Summary(item.id(), item.reportId(), item.userId(), peerName, "用户", false,
                item.status(), latest.map(MessageStore.Message::body).orElse(item.question()),
                latest.map(MessageStore.Message::createdAt).orElse(item.createdAt()),
                messages.unread(item.id(), user.id(), true),
                item.claimedDoctorId() != null && item.claimedDoctorId() == user.id());
        }
        Long peerId = item.targetDoctorId() != null ? item.targetDoctorId() : item.claimedDoctorId();
        var peer = peerId == null ? null : doctors.find(peerId).orElse(null);
        return new Summary(item.id(), item.reportId(), peerId == null ? 0L : peerId,
            peer == null ? "待分配医生" : peer.displayName(), peer == null ? "" : peer.specialty(),
            peer != null && peer.online(), item.status(),
            latest.map(MessageStore.Message::body).orElse(item.question()),
            latest.map(MessageStore.Message::createdAt).orElse(item.createdAt()),
            messages.unread(item.id(), user.id(), false), patientCanSend(item));
    }

    private boolean patientCanSend(ConsultationStore.Consultation item) {
        return item.targetDoctorId() == null ? !reports.activeDoctorIds(item.reportId()).isEmpty()
            : reports.activeGrant(item.reportId(), item.targetDoctorId());
    }

    private ConsultationStore.Consultation accessible(long id, UserStore.User user, boolean doctor) {
        if (doctor) return consultations.findForDoctor(id, user.id())
            .filter(item -> item.claimedDoctorId() != null && item.claimedDoctorId() == user.id())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        return consultations.find(id).filter(item -> item.userId() == user.id())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    private UserStore.User current(Principal principal) {
        return users.findByEmail(principal.getName())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }
}
