package com.jwzz.server.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
@Profile("dev")
public class DevDoctorSeeder {
    @Bean
    CommandLineRunner seedDoctor(UserStore users, DoctorDirectoryStore directory, PasswordEncoder encoder,
            @Value("${demo.doctor.email:}") String email,
            @Value("${demo.doctor.password:}") String password) {
        return args -> {
            if (email.isBlank() || password.isBlank()) return;
            seed(users, directory, encoder, email, password, "全科演示医生", "GENERAL");
            seed(users, directory, encoder, "doctor.cardiology@jwzz.local", password,
                "心血管演示医生", "CARDIOLOGY");
            seed(users, directory, encoder, "doctor.endocrinology@jwzz.local", password,
                "内分泌演示医生", "ENDOCRINOLOGY");
        };
    }

    private void seed(UserStore users, DoctorDirectoryStore directory, PasswordEncoder encoder,
                      String email, String password, String displayName, String specialty) {
        String normalized = email.toLowerCase(java.util.Locale.ROOT);
        if (users.findByEmail(normalized).isEmpty()) users.create(normalized, encoder.encode(password), "DOCTOR");
        users.findByEmail(normalized).filter(user -> user.role().equals("DOCTOR"))
            .ifPresent(user -> directory.upsert(user.id(), displayName, specialty));
    }
}
