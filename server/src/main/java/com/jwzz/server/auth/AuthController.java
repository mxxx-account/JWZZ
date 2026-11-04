package com.jwzz.server.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
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
    public record RegisterRequest(@Email @NotBlank String email, @Size(min = 12, max = 128) String password) {}
    public record CurrentUser(long id, String email, String role) {}

    private final UserStore users;
    private final PasswordEncoder encoder;

    public AuthController(UserStore users, PasswordEncoder encoder) {
        this.users = users;
        this.encoder = encoder;
    }

    @GetMapping("/csrf")
    public Map<String, String> csrf(HttpServletRequest request) {
        CsrfToken token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        return Map.of("token", token.getToken());
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public CurrentUser register(@Valid @RequestBody RegisterRequest request) {
        String email = request.email().trim().toLowerCase(java.util.Locale.ROOT);
        try {
            users.create(email, encoder.encode(request.password()), "USER");
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email already registered");
        }
        return toCurrentUser(users.findByEmail(email).orElseThrow());
    }

    @GetMapping("/me")
    public CurrentUser me(Principal principal) {
        return toCurrentUser(users.findByEmail(principal.getName()).orElseThrow());
    }

    private CurrentUser toCurrentUser(UserStore.User user) {
        return new CurrentUser(user.id(), user.email(), user.role());
    }
}
