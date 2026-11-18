package com.jwzz.server.consultation;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name="app.followups.dispatch-enabled",havingValue="true",matchIfMissing=true)
public class FollowupJob {
    private final FollowupService service;
    public FollowupJob(FollowupService service) {this.service=service;}
    @Scheduled(fixedDelayString="${app.followups.poll-ms:5000}",initialDelay=5000)
    public void run() {for(int i=0;i<50 && service.dispatchDue();i++) { /* bounded scan; per-item transaction */ }}
}
