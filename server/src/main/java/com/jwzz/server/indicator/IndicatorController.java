package com.jwzz.server.indicator;

import com.jwzz.server.auth.UserStore;
import java.security.Principal;
import java.util.List;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/indicators")
public class IndicatorController {
    public record EntryResponse(String entryId, List<IndicatorService.NormalizedValue> values,
                                String rulesStatus, List<DraftRuleEngine.Interpretation> draftInterpretations) {}
    private final UserStore users;
    private final IndicatorService service;
    private final IndicatorStore store;
    private final DraftRuleEngine rules;
    private final Environment environment;
    public IndicatorController(UserStore users, IndicatorService service, IndicatorStore store,
                               DraftRuleEngine rules, Environment environment) {
        this.users = users; this.service = service; this.store = store; this.rules = rules; this.environment = environment;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public EntryResponse create(@RequestBody IndicatorService.EntryRequest request, Principal principal) {
        var prepared = service.prepare(request);
        store.save(users.findByEmail(principal.getName()).orElseThrow().id(), prepared);
        boolean dev = environment.acceptsProfiles(Profiles.of("dev"));
        return new EntryResponse(prepared.entryId(), prepared.values(), "AWAITING_CLINICAL_REVIEW",
            dev ? rules.evaluate(prepared) : List.of());
    }

    @GetMapping
    public List<IndicatorStore.StoredValue> list(Principal principal) {
        return store.latest(users.findByEmail(principal.getName()).orElseThrow().id());
    }

    @GetMapping("/trends")
    public List<IndicatorStore.StoredValue> trend(@RequestParam String code, @RequestParam String context, Principal principal) {
        service.validateTrendFilter(code, context);
        return store.trend(users.findByEmail(principal.getName()).orElseThrow().id(), code, context);
    }
}
