package com.jwzz.server.report;

import com.jwzz.server.auth.UserStore;
import java.security.Principal;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Profile("dev")
@RestController
@RequestMapping("/api/dev")
public class DemoReportController {
    private final UserStore users;
    private final ReportStore reports;
    public DemoReportController(UserStore users, ReportStore reports) { this.users = users; this.reports = reports; }
    @PostMapping("/reports")
    public Map<String, Long> create(Principal principal) {
        long userId = users.findByEmail(principal.getName()).orElseThrow().id();
        return Map.of("id", reports.createDemo(userId));
    }
}
