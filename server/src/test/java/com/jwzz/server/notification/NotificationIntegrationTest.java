package com.jwzz.server.notification;

import static org.junit.jupiter.api.Assertions.*;
import com.jwzz.server.auth.*;
import com.jwzz.server.common.RequestRateLimiter;
import com.jwzz.server.consultation.*;
import com.jwzz.server.merchant.*;
import com.jwzz.server.report.ReportStore;
import com.jwzz.server.shop.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

class NotificationIntegrationTest {
    static class Fixture implements AutoCloseable {
        final DriverManagerDataSource ds;
        final JdbcTemplate db;
        final TransactionTemplate tx;
        final UserStore users;
        final ReportStore reports;
        final ConsultationStore chats;
        final MessageStore messages;
        final DoctorDirectoryStore doctors;
        final NotificationOutbox outbox;
        final NotificationStore inbox;
        final String suffix=UUID.randomUUID().toString();
        final List<Long> accounts=new ArrayList<>();
        final long patient,doctor,merchant,report;
        long store;
        Fixture() {
            String url=System.getenv("JWZZ_IT_DB_URL");
            Assumptions.assumeTrue(url!=null && !url.isBlank());
            assertTrue(url.matches("jdbc:mysql://(localhost|127\\.0\\.0\\.1)(:|/).*"),"Local development/test DB only");
            ds=new DriverManagerDataSource(url,System.getenv("DB_USER"),System.getenv("DB_PASSWORD"));
            db=new JdbcTemplate(ds); tx=new TransactionTemplate(new DataSourceTransactionManager(ds));
            users=new UserStore(db); reports=new ReportStore(db); chats=new ConsultationStore(db);
            messages=new MessageStore(db); doctors=new DoctorDirectoryStore(db);
            outbox=new NotificationOutbox(db); inbox=new NotificationStore(db);
            patient=user("USER"); doctor=user("DOCTOR"); merchant=user("MERCHANT");
            report=reports.saveGenerated(patient,suffix,"test","{}").id();
            reports.grant(report,doctor); doctors.upsert(doctor,"通知测试医生","GENERAL");
        }
        long user(String role) {
            String email=role+suffix+"@example.invalid"; users.create(email,"not-a-login-hash",role);
            long id=users.findByEmail(email).orElseThrow().id(); accounts.add(id); return id;
        }
        ConsultationController controller(NotificationOutbox events) { return new ConsultationController(users,reports,chats,messages,doctors,new RequestRateLimiter(null,false),events); }
        long consultation() { return tx.execute(s->controller(outbox).create(new ConsultationController.CreateRequest(report,doctor,"private-test-content"),()->"USER"+suffix+"@example.invalid").id()); }
        long count(String table) { return db.queryForObject("SELECT COUNT(*) FROM "+table+" WHERE recipient_id IN (?,?,?)",Long.class,patient,doctor,merchant); }
        NotificationDispatcher worker(NotificationStore target) { return new NotificationDispatcher(ds,outbox,target); }
        void drain() { for(int i=0;i<300 && worker(inbox).dispatchOne();i++) {} }
        public void close() {
            for(long id:accounts) { db.update("DELETE FROM user_notification WHERE recipient_id=?",id); db.update("DELETE FROM notification_outbox WHERE recipient_id=?",id); }
            db.update("DELETE m FROM consultation_message m JOIN consultation_request c ON c.id=m.consultation_id WHERE c.report_id=?",report);
            db.update("DELETE FROM consultation_request WHERE report_id=?",report);
            db.update("DELETE FROM report_access_grant WHERE report_id=?",report);
            db.update("DELETE FROM assessment_report WHERE id=?",report);
            db.update("DELETE FROM doctor_profile WHERE doctor_id=?",doctor);
            if(store>0) {
                db.update("DELETE FROM shopping_cart_item WHERE user_id=?",patient);
                db.update("DELETE i FROM shop_order_item i JOIN shop_order o ON o.id=i.order_id WHERE o.store_id=?",store);
                db.update("DELETE FROM shop_order WHERE store_id=?",store);
                db.update("DELETE l FROM inventory_ledger l JOIN store_sku s ON s.id=l.sku_id WHERE s.store_id=?",store);
                db.update("DELETE i FROM store_inventory i JOIN store_sku s ON s.id=i.sku_id WHERE s.store_id=?",store);
                db.update("DELETE FROM store_sku WHERE store_id=?",store);
                db.update("DELETE FROM merchant_store WHERE id=?",store);
            }
            for(long id:accounts) db.update("DELETE FROM app_user WHERE id=?",id);
        }
    }

