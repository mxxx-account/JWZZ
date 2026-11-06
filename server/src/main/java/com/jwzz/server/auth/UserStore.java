package com.jwzz.server.auth;

import java.util.List;
import java.util.Optional;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class UserStore {
    public record User(long id, String email, String passwordHash, String role, String displayName) {}

    private final JdbcTemplate jdbc;

    public UserStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Optional<User> findByEmail(String email) {
        List<User> users = jdbc.query(
            "SELECT id, email, password_hash, role, display_name FROM app_user WHERE email = ?",
            (rs, row) -> new User(rs.getLong("id"), rs.getString("email"), rs.getString("password_hash"), rs.getString("role"), rs.getString("display_name")),
            email
        );
        return users.stream().findFirst();
    }

    public Optional<User> findById(long id) {
        List<User> users = jdbc.query(
            "SELECT id, email, password_hash, role, display_name FROM app_user WHERE id = ?",
            (rs, row) -> new User(rs.getLong("id"), rs.getString("email"), rs.getString("password_hash"), rs.getString("role"), rs.getString("display_name")),
            id
        );
        return users.stream().findFirst();
    }

    public void create(String email, String passwordHash, String role) throws DuplicateKeyException {
        create(email, passwordHash, role, "");
    }

    public void create(String email, String passwordHash, String role, String displayName) throws DuplicateKeyException {
        jdbc.update("INSERT INTO app_user (email, password_hash, role, display_name) VALUES (?, ?, ?, ?)", email, passwordHash, role, displayName);
    }

    public void setNameIfBlank(long id, String displayName) {
        jdbc.update("UPDATE app_user SET display_name=? WHERE id=? AND display_name=''", displayName, id);
    }
}
