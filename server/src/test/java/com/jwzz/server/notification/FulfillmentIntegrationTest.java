package com.jwzz.server.notification;

import static org.junit.jupiter.api.Assertions.*;
import com.jwzz.server.shop.*;
import com.jwzz.server.merchant.*;
import com.jwzz.server.auth.UserStore;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.web.server.ResponseStatusException;

class FulfillmentIntegrationTest {
    static class Fixture extends NotificationIntegrationTest.Fixture {
        final MerchantStore stores=new MerchantStore(db);final MerchantCatalogStore catalog=new MerchantCatalogStore(db);
        final ShopStore shop=new ShopStore(db);final OrderStore orders=new OrderStore(db);
        final OrderService orderService=new OrderService(shop,orders,stores,outbox);
        final FulfillmentService service=new FulfillmentService(db,orders,new RefundLedger(db));
        final UserStore.User buyer=users.findById(patient).orElseThrow(),seller=users.findById(merchant).orElseThrow();
        final long sku;
        Fixture() {
            tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
            store=stores.create(merchant,"履约测试店 "+suffix,"","测试市","虚构地址").id();catalog.seedStarter(store);
            sku=catalog.products(store).get(0).id();catalog.setStatus(store,sku,"ON_SHELF");catalog.setAvailable(sku,merchant,0,20,"虚构备货");stores.setStatus(merchant,"OPEN");
        }
        long paid(boolean accept) {
            shop.add(patient,sku,1);long id=tx.execute(s->orderService.checkout(patient,UUID.randomUUID().toString()).order().id());
            tx.execute(s->orderService.pay(patient,id));if(accept)tx.execute(s->orderService.accept(merchant,id));return id;
        }
        long request(long id) {return tx.execute(s->service.request(id,new FulfillmentService.Request("演示退款",UUID.randomUUID().toString()),buyer)).refunds().get(0).id();}
        void ship(long id) {tx.execute(s->service.ship(id,new FulfillmentService.Tracking("DEMO-SHIP-"+id),seller));}
        void approve(long id,long r) {tx.execute(s->service.review(id,r,new FulfillmentService.Review(true,"演示审核同意"),seller));}
        void returned(long id,long r) {tx.execute(s->service.returnGoods(id,r,new FulfillmentService.Tracking("DEMO-RETURN-"+r),buyer));}
        int available() {return db.queryForObject("SELECT available FROM store_inventory WHERE sku_id=?",Integer.class,sku);}
        int reserved() {return db.queryForObject("SELECT reserved FROM store_inventory WHERE sku_id=?",Integer.class,sku);}
        void once(long id) {assertEquals(1,service.detail(id,buyer).ledger().size());assertEquals(orders.byId(id).orElseThrow().totalCents(),service.detail(id,buyer).ledger().get(0).amountCents());}
        public void close() {
            db.update("DELETE l FROM shop_refund_ledger l JOIN shop_order o ON o.id=l.order_id WHERE o.store_id=?",store);
            db.update("DELETE r FROM shop_refund r JOIN shop_order o ON o.id=r.order_id WHERE o.store_id=?",store);
            db.update("DELETE s FROM shop_shipment s JOIN shop_order o ON o.id=s.order_id WHERE o.store_id=?",store);
            super.close();
        }
    }
    void parallel(int count,Runnable operation) throws Exception {
        var pool=Executors.newFixedThreadPool(count);var gate=new CountDownLatch(1);
        try {var jobs=new ArrayList<Future<?>>();for(int i=0;i<count;i++)jobs.add(pool.submit(()->{gate.await();operation.run();return null;}));gate.countDown();for(var job:jobs)job.get(20,TimeUnit.SECONDS);}finally{pool.shutdownNow();}
    }
    @Test void beforeShipmentRefundsReleaseOrRestoreExactlyOnce() throws Exception {
        try(var f=new Fixture()) {
            for(boolean accepted:List.of(false,true)) {
                long id=f.paid(accepted);assertEquals(19,f.available());assertEquals(accepted?0:1,f.reserved());
                var request=new FulfillmentService.Request("并发重复申请",UUID.randomUUID().toString());
                parallel(6,()->f.tx.execute(s->f.service.request(id,request,f.buyer)));
                long refund=f.service.detail(id,f.buyer).refunds().get(0).id();assertEquals(1,f.service.detail(id,f.buyer).refunds().size());
                parallel(8,()->f.approve(id,refund));f.once(id);assertEquals(20,f.available());assertEquals(0,f.reserved());
                assertEquals("REFUNDED",f.orders.byId(id).orElseThrow().status());
                assertEquals("REFUNDED",f.tx.execute(s->f.orderService.pay(f.patient,id)).order().status());
                if(accepted)assertEquals("REFUNDED",f.tx.execute(s->f.orderService.accept(f.merchant,id)).order().status());
                assertThrows(ResponseStatusException.class,()->f.request(id));
            }
        }
    }
    @Test void shippedOrderNeedsReturnInspectionAndSupportsDiscard() throws Exception {
        try(var f=new Fixture()) {
            for(String disposition:List.of("RESTOCK","DISCARD")) {
                int before=f.available();long id=f.paid(true);f.ship(id);f.ship(id);
                f.tx.execute(s->f.service.receive(id,f.buyer));f.tx.execute(s->f.service.receive(id,f.buyer));
                assertEquals("COMPLETED",f.orders.byId(id).orElseThrow().status());long refund=f.request(id);f.approve(id,refund);f.approve(id,refund);
                assertEquals(before-1,f.available());assertTrue(f.service.detail(id,f.buyer).ledger().isEmpty());
                assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.inspect(id,refund,new FulfillmentService.Inspection(disposition),f.seller)));
                f.returned(id,refund);f.returned(id,refund);
                parallel(8,()->f.tx.execute(s->f.service.inspect(id,refund,new FulfillmentService.Inspection(disposition),f.seller)));
                f.once(id);assertEquals(disposition.equals("RESTOCK")?before:before-1,f.available());
                assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.inspect(id,refund,new FulfillmentService.Inspection(disposition.equals("RESTOCK")?"DISCARD":"RESTOCK"),f.seller)));
            }
        }
    }
    @Test void rejectionRestoresStateAndNewRequestCanBeSubmittedButOldDecisionCannotOverwrite() {
        try(var f=new Fixture()) {
            long id=f.paid(true);f.ship(id);long first=f.request(id);
            f.tx.execute(s->f.service.review(id,first,new FulfillmentService.Review(false,"请补充原因"),f.seller));
            assertEquals("SHIPPED",f.orders.byId(id).orElseThrow().status());long second=f.request(id);
            f.tx.execute(s->f.service.review(id,first,new FulfillmentService.Review(false,"请补充原因"),f.seller));
            assertEquals("REFUND_PENDING",f.orders.byId(id).orElseThrow().status());
            assertThrows(ResponseStatusException.class,()->f.approve(id,first));f.approve(id,second);assertEquals("AWAITING_RETURN",f.service.detail(id,f.buyer).refunds().get(0).status());
            assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.receive(id,f.buyer)));
        }
    }
    @Test void refundLedgerFailureRollsBackStockAndStatusAndRetrySucceeds() {
        try(var f=new Fixture()) {
            long id=f.paid(true),r=f.request(id);
            var fail=new FulfillmentService(f.db,f.orders,new RefundLedger(f.db){@Override public void record(long order,long refund,long amount){super.record(order,refund,amount);throw new IllegalStateException("injected");}});
            assertThrows(IllegalStateException.class,()->f.tx.execute(s->fail.review(id,r,new FulfillmentService.Review(true,"演示审核同意"),f.seller)));
            assertEquals(19,f.available());assertEquals("REFUND_PENDING",f.orders.byId(id).orElseThrow().status());assertEquals("REQUESTED",f.service.detail(id,f.buyer).refunds().get(0).status());assertTrue(f.service.detail(id,f.buyer).ledger().isEmpty());
            f.approve(id,r);assertEquals(20,f.available());f.once(id);
        }
    }
    @Test void ownershipAndRoleIsolationAndConflictingIdempotency() {
        try(var f=new Fixture()) {
            long id=f.paid(true);var foreign=new UserStore.User(999999999,"foreign@example.invalid","hash","USER","外部");
            assertThrows(ResponseStatusException.class,()->f.service.detail(id,foreign));
            var foreignSeller=new UserStore.User(999999999,"seller@example.invalid","hash","MERCHANT","其他商家");
            assertThrows(ResponseStatusException.class,()->f.service.detail(id,foreignSeller));
            assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.ship(id,new FulfillmentService.Tracking("DEMO-1234"),foreignSeller)));
            assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.ship(id,new FulfillmentService.Tracking("DEMO-1234"),f.buyer)));
            assertThrows(ResponseStatusException.class,()->f.service.detail(id,f.users.findById(f.doctor).orElseThrow()));
            var request=new FulfillmentService.Request("原因一","duplicate-refund-key");f.tx.execute(s->f.service.request(id,request,f.buyer));
            assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.request(id,new FulfillmentService.Request("原因二",request.clientKey()),f.buyer)));
            assertThrows(ResponseStatusException.class,()->f.tx.execute(s->f.service.review(id,999999,new FulfillmentService.Review(true,"未知申请"),f.seller)));
        }
    }
    @Test void shippingAndRefundRacesHaveConsistentInventory() throws Exception {
        try(var f=new Fixture()) {
            for(int iteration=0;iteration<8;iteration++) {
                long id=f.paid(true);var pool=Executors.newFixedThreadPool(2);var gate=new CountDownLatch(1);
                try {
                    var a=pool.submit(()->{gate.await();try{f.ship(id);}catch(ResponseStatusException ex){assertEquals(409,ex.getStatusCode().value());}return null;});
                    var b=pool.submit(()->{gate.await();return f.request(id);});gate.countDown();a.get(20,TimeUnit.SECONDS);long r=b.get(20,TimeUnit.SECONDS);
                    f.approve(id,r);var state=f.service.detail(id,f.buyer);
                    if(state.refunds().get(0).originalStatus().equals("SHIPPED")){f.returned(id,r);f.tx.execute(s->f.service.inspect(id,r,new FulfillmentService.Inspection("RESTOCK"),f.seller));}
                    f.once(id);assertEquals(20,f.available());assertEquals(0,f.reserved());
                } finally{pool.shutdownNow();}
            }
        }
    }
    @Test void acceptAndReceiveCompeteWithRefundWithoutDoubleStockChanges() throws Exception {
        try(var f=new Fixture()) {
            for(boolean shipped:List.of(false,true))for(int i=0;i<4;i++) {
                long id=f.paid(shipped);if(shipped)f.ship(id);
                var pool=Executors.newFixedThreadPool(2);var gate=new CountDownLatch(1);
                try {
                    var progress=pool.submit(()->{gate.await();try{f.tx.execute(s->shipped?f.service.receive(id,f.buyer):f.orderService.accept(f.merchant,id));}catch(ResponseStatusException e){assertEquals(409,e.getStatusCode().value());}return null;});
                    var refund=pool.submit(()->{gate.await();return f.request(id);});gate.countDown();progress.get(20,TimeUnit.SECONDS);long r=refund.get(20,TimeUnit.SECONDS);
                    f.approve(id,r);if(shipped){f.returned(id,r);f.tx.execute(s->f.service.inspect(id,r,new FulfillmentService.Inspection("RESTOCK"),f.seller));}
                    f.once(id);assertEquals(20,f.available());assertEquals(0,f.reserved());
                }finally{pool.shutdownNow();}
            }
        }
    }
}
