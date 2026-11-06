package com.jwzz.server.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.transaction.annotation.Transactional;
import java.security.Principal;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    public record RegisterRequest(@Email @NotBlank String email, @NotBlank @Size(max = 80) String name,
                                  @NotBlank @Size(min = 12, max = 128) String password, @NotBlank String role, String specialty) {}
    public record CurrentUser(long id, String email, String role, String name) {}

    private final UserStore users;
    private final PasswordEncoder encoder;
    private final DoctorDirectoryStore doctors;
    private final boolean doctorSelfRegistrationEnabled;

    public AuthController(UserStore users, PasswordEncoder encoder, DoctorDirectoryStore doctors,
                          @Value("${app.doctor-self-registration-enabled:false}") boolean doctorSelfRegistrationEnabled) {
        this.users = users;
        this.encoder = encoder;
        this.doctors = doctors;
        this.doctorSelfRegistrationEnabled = doctorSelfRegistrationEnabled;
    }

    @GetMapping("/csrf")
    public Map<String, String> csrf(HttpServletRequest request) {
        CsrfToken token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        return Map.of("token", token.getToken());
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public CurrentUser register(@Valid @RequestBody RegisterRequest request) {
        String email = request.email().trim().toLowerCase(java.util.Locale.ROOT);
        String name = request.name().trim();
        if (name.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Name is required");
        String role = request.role().trim().toUpperCase(java.util.Locale.ROOT);
        if (!role.equals("USER") && !role.equals("DOCTOR")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid role");
        if (role.equals("DOCTOR")) {
            if (!doctorSelfRegistrationEnabled) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Doctor registration is disabled");
            if (request.specialty() == null || !java.util.Set.of("GENERAL", "CARDIOLOGY", "ENDOCRINOLOGY").contains(request.specialty()))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select a specialty");
        }
        try {
            users.create(email, encoder.encode(request.password()), role, name);
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email already registered");
        }
        var user = users.findByEmail(email).orElseThrow();
        if (role.equals("DOCTOR")) doctors.upsert(user.id(), name, request.specialty());
        return toCurrentUser(user);
    }

    @GetMapping("/me")
    public CurrentUser me(Principal principal) {
        return toCurrentUser(users.findByEmail(principal.getName()).orElseThrow());
    }

    private CurrentUser toCurrentUser(UserStore.User user) {
        return new CurrentUser(user.id(), user.email(), user.role(), user.displayName());
    }
}
