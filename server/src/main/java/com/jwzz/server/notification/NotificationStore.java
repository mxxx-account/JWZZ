package com.jwzz.server.notification;

import com.jwzz.server.common.ChatPage;
import java.time.LocalDateTime;
import java.util.ArrayList;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.web.server.ResponseStatusException;

@Repository
public class NotificationStore {
    public record Item(long id, String type, long resourceId, String title, String description, String href,
                       LocalDateTime createdAt, LocalDateTime readAt) {}
    private final JdbcTemplate jdbc;
    public NotificationStore(JdbcTemplate jdbc) { this.jdbc=jdbc; }

    public void deliver(NotificationOutbox.Event event) {
        jdbc.update("""
            INSERT INTO user_notification(event_id,recipient_id,event_type,resource_id) VALUES (?,?,?,?)
            ON DUPLICATE KEY UPDATE event_id=event_id
            """,event.id(),event.recipientId(),event.type().name(),event.resourceId());
    }

    // Ownership and current report grants are rechecked for list, counts and read actions.
    private static final String VISIBLE = """
        n.recipient_id=? AND (
          (n.event_type='CONSULTATION_SUBMITTED' AND EXISTS (
            SELECT 1 FROM consultation_request c JOIN report_access_grant g ON g.report_id=c.report_id
            JOIN app_user a ON a.id=n.recipient_id AND a.role='DOCTOR'
            WHERE c.id=n.resource_id AND c.target_doctor_id=n.recipient_id
              AND g.doctor_id=n.recipient_id AND g.revoked_at IS NULL))
          OR (n.event_type='DOCTOR_REPLIED' AND EXISTS (
            SELECT 1 FROM consultation_request c JOIN app_user a ON a.id=n.recipient_id AND a.role='USER'
            WHERE c.id=n.resource_id AND c.user_id=n.recipient_id))
          OR (n.event_type IN ('ORDER_ACCEPTED','ORDER_EXPIRED') AND EXISTS (
            SELECT 1 FROM shop_order o JOIN app_user a ON a.id=n.recipient_id AND a.role='USER'
            WHERE o.id=n.resource_id AND o.user_id=n.recipient_id)))
        """;

    public ChatPage<Item> page(long actor, Long before, int size, boolean unreadOnly) {
        ChatPage.validate(before,null,size);
        var args = new ArrayList<Object>(); args.add(actor);
        if (before!=null) args.add(before);
        args.add(size+1);
        var items=jdbc.query("SELECT n.* FROM user_notification n WHERE " + VISIBLE
            + (before==null ? "":" AND n.id<?") + (unreadOnly ? " AND n.read_at IS NULL":"")
            + " ORDER BY n.id DESC LIMIT ?", (rs,row) -> {
                var type=NotificationOutbox.Type.valueOf(rs.getString("event_type"));
                long resource=rs.getLong("resource_id");
                String title=switch(type) {
                    case CONSULTATION_SUBMITTED -> "收到新的咨询";
                    case DOCTOR_REPLIED -> "医生回复了咨询";
                    case ORDER_ACCEPTED -> "商家已接受订单";
                    case ORDER_EXPIRED -> "待支付订单已超时关闭";
                };
                String description=switch(type) {
                    case CONSULTATION_SUBMITTED -> "请到首页查看待咨询列表，接受后开始沟通。";
                    case DOCTOR_REPLIED -> "你的咨询有新回复，可进入咨询消息查看。";
                    case ORDER_ACCEPTED -> "商家已接受这笔演示订单，不涉及真实配送。";
                    case ORDER_EXPIRED -> "订单未在规定时间内模拟支付，预留库存已释放。";
                };
                String href=switch(type) {
                    case CONSULTATION_SUBMITTED -> "/doctor";
                    case DOCTOR_REPLIED -> "/patient/messages?conversation="+resource;
                    case ORDER_ACCEPTED, ORDER_EXPIRED -> "/patient/pharmacy?order="+resource;
                };
                var read=rs.getTimestamp("read_at");
                return new Item(rs.getLong("id"),type.name(),resource,title,description,href,
                    rs.getTimestamp("created_at").toLocalDateTime(),read==null ? null:read.toLocalDateTime());
            },args.toArray());
        return ChatPage.of(items,size,false);
    }

    public long unread(long actor) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM user_notification n WHERE " + VISIBLE
            + " AND n.read_at IS NULL", Long.class,actor);
    }

    public void read(long actor,long id) {
        // COALESCE makes repeated acknowledgements safe. UPDATE reports matched rows with the default MySQL driver setting.
        int updated=jdbc.update("UPDATE user_notification n SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP(6)) WHERE "
            + VISIBLE + " AND n.id=?",actor,id);
        if(updated==0 && jdbc.queryForObject("SELECT COUNT(*) FROM user_notification n WHERE " + VISIBLE + " AND n.id=?",Integer.class,actor,id)==0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"通知不存在或已不可访问");
    }
}
