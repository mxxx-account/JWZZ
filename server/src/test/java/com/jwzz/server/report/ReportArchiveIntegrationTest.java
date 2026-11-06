package com.jwzz.server.report;

import static org.junit.jupiter.api.Assertions.*;
import java.util.UUID;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import com.jwzz.server.auth.UserStore;

/** Opt-in real-MySQL test for owner isolation, filtering, ordering and pagination. */
class ReportArchiveIntegrationTest {
    @Test void archiveKeepsOldReportsFindableWithoutLoadingEveryFullSnapshot() {
        String url = System.getenv("JWZZ_IT_DB_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Set JWZZ_IT_DB_URL to run real-MySQL archive tests");
        var source = new DriverManagerDataSource(url, System.getenv("DB_USER"), System.getenv("DB_PASSWORD"));
        var jdbc = new JdbcTemplate(source);
        var users = new UserStore(jdbc);
        var reports = new ReportStore(jdbc);
        String suffix = UUID.randomUUID().toString();
        String ownerEmail = "archive-owner-" + suffix + "@example.invalid";
        String otherEmail = "archive-other-" + suffix + "@example.invalid";
        long owner = 0, other = 0;
        try {
            users.create(ownerEmail, "test-hash", "USER");
            users.create(otherEmail, "test-hash", "USER");
            owner = users.findByEmail(ownerEmail).orElseThrow().id();
            other = users.findByEmail(otherEmail).orElseThrow().id();
            long oldest = reports.saveGenerated(owner, UUID.randomUUID().toString(), "test", "{\"title\":\"old\",\"category\":\"BP\"}").id();
            long middle = reports.saveGenerated(owner, UUID.randomUUID().toString(), "test", "{\"title\":\"middle\",\"category\":\"GLUCOSE\"}").id();
            long newest = reports.saveGenerated(owner, UUID.randomUUID().toString(), "test", "{\"title\":\"new\",\"category\":\"BP\"}").id();
            reports.saveGenerated(other, UUID.randomUUID().toString(), "test", "{\"title\":\"private\",\"category\":\"LIPID\"}");

            var firstPage = reports.archive(owner, null, null, null, null, true, 0, 2);
            assertEquals(3, firstPage.total());
            assertEquals(2, firstPage.items().size());
            assertEquals(oldest, firstPage.items().get(0).id());
            assertEquals(middle, firstPage.items().get(1).id());
            assertEquals(newest, reports.archive(owner, null, null, null, null, true, 1, 2).items().get(0).id());
            assertEquals(newest, reports.archive(owner, null, null, null, null, false, 0, 1).items().get(0).id());
            assertEquals(2, reports.archive(owner, "BP", null, null, null, false, 0, 12).total());
            assertEquals(oldest, reports.archive(owner, null, null, null, oldest, false, 0, 12).items().get(0).id());
            assertEquals(0, reports.archive(owner, "LIPID", null, null, null, false, 0, 12).total());
            assertEquals(2, reports.latestByCategory(owner).size());
        } finally {
            if (owner > 0) jdbc.update("DELETE FROM assessment_report WHERE user_id=?", owner);
            if (other > 0) jdbc.update("DELETE FROM assessment_report WHERE user_id=?", other);
            if (owner > 0) jdbc.update("DELETE FROM app_user WHERE id=?", owner);
            if (other > 0) jdbc.update("DELETE FROM app_user WHERE id=?", other);
        }
    }
}
