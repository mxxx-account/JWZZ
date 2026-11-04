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
    CommandLineRunner seedDoctor(UserStore users, PasswordEncoder encoder,
            @Value("${demo.doctor.email:}") String email,
            @Value("${demo.doctor.password:}") String password) {
        return args -> {
            if (!email.isBlank() && !password.isBlank() && users.findByEmail(email).isEmpty())
                users.create(email.toLowerCase(java.util.Locale.ROOT), encoder.encode(password), "DOCTOR");
        };
    }
}
