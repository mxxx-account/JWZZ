package com.jwzz.server.consultation;

import static org.junit.jupiter.api.Assertions.*;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import com.jwzz.server.auth.UserStore;
import com.jwzz.server.report.ReportStore;

/** Opt-in real-MySQL test; executes only when JWZZ_IT_DB_URL is explicitly set. */
class MessageTransactionIntegrationTest {
    @Test void messageInsertFailureRollsBackConsultationAndSuccessCommitsBoth() {
        String url = System.getenv("JWZZ_IT_DB_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Set JWZZ_IT_DB_URL to run real-MySQL transaction tests");
        var source = new DriverManagerDataSource(url, System.getenv("DB_USER"), System.getenv("DB_PASSWORD"));
        var jdbc = new JdbcTemplate(source);
        var users = new UserStore(jdbc);
        var reports = new ReportStore(jdbc);
        var consultations = new ConsultationStore(jdbc);
        var messages = new MessageStore(jdbc);
        var tx = new TransactionTemplate(new DataSourceTransactionManager(source));
        String suffix = UUID.randomUUID().toString();
        String patientEmail = "it-patient-" + suffix + "@example.invalid";
        String doctorEmail = "it-doctor-" + suffix + "@example.invalid";
        long userId = 0, doctorId = 0, reportId = 0;
        var attemptedId = new AtomicLong();
        var committedId = new AtomicLong();
        try {
            users.create(patientEmail, "not-a-login-hash", "USER");
            users.create(doctorEmail, "not-a-login-hash", "DOCTOR");
            userId = users.findByEmail(patientEmail).orElseThrow().id();
            doctorId = users.findByEmail(doctorEmail).orElseThrow().id();
            reportId = reports.saveGenerated(userId, UUID.randomUUID().toString(), "test", "{}").id();
            long finalUserId = userId, finalDoctorId = doctorId, finalReportId = reportId;

            assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(status -> {
                var created = consultations.create(finalReportId, finalUserId, finalDoctorId, "transaction rollback test");
                attemptedId.set(created.id());
                messages.add(created.id(), -1, "invalid sender must fail foreign key");
            }));
            assertTrue(consultations.find(attemptedId.get()).isEmpty(), "consultation must roll back with its first message");

            tx.executeWithoutResult(status -> {
                var created = consultations.create(finalReportId, finalUserId, finalDoctorId, "transaction commit test");
                committedId.set(created.id());
                messages.add(created.id(), finalUserId, "first message");
            });
            assertTrue(consultations.find(committedId.get()).isPresent());
            assertEquals(1, messages.forConversation(committedId.get()).size());
        } finally {
            if (committedId.get() > 0) {
                jdbc.update("DELETE FROM consultation_message WHERE consultation_id=?", committedId.get());
                jdbc.update("DELETE FROM consultation_request WHERE id=? AND report_id=? AND user_id=?",
                    committedId.get(), reportId, userId);
            }
            if (reportId > 0) jdbc.update("DELETE FROM assessment_report WHERE id=? AND user_id=?", reportId, userId);
            if (doctorId > 0) jdbc.update("DELETE FROM app_user WHERE id=? AND email=? AND role='DOCTOR'", doctorId, doctorEmail);
            if (userId > 0) jdbc.update("DELETE FROM app_user WHERE id=? AND email=? AND role='USER'", userId, patientEmail);
        }
    }
}