    @Test void businessRollbackAndReplyIdempotencyAndRevocation() {
        try(var f=new Fixture()) {
            var fail=new NotificationOutbox(f.db) {
                @Override public void enqueue(String key,Type type,long user,long resource) { super.enqueue(key,type,user,resource); throw new IllegalStateException("injected"); }
            };
            assertThrows(IllegalStateException.class,()->f.tx.execute(s->f.controller(fail).create(
                new ConsultationController.CreateRequest(f.report,f.doctor,"rollback"),()->"USER"+f.suffix+"@example.invalid")));
            assertEquals(0,f.count("notification_outbox"));
            assertTrue(f.chats.forUser(f.patient).isEmpty());
            assertThrows(IllegalStateException.class,()->f.outbox.enqueue("no-tx",NotificationOutbox.Type.DOCTOR_REPLIED,f.patient,1));
            long id=f.consultation(); f.chats.claim(id,f.doctor);
            f.tx.executeWithoutResult(s->f.controller(f.outbox).reply(id,new ConsultationController.ReplyRequest("这是用于测试旧版回复路径的虚构内容。"),()->"DOCTOR"+f.suffix+"@example.invalid"));
            var controller=new MessageController(f.users,f.doctors,f.chats,f.messages,f.reports,new RequestRateLimiter(null,false),f.outbox);
            var request=new MessageController.SendRequest("private-doctor-reply","reply-key-"+f.suffix);
            long first=f.tx.execute(s->controller.send(id,request,()->"DOCTOR"+f.suffix+"@example.invalid").id());
            long repeated=f.tx.execute(s->controller.send(id,request,()->"DOCTOR"+f.suffix+"@example.invalid").id());
            assertEquals(first,repeated);
            assertEquals(3,f.count("notification_outbox")); f.drain();
            assertEquals(1,f.inbox.unread(f.doctor)); assertEquals(2,f.inbox.unread(f.patient));
            var item=f.inbox.page(f.doctor,null,20,false).items().get(0);
            assertFalse(item.description().contains("private"));
            assertThrows(ResponseStatusException.class,()->f.inbox.read(f.merchant,item.id()));
            assertTrue(f.inbox.page(f.merchant,null,20,false).items().isEmpty());
            f.inbox.read(f.doctor,item.id()); f.inbox.read(f.doctor,item.id()); assertEquals(0,f.inbox.unread(f.doctor));
            f.reports.revoke(f.report,f.doctor);
            assertTrue(f.inbox.page(f.doctor,null,20,false).items().isEmpty());
            assertThrows(ResponseStatusException.class,()->f.inbox.read(f.doctor,item.id()));
        }
    }

    @Test void partialDeliveryRollsBackRetriesAreBoundedAndRestartResumes() {
        try(var f=new Fixture()) {
            f.consultation();
            var broken=new NotificationStore(f.db) {
                @Override public void deliver(NotificationOutbox.Event event) {
                    super.deliver(event);
                    if(f.accounts.contains(event.recipientId())) throw new IllegalStateException("sensitive failure must not be persisted");
                }
            };
            long event=f.db.queryForObject("SELECT id FROM notification_outbox WHERE recipient_id=?",Long.class,f.doctor);
            for(int attempt=1;attempt<=5;attempt++) {
                f.db.update("UPDATE notification_outbox SET available_at=DATE_SUB(NOW(6),INTERVAL 1 SECOND) WHERE id=?",event);
                assertTrue(f.worker(broken).dispatchOne());
                assertEquals(0,f.count("user_notification"));
                var state=f.db.queryForMap("SELECT status,attempts,last_error,available_at>CURRENT_TIMESTAMP(6) AS is_delayed FROM notification_outbox WHERE id=?",event);
                assertEquals(attempt,((Number)state.get("attempts")).intValue());
                assertEquals(attempt==5 ? "FAILED":"PENDING",state.get("status"));
                assertEquals("IllegalStateException",state.get("last_error"));
                assertEquals(1,((Number)state.get("is_delayed")).intValue());
            }
            // Manual redrive after repair; no unauthenticated HTTP retry endpoint.
            f.db.update("UPDATE notification_outbox SET status='PENDING',attempts=0,available_at=NOW(6) WHERE id=?",event);
            assertTrue(f.worker(f.inbox).dispatchOne()); // New worker instance reads durable state.
            assertEquals(1,f.count("user_notification"));
            f.db.update("UPDATE notification_outbox SET status='PENDING',available_at=NOW(6) WHERE id=?",event);
            assertTrue(f.worker(f.inbox).dispatchOne()); // Replay must not create a second inbox row.
            assertEquals(1,f.count("user_notification"));
            assertEquals("DELIVERED",f.db.queryForObject("SELECT status FROM notification_outbox WHERE id=?",String.class,event));
        }
    }

