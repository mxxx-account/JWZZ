package com.jwzz.server.auth;

import java.util.List;
import java.util.Optional;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class UserStore {
    public record User(long id, String email, String passwordHash, String role) {}

    private final JdbcTemplate jdbc;

    public UserStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Optional<User> findByEmail(String email) {
        List<User> users = jdbc.query(
            "SELECT id, email, password_hash, role FROM app_user WHERE email = ?",
            (rs, row) -> new User(rs.getLong("id"), rs.getString("email"), rs.getString("password_hash"), rs.getString("role")),
            email
        );
        return users.stream().findFirst();
    }

    public Optional<User> findById(long id) {
        List<User> users = jdbc.query(
            "SELECT id, email, password_hash, role FROM app_user WHERE id = ?",
            (rs, row) -> new User(rs.getLong("id"), rs.getString("email"), rs.getString("password_hash"), rs.getString("role")),
            id
        );
        return users.stream().findFirst();
    }

    public void create(String email, String passwordHash, String role) throws DuplicateKeyException {
        jdbc.update("INSERT INTO app_user (email, password_hash, role) VALUES (?, ?, ?)", email, passwordHash, role);
    }
}
