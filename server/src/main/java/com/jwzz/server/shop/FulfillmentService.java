package com.jwzz.server.shop;

import com.jwzz.server.auth.UserStore;
import jakarta.validation.constraints.*;
import java.time.LocalDateTime;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class FulfillmentService {
    public record Tracking(@NotBlank @Pattern(regexp="DEMO-[A-Za-z0-9-]{4,59}") String code) {}
    public record Request(@NotBlank @Size(max=500) String reason,@NotBlank @Pattern(regexp="[A-Za-z0-9-]{8,64}") String clientKey) {}
    public record Review(@NotNull Boolean approve,@NotBlank @Size(max=500) String note) {}
    public record Inspection(@NotBlank @Pattern(regexp="RESTOCK|DISCARD") String disposition) {}
    public record Shipment(String trackingCode,LocalDateTime shippedAt,LocalDateTime receivedAt) {}
    public record Refund(long id,String originalStatus,String status,String reason,String reviewNote,String returnCode,String disposition,LocalDateTime createdAt,LocalDateTime completedAt) {}
    public record Entry(long id,long refundId,long amountCents,LocalDateTime createdAt) {}
    public record Detail(OrderStore.Order order,Shipment shipment,List<Refund> refunds,List<Entry> ledger) {}
    private final JdbcTemplate db;private final OrderStore orders;private final RefundLedger ledger;
    public FulfillmentService(JdbcTemplate db,OrderStore orders,RefundLedger ledger) {this.db=db;this.orders=orders;this.ledger=ledger;}
    private ResponseStatusException missing() {return new ResponseStatusException(HttpStatus.NOT_FOUND,"订单或退款不存在");}
    private void conflict(String text) {throw new ResponseStatusException(HttpStatus.CONFLICT,text);}
    private void role(UserStore.User actor,String expected) {if(!actor.role().equals(expected))throw new ResponseStatusException(HttpStatus.FORBIDDEN);}
    private OrderStore.Order access(long id,UserStore.User actor,boolean lock) {
        if(!Set.of("USER","MERCHANT").contains(actor.role())) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        var order=(lock?orders.lock(id):orders.byId(id)).orElseThrow(this::missing);
        if(actor.role().equals("USER")) {if(order.userId()!=actor.id())throw missing();}
        else if(db.queryForObject("SELECT COUNT(*) FROM merchant_store WHERE id=? AND merchant_id=?",Integer.class,order.storeId(),actor.id())!=1)throw missing();
        return order;
    }
    private LocalDateTime timestamp(java.sql.ResultSet rs,String column) throws java.sql.SQLException {
        var value=rs.getTimestamp(column);return value==null?null:value.toLocalDateTime();
    }
    private List<Refund> refunds(long id) {
        return db.query("SELECT * FROM shop_refund WHERE order_id=? ORDER BY id DESC",(rs,n)->new Refund(rs.getLong("id"),rs.getString("original_status"),rs.getString("status"),rs.getString("reason"),rs.getString("review_note"),rs.getString("return_code"),rs.getString("disposition"),timestamp(rs,"created_at"),timestamp(rs,"completed_at")),id);
    }
    private Refund refund(long order,long id) {return refunds(order).stream().filter(r->r.id()==id).findFirst().orElseThrow(this::missing);}
    public Detail detail(long id,UserStore.User actor) {return view(access(id,actor,false));}
    private Detail view(OrderStore.Order order) {
        var shipment=db.query("SELECT * FROM shop_shipment WHERE order_id=?",(rs,n)->new Shipment(rs.getString("tracking_code"),timestamp(rs,"shipped_at"),timestamp(rs,"received_at")),order.id());
        return new Detail(order,shipment.isEmpty()?null:shipment.get(0),refunds(order.id()),db.query("SELECT * FROM shop_refund_ledger WHERE order_id=? ORDER BY id",(rs,n)->new Entry(rs.getLong("id"),rs.getLong("refund_id"),rs.getLong("amount_cents"),timestamp(rs,"created_at")),order.id()));
    }
    // All mutations lock the order first, then inventory in SKU order, just like checkout/accept/cancel.
    // Read-committed also keeps child-row idempotency reads fresh after waiting on that lock.
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public Detail ship(long id,Tracking request,UserStore.User actor) {
        role(actor,"MERCHANT");var order=access(id,actor,true);var existing=view(order).shipment();
        if(existing!=null) {if(!existing.trackingCode().equals(request.code()))conflict("已发货，不能覆盖模拟单号");return view(order);}
        if(!order.status().equals("ACCEPTED"))conflict("只有已接单且无退款处理中的订单可以发货");
        db.update("INSERT INTO shop_shipment(order_id,tracking_code) VALUES (?,?)",id,request.code());
        state(order,"SHIPPED");return view(orders.byId(id).orElseThrow());
    }
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public Detail receive(long id,UserStore.User actor) {
        role(actor,"USER");var order=access(id,actor,true);var shipment=view(order).shipment();
        if(shipment!=null && shipment.receivedAt()!=null)return view(order);
        if(!order.status().equals("SHIPPED"))conflict("只有已发货且无退款处理中的订单可以确认收货");
        db.update("UPDATE shop_shipment SET received_at=CURRENT_TIMESTAMP(6) WHERE order_id=?",id);state(order,"COMPLETED");
        return view(orders.byId(id).orElseThrow());
    }
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public Detail request(long id,Request request,UserStore.User actor) {
        role(actor,"USER");var order=access(id,actor,true);
        var old=db.queryForList("SELECT reason FROM shop_refund WHERE order_id=? AND client_key=?",id,request.clientKey());
        if(!old.isEmpty()) {if(!old.get(0).get("reason").equals(request.reason().trim()))conflict("此提交编号已用于其他原因");return view(order);}
        if(!Set.of("PAID","ACCEPTED","SHIPPED","COMPLETED").contains(order.status()))conflict("订单当前不能申请退款");
        if(refunds(id).size()>=20)conflict("此订单退款申请次数已达上限");
        db.update("INSERT INTO shop_refund(order_id,client_key,original_status,reason) VALUES (?,?,?,?)",id,request.clientKey(),order.status(),request.reason().trim());
        state(order,"REFUND_PENDING");return view(orders.byId(id).orElseThrow());
    }
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public Detail review(long id,long refundId,Review request,UserStore.User actor) {
        role(actor,"MERCHANT");var order=access(id,actor,true);var refund=refund(id,refundId);
        if(!refund.status().equals("REQUESTED")) {
            if(request.approve()==refund.status().equals("REJECTED") || !Objects.equals(refund.reviewNote(),request.note().trim()))conflict("申请已经审核，不能覆盖审核结果");
            return view(order);
        }
        if(!order.status().equals("REFUND_PENDING"))conflict("订单不在退款处理中");
        db.update("UPDATE shop_refund SET review_note=?,reviewed_at=CURRENT_TIMESTAMP(6) WHERE id=?",request.note().trim(),refundId);
        if(!request.approve()) {db.update("UPDATE shop_refund SET status='REJECTED' WHERE id=?",refundId);state(order,refund.originalStatus());}
        else if(Set.of("SHIPPED","COMPLETED").contains(refund.originalStatus()))db.update("UPDATE shop_refund SET status='AWAITING_RETURN' WHERE id=?",refundId);
        else {
            for(var item:items(order)) {
                if(refund.originalStatus().equals("PAID"))orders.release(item.skuId(),item.quantity(),actor.id(),"REFUND_RESERVED_RELEASE");
                else orders.restock(item.skuId(),item.quantity(),actor.id(),"REFUND_UNSHIPPED",id);
            }
            finish(order,refund,refund.originalStatus().equals("PAID")?"RELEASE_RESERVED":"UNSHIPPED_RESTOCK");
        }
        return view(orders.byId(id).orElseThrow());
    }
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public Detail returnGoods(long id,long refundId,Tracking request,UserStore.User actor) {
        role(actor,"USER");var order=access(id,actor,true);var refund=refund(id,refundId);
        if(refund.returnCode()!=null) {if(!refund.returnCode().equals(request.code()))conflict("已提交退货，不能替换模拟单号");return view(order);}
        if(!refund.status().equals("AWAITING_RETURN") || !order.status().equals("REFUND_PENDING"))conflict("请等待商家同意退货");
        db.update("UPDATE shop_refund SET status='RETURNED',return_code=?,returned_at=CURRENT_TIMESTAMP(6) WHERE id=?",request.code(),refundId);
        return view(order);
    }
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public Detail inspect(long id,long refundId,Inspection request,UserStore.User actor) {
        role(actor,"MERCHANT");var order=access(id,actor,true);var refund=refund(id,refundId);
        if(refund.status().equals("REFUNDED")) {if(!Objects.equals(refund.disposition(),request.disposition()))conflict("已验收，不能修改库存处理方式");return view(order);}
        if(!refund.status().equals("RETURNED") || !order.status().equals("REFUND_PENDING"))conflict("用户模拟退货后才能验收退款");
        if(request.disposition().equals("RESTOCK"))for(var item:items(order))orders.restock(item.skuId(),item.quantity(),actor.id(),"REFUND_RETURN_RESTOCK",id);
        else if(!request.disposition().equals("DISCARD"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        finish(order,refund,request.disposition());return view(orders.byId(id).orElseThrow());
    }
    private List<OrderStore.Item> items(OrderStore.Order order) {return orders.detail(order).items().stream().sorted(Comparator.comparingLong(OrderStore.Item::skuId)).toList();}
    private void finish(OrderStore.Order order,Refund refund,String disposition) {
        // Amount is derived from the immutable order snapshot, never supplied by the client.
        ledger.record(order.id(),refund.id(),order.totalCents());
        db.update("UPDATE shop_refund SET status='REFUNDED',disposition=?,completed_at=CURRENT_TIMESTAMP(6) WHERE id=?",disposition,refund.id());
        state(order,"REFUNDED");
    }
    private void state(OrderStore.Order order,String target) {
        if(db.update("UPDATE shop_order SET status=? WHERE id=? AND status=?",target,order.id(),order.status())!=1)conflict("订单状态已变化，请刷新重试");
    }
}
