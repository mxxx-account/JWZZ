package com.jwzz.server.auth;

import java.security.Principal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class DoctorDirectoryController {
    private final DoctorDirectoryStore doctors;
    private final UserStore users;
    public DoctorDirectoryController(DoctorDirectoryStore doctors, UserStore users) {
        this.doctors = doctors; this.users = users;
    }

    @GetMapping("/doctors")
    public List<DoctorDirectoryStore.Doctor> list() { return doctors.list(); }

    @PostMapping("/doctor/presence")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void heartbeat(Principal principal) {
        var doctor = users.findByEmail(principal.getName())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        doctors.heartbeat(doctor.id());
    }
}
