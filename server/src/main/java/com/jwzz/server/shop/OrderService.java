package com.jwzz.server.shop;

import com.jwzz.server.merchant.MerchantStore;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class OrderService {
    private final ShopStore shop;
    private final OrderStore orders;
    private final MerchantStore stores;

    public OrderService(ShopStore shop, OrderStore orders, MerchantStore stores) {
        this.shop = shop; this.orders = orders; this.stores = stores;
    }

    @Transactional
    public OrderStore.Detail checkout(long userId, String key) {
        shop.lockUser(userId);
        var existing = orders.byKey(userId, key);
        if (existing.isPresent()) return orders.detail(existing.get());
        var cart = shop.cart(userId).stream().sorted(Comparator.comparingLong(ShopStore.CartItem::skuId)).toList();
        if (cart.isEmpty()) throw conflict("购物车为空");
        long storeId = cart.get(0).storeId();
        if (cart.stream().anyMatch(item -> item.storeId() != storeId)) throw conflict("购物车只能包含一家店铺");
        List<OrderStore.Stock> stocks = new ArrayList<>();
        long total = 0;
        for (var item : cart) {
            var stock = orders.lockStock(item.skuId()).orElseThrow(() -> conflict("商品已不可购买"));
            if (stock.storeId() != storeId || !stock.storeStatus().equals("OPEN")
                || !stock.skuStatus().equals("ON_SHELF") || stock.available() < item.quantity())
                throw conflict("商品状态或库存已变化，请调整购物车");
            stocks.add(stock);
            total = Math.addExact(total, Math.multiplyExact(stock.priceCents(), item.quantity()));
        }
        for (int index = 0; index < cart.size(); index++)
            orders.reserve(stocks.get(index), cart.get(index).quantity(), userId);
        long id = orders.create(userId, storeId, key, total, LocalDateTime.now().plusMinutes(15));
        for (int index = 0; index < cart.size(); index++)
            orders.addItem(id, stocks.get(index), cart.get(index).quantity());
        orders.clearCart(userId);
        return orders.detail(orders.byId(id).orElseThrow());
    }

    public List<OrderStore.Order> forUser(long userId) { return orders.forUser(userId); }
    public List<OrderStore.Order> forMerchant(long merchantId) { return orders.forMerchant(merchantId); }

    public OrderStore.Detail userDetail(long userId, long orderId) {
        var order = orders.byId(orderId).orElseThrow(() -> notFound());
        if (order.userId() != userId) throw notFound();
        return orders.detail(order);
    }

    public OrderStore.Detail merchantDetail(long merchantId, long orderId) {
        var order = orders.byId(orderId).orElseThrow(() -> notFound());
        long storeId = stores.ownedBy(merchantId).map(MerchantStore.Store::id).orElseThrow(() -> notFound());
        if (order.storeId() != storeId) throw notFound();
        return orders.detail(order);
    }

    @Transactional
    public OrderStore.Detail pay(long userId, long orderId) {
        var order = ownedLocked(userId, orderId);
        if (order.status().equals("PENDING_PAYMENT")) {
            if (!LocalDateTime.now().isBefore(order.expiresAt())) closePending(order, "EXPIRED");
            else orders.transition(orderId, "PENDING_PAYMENT", "PAID", "paid_at");
        } else if (!order.status().equals("PAID") && !order.status().equals("ACCEPTED")) {
            throw conflict("订单已关闭，不能模拟支付");
        }
        return orders.detail(orders.byId(orderId).orElseThrow());
    }

    @Transactional
    public OrderStore.Detail cancel(long userId, long orderId) {
        var order = ownedLocked(userId, orderId);
        if (order.status().equals("PENDING_PAYMENT")) closePending(order,
            LocalDateTime.now().isBefore(order.expiresAt()) ? "CANCELLED" : "EXPIRED");
        else if (!order.status().equals("CANCELLED") && !order.status().equals("EXPIRED"))
            throw conflict("已模拟支付或已接单，不能直接取消");
        return orders.detail(orders.byId(orderId).orElseThrow());
    }

    @Transactional
    public OrderStore.Detail accept(long merchantId, long orderId) {
        var order = orders.lock(orderId).orElseThrow(() -> notFound());
        long storeId = stores.ownedBy(merchantId).map(MerchantStore.Store::id).orElseThrow(() -> notFound());
        if (order.storeId() != storeId) throw notFound();
        if (order.status().equals("PAID")) {
            for (var item : orders.detail(order).items()) orders.consume(item.skuId(), item.quantity(), merchantId);
            orders.transition(orderId, "PAID", "ACCEPTED", "accepted_at");
        } else if (!order.status().equals("ACCEPTED")) throw conflict("只有已模拟支付的订单才能接单");
        return orders.detail(orders.byId(orderId).orElseThrow());
    }

    @Transactional
    public void expire(long orderId) {
        var order = orders.lock(orderId).orElse(null);
        if (order != null && order.status().equals("PENDING_PAYMENT")
            && !LocalDateTime.now().isBefore(order.expiresAt())) closePending(order, "EXPIRED");
    }

    private OrderStore.Order ownedLocked(long userId, long orderId) {
        var order = orders.lock(orderId).orElseThrow(() -> notFound());
        if (order.userId() != userId) throw notFound();
        return order;
    }

    private void closePending(OrderStore.Order order, String target) {
        for (var item : orders.detail(order).items())
            orders.release(item.skuId(), item.quantity(), order.userId(),
                target.equals("EXPIRED") ? "ORDER_EXPIRED" : "ORDER_CANCELLED");
        orders.transition(order.id(), "PENDING_PAYMENT", target, "closed_at");
    }

    private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }
    private ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "订单不存在"); }
}
