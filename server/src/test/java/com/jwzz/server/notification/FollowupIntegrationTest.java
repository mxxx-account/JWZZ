package com.jwzz.server.notification;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jwzz.server.consultation.*;
import com.jwzz.server.common.RequestRateLimiter;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class FollowupIntegrationTest {
    static class Fixture extends NotificationIntegrationTest.Fixture {
        final FollowupService service=service(outbox);
        final com.jwzz.server.auth.UserStore.User patientUser=users.findById(patient).orElseThrow(),doctorUser=users.findById(doctor).orElseThrow();
        final List<Long> extraReports=new ArrayList<>();
        FollowupService service(NotificationOutbox source) {return new FollowupService(db,chats,reports,source,new ObjectMapper().findAndRegisterModules());}
        long claimed() {long id=consultation();assertTrue(chats.claim(id,doctor));return id;}
        FollowupService.CloseRequest request() {return new FollowupService.CloseRequest("虚构沟通记录，请整理测量条件。",List.of(new FollowupService.Proposal("整理一份新记录",null)));}
        FollowupService.Detail close(long id) {return tx.execute(s->service.close(id,request(),doctorUser));}
        Instant future() {return Instant.now().plusSeconds(3600).truncatedTo(ChronoUnit.MILLIS);}
        long report(long owner) {long id=reports.saveGenerated(owner,UUID.randomUUID().toString(),"test","{}").id();extraReports.add(id);return id;}
        public void close() {
            db.update("DELETE t FROM followup_task t JOIN consultation_request c ON c.id=t.consultation_id WHERE c.report_id=?",report);
            db.update("DELETE x FROM consultation_closure x JOIN consultation_request c ON c.id=x.consultation_id WHERE c.report_id=?",report);
            for(long id:extraReports) {db.update("DELETE FROM report_access_grant WHERE report_id=?",id);db.update("DELETE FROM assessment_report WHERE id=?",id);}
            super.close();
        }
    }
    @Test void closingIsIdempotentAndReadOnlyAndAccessControlled() throws Exception {
        try(var f=new Fixture()) {
            long id=f.claimed();var pool=Executors.newFixedThreadPool(4);
            try {var jobs=new ArrayList<Future<?>>();for(int i=0;i<4;i++)jobs.add(pool.submit(()->f.close(id)));for(var job:jobs)job.get(15,TimeUnit.SECONDS);}
            finally {pool.shutdownNow();}
            assertEquals(1,f.db.queryForObject("SELECT COUNT(*) FROM consultation_closure WHERE consultation_id=?",Integer.class,id));
            assertEquals(1,f.service.detail(id,f.patientUser).tasks().size());
            assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.close(id,new FollowupService.CloseRequest("不同内容",List.of()),f.doctorUser)));
            assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.close(id,f.request(),f.patientUser)));
            var message=new MessageController(f.users,f.doctors,f.chats,f.messages,f.reports,new RequestRateLimiter(null,false),f.outbox);
            for(var actor:List.of(f.doctorUser,f.patientUser)) {
                assertFalse(message.conversation(id,()->actor.email(),null,null,50).conversation().canSend());
                assertThrows(ResponseStatusException.class,()->f.tx.execute(s->message.send(id,new MessageController.SendRequest("after-close",UUID.randomUUID().toString()),()->actor.email())));
            }
            assertEquals("CLOSED",f.chats.find(id).orElseThrow().status());
            assertEquals(1,f.service.page(f.doctorUser,null,20).items().size());
            f.reports.revoke(f.report,f.doctor);
            assertThrows(ResponseStatusException.class,()->f.service.detail(id,f.doctorUser));
            assertTrue(f.service.page(f.doctorUser,null,20).items().isEmpty());
            assertNotNull(f.service.detail(id,f.patientUser).summary());
            assertThrows(ResponseStatusException.class,()->f.service.detail(id,f.users.findById(f.merchant).orElseThrow()));
        }
    }
    @Test void closingRollbackIncludesTasksAndOutbox() {
        try(var f=new Fixture()) {
            long id=f.claimed();var failing=f.service(new NotificationOutbox(f.db){
                @Override public void enqueue(String key,Type type,long owner,long resource) {super.enqueue(key,type,owner,resource);throw new IllegalStateException("injected");}
            });
            assertThrows(IllegalStateException.class,()->f.tx.execute(s->failing.close(id,f.request(),f.doctorUser)));
            assertEquals("CLAIMED",f.chats.find(id).orElseThrow().status());
            assertTrue(f.service.detail(id,f.patientUser).tasks().isEmpty());assertNull(f.service.detail(id,f.patientUser).summary());
            assertEquals(0,f.db.queryForObject("SELECT COUNT(*) FROM notification_outbox WHERE event_type='CONSULTATION_CLOSED' AND resource_id=?",Integer.class,id));
        }
    }
    @Test void remindersRequireConfirmationDeduplicateAndCancelOrComplete() throws Exception {
        try(var f=new Fixture()) {
            long id=f.claimed(),task=f.close(id).tasks().get(0).id();
            f.db.update("UPDATE followup_task SET due_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?",task);
            f.tx.execute(s->f.service.dispatchDue());
            assertEquals("PROPOSED",f.service.detail(id,f.patientUser).tasks().get(0).status());
            Instant due=f.future();f.tx.execute(s->f.service.change(id,task,"confirm",due,null,f.patientUser));
            f.tx.execute(s->f.service.change(id,task,"confirm",due,null,f.patientUser));
            f.db.update("UPDATE followup_task SET due_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?",task);
            var pool=Executors.newFixedThreadPool(6);
            try {var jobs=new ArrayList<Future<?>>();for(int i=0;i<6;i++)jobs.add(pool.submit(()->f.tx.execute(s->f.service.dispatchDue())));for(var job:jobs)job.get(15,TimeUnit.SECONDS);}
            finally {pool.shutdownNow();}
            assertEquals(1,f.db.queryForObject("SELECT COUNT(*) FROM notification_outbox WHERE event_type='RECORD_REMINDER_DUE' AND resource_id=?",Integer.class,task));
            f.drain();assertTrue(f.inbox.page(f.patient,null,20,false).items().stream().anyMatch(n->n.type().equals("RECORD_REMINDER_DUE")));
            f.tx.execute(s->f.service.change(id,task,"cancel",null,null,f.patientUser));f.tx.execute(s->f.service.change(id,task,"cancel",null,null,f.patientUser));
            assertFalse(f.inbox.page(f.patient,null,20,false).items().stream().anyMatch(n->n.type().equals("RECORD_REMINDER_DUE")));
            assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.change(id,task,"complete",null,null,f.patientUser)));
            var req=new FollowupService.AddRequest("我自己的提醒",due,UUID.randomUUID().toString());
            f.tx.execute(s->f.service.add(id,req,f.patientUser));f.tx.execute(s->f.service.add(id,req,f.patientUser));
            assertEquals(2,f.service.detail(id,f.patientUser).tasks().size());
            assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.add(id,new FollowupService.AddRequest("past",Instant.now().minusSeconds(10),UUID.randomUUID().toString()),f.patientUser)));
        }
    }
    @Test void linkedReportsNeedIndependentGrantsAndCannotCrossUsers() {
        try(var f=new Fixture()) {
            long id=f.claimed(),task=f.close(id).tasks().get(0).id();
            f.tx.execute(s->f.service.change(id,task,"confirm",f.future(),null,f.patientUser));
            f.users.create("other"+f.suffix+"@example.invalid","not-a-login-hash","USER");
            long other=f.users.findByEmail("other"+f.suffix+"@example.invalid").orElseThrow().id();f.accounts.add(other);
            long foreign=f.report(other),own=f.report(f.patient);
            assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.change(id,task,"complete",null,foreign,f.patientUser)));
            assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.change(id,task,"complete",null,f.report,f.patientUser)));
            f.tx.execute(s->f.service.change(id,task,"complete",null,own,f.patientUser));f.tx.execute(s->f.service.change(id,task,"complete",null,own,f.patientUser));
            assertTrue(f.service.detail(id,f.doctorUser).tasks().get(0).reportHidden());assertFalse(f.reports.activeGrant(own,f.doctor));
            f.reports.grant(own,f.doctor);assertEquals(own,f.service.detail(id,f.doctorUser).tasks().get(0).reportId());
            f.reports.revoke(own,f.doctor);assertNull(f.service.detail(id,f.doctorUser).tasks().get(0).reportId());
            assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.change(id,task,"cancel",null,null,f.patientUser)));
            assertThrows(ResponseStatusException.class,()->f.service.detail(id,f.users.findById(other).orElseThrow()));
        }
    }
    @Test void sendAndCloseRaceCannotReopenConsultationAndCancelRacesDue() throws Exception {
        try(var f=new Fixture()) {
            long id=f.claimed();var pool=Executors.newFixedThreadPool(2);
            try {
                var message=new MessageController(f.users,f.doctors,f.chats,f.messages,f.reports,new RequestRateLimiter(null,false),f.outbox);
                var start=new CountDownLatch(1);
                var send=pool.submit(()->{start.await();try{f.tx.execute(s->message.send(id,new MessageController.SendRequest("race",UUID.randomUUID().toString()),()->f.doctorUser.email()));}catch(ResponseStatusException ex){assertEquals(409,ex.getStatusCode().value());}return null;});
                var close=pool.submit(()->{start.await();return f.close(id);});start.countDown();send.get(15,TimeUnit.SECONDS);close.get(15,TimeUnit.SECONDS);
                assertEquals("CLOSED",f.chats.find(id).orElseThrow().status());
                long task=f.service.detail(id,f.patientUser).tasks().get(0).id();f.tx.execute(s->f.service.change(id,task,"confirm",f.future(),null,f.patientUser));
                f.db.update("UPDATE followup_task SET due_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?",task);
                var a=pool.submit(()->f.tx.execute(s->f.service.dispatchDue()));var b=pool.submit(()->f.tx.execute(s->f.service.change(id,task,"cancel",null,null,f.patientUser)));a.get(15,TimeUnit.SECONDS);b.get(15,TimeUnit.SECONDS);
                f.drain();assertEquals("CANCELLED",f.service.detail(id,f.patientUser).tasks().get(0).status());
                assertFalse(f.inbox.page(f.patient,null,20,false).items().stream().anyMatch(n->n.type().equals("RECORD_REMINDER_DUE")));
            } finally {pool.shutdownNow();}
        }
    }

    @Test void staleAuthenticationSnapshotCannotSendAfterClosure() throws Exception {
        try(var f=new Fixture()) {
            var message=new MessageController(f.users,f.doctors,f.chats,f.messages,f.reports,new RequestRateLimiter(null,false),f.outbox);
            var pool=Executors.newSingleThreadExecutor();
            try {
                for(var actor:List.of(f.doctorUser,f.patientUser)) {
                    long id=f.claimed();var snapshot=new CountDownLatch(1);var closed=new CountDownLatch(1);
                    var send=pool.submit(()->f.tx.execute(s->{
                        f.users.findById(actor.id()); // establish the old repeatable-read snapshot deliberately
                        snapshot.countDown();
                        try {assertTrue(closed.await(10,TimeUnit.SECONDS));} catch(InterruptedException ex) {throw new IllegalStateException(ex);}
                        var error=assertThrows(ResponseStatusException.class,()->message.send(id,new MessageController.SendRequest("stale-snapshot",UUID.randomUUID().toString()),()->actor.email()));
                        assertEquals(409,error.getStatusCode().value());return null;
                    }));
                    assertTrue(snapshot.await(10,TimeUnit.SECONDS));try {f.close(id);} finally {closed.countDown();}
                    send.get(15,TimeUnit.SECONDS);assertEquals("CLOSED",f.chats.find(id).orElseThrow().status());
                    assertEquals(1,f.messages.forConversation(id).size());
                }
            } finally {pool.shutdownNow();}
        }
    }
}