    @Test void parallelWorkersAndInboxPaginationDoNotDuplicate() throws Exception {
        try(var f=new Fixture()) {
            long id=f.consultation();
            f.tx.executeWithoutResult(s->{ for(int i=0;i<41;i++) f.outbox.enqueue("test:"+f.suffix+":"+i,NotificationOutbox.Type.DOCTOR_REPLIED,f.patient,id); });
            var pool=Executors.newFixedThreadPool(6); var start=new CountDownLatch(1);
            try {
                var jobs=new ArrayList<Future<?>>();
                for(int i=0;i<6;i++) jobs.add(pool.submit(()->{ start.await(); for(int n=0;n<100 && f.worker(f.inbox).dispatchOne();n++) {} return null; }));
                start.countDown(); for(var job:jobs) job.get(30,TimeUnit.SECONDS);
            } finally { pool.shutdownNow(); }
            assertEquals(42,f.count("user_notification"));
            assertEquals(0,f.db.queryForObject("SELECT COUNT(*) FROM notification_outbox WHERE recipient_id IN (?,?) AND (status<>'DELIVERED' OR attempts<>1)",Integer.class,f.patient,f.doctor));
            var ids=new HashSet<Long>(); Long before=null;
            while(true) { var page=f.inbox.page(f.patient,before,20,false); for(var item:page.items()) assertTrue(ids.add(item.id())); if(!page.hasMore()) break; before=page.items().get(page.items().size()-1).id(); }
            assertEquals(41,ids.size());
            long one=ids.iterator().next(); f.inbox.read(f.patient,one);
            assertEquals(40,f.inbox.unread(f.patient));
            assertEquals(20,f.inbox.page(f.patient,null,20,true).items().size());
            assertThrows(ResponseStatusException.class,()->f.inbox.page(f.patient,null,101,false));
        }
    }

    @Test void orderTransitionsAndInventoryRollbackWithOutbox() {
        try(var f=new Fixture()) {
            var stores=new MerchantStore(f.db); var catalog=new MerchantCatalogStore(f.db);
            f.store=stores.create(f.merchant,"通知订单测试","","测试城市","虚构地址").id(); catalog.seedStarter(f.store); stores.setStatus(f.merchant,"OPEN");
            long sku=catalog.products(f.store).get(0).id(); catalog.setStatus(f.store,sku,"ON_SHELF"); catalog.setAvailable(sku,f.merchant,0,3,"通知测试");
            var shop=new ShopStore(f.db); var orders=new OrderStore(f.db);
            var service=new OrderService(shop,orders,stores,f.outbox);
            shop.add(f.patient,sku,1); long accepted=f.tx.execute(s->service.checkout(f.patient,"accepted-test").order().id());
            f.tx.execute(s->service.pay(f.patient,accepted));
            var failure=new NotificationOutbox(f.db) {
                @Override public void enqueue(String k,Type t,long u,long r) { super.enqueue(k,t,u,r); throw new IllegalStateException("rollback"); }
            };
            var failingService=new OrderService(shop,orders,stores,failure);
            assertThrows(IllegalStateException.class,()->f.tx.execute(s->failingService.accept(f.merchant,accepted)));
            assertEquals("PAID",orders.byId(accepted).orElseThrow().status());
            assertEquals(1,f.db.queryForObject("SELECT reserved FROM store_inventory WHERE sku_id=?",Integer.class,sku));
            assertEquals(0,f.count("notification_outbox"));
            f.tx.execute(s->service.accept(f.merchant,accepted)); f.tx.execute(s->service.accept(f.merchant,accepted));
            shop.add(f.patient,sku,1); long expired=f.tx.execute(s->service.checkout(f.patient,"expired-test").order().id());
            f.db.update("UPDATE shop_order SET expires_at=DATE_SUB(NOW(6),INTERVAL 1 MINUTE) WHERE id=?",expired);
            f.tx.executeWithoutResult(s->service.expire(expired)); f.tx.executeWithoutResult(s->service.expire(expired));
            assertEquals(1,f.db.queryForObject("SELECT COUNT(*) FROM inventory_ledger WHERE sku_id=? AND reason='ORDER_EXPIRED'",Integer.class,sku));
            shop.add(f.patient,sku,1); long cancelled=f.tx.execute(s->service.checkout(f.patient,"cancelled-test").order().id());
            f.tx.execute(s->service.cancel(f.patient,cancelled));
            assertEquals(2,f.count("notification_outbox")); f.drain();
            assertEquals(Set.of("ORDER_ACCEPTED","ORDER_EXPIRED"),new HashSet<>(f.inbox.page(f.patient,null,20,false).items().stream().map(NotificationStore.Item::type).toList()));
        }
    }
}
