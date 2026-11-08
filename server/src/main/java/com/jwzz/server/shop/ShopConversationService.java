package com.jwzz.server.shop;

import com.jwzz.server.common.RequestRateLimiter;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ShopConversationService {
    private final OrderStore orders;
    private final ShopConversationStore conversations;
    private final RequestRateLimiter limiter;

    public ShopConversationService(OrderStore orders, ShopConversationStore conversations, RequestRateLimiter limiter) {
        this.orders = orders; this.conversations = conversations; this.limiter = limiter;
    }

    @Transactional
    public ShopConversationStore.Detail open(long userId, long orderId, String firstMessage) {
        var order = orders.lock(orderId).orElseThrow(() -> notFound());
        if (order.userId() != userId) throw notFound();
        var existing = conversations.byOrder(orderId);
        if (existing.isPresent()) return detail(userId, false, existing.get().id());
        String body = clean(firstMessage, "您好，我想咨询订单 #" + orderId + "。请问能帮我确认一下吗？");
        limiter.check("shop-message", userId, 60);
        long id = conversations.create(orderId, userId, order.storeId());
        conversations.addMessage(id, userId, body);
        return detail(userId, false, id);
    }

    public List<ShopConversationStore.Summary> list(long actorId, boolean merchant) {
        return conversations.summaries(actorId, merchant);
    }

    public ShopConversationStore.Detail detail(long actorId, boolean merchant, long id) {
        var summary = conversations.summary(actorId, merchant, id).orElseThrow(() -> notFound());
        return new ShopConversationStore.Detail(summary, conversations.messages(id));
    }

    @Transactional
    public ShopConversationStore.Message send(long actorId, boolean merchant, long id, String body) {
        return send(actorId, merchant, id, body, null);
    }

    @Transactional
    public ShopConversationStore.Message send(long actorId, boolean merchant, long id, String body, String clientId) {
        var conversation = accessibleLocked(actorId, merchant, id);
        String value = clean(body, null);
        var existing = conversations.byClientId(id, actorId, clientId);
        if (existing.isPresent()) {
            if (!existing.get().body().equals(value)) throw new ResponseStatusException(HttpStatus.CONFLICT, "消息 ID 已用于不同内容");
            return existing.get();
        }
        limiter.check("shop-message", actorId, 60);
        return conversations.addMessage(conversation.id(), actorId, value, clientId);
    }

    @Transactional
    public void markRead(long actorId, boolean merchant, long id) {
        accessibleLocked(actorId, merchant, id);
        conversations.markRead(id, merchant);
    }

    private ShopConversationStore.Conversation accessibleLocked(long actorId, boolean merchant, long id) {
        var conversation = conversations.lock(id).orElseThrow(() -> notFound());
        if ((merchant ? conversation.merchantId() : conversation.userId()) != actorId) throw notFound();
        return conversation;
    }

    private String clean(String body, String fallback) {
        String value = body == null ? "" : body.trim();
        if (value.isEmpty() && fallback != null) value = fallback;
        if (value.isEmpty() || value.length() > 2000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "消息长度需为 1～2000 字");
        return value;
    }

    private ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "会话不存在");
    }
}
