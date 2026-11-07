package com.jwzz.server.shop;

import com.jwzz.server.auth.UserStore;
import java.security.Principal;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/merchant/orders")
public class MerchantOrderController {
    private final UserStore users;
    private final OrderService orders;
    public MerchantOrderController(UserStore users, OrderService orders) { this.users = users; this.orders = orders; }

    @GetMapping
    public List<OrderStore.Order> list(Principal principal) { return orders.forMerchant(merchantId(principal)); }

    @GetMapping("/{orderId}")
    public OrderStore.Detail detail(@PathVariable long orderId, Principal principal) {
        return orders.merchantDetail(merchantId(principal), orderId);
    }

    @PostMapping("/{orderId}/accept")
    public OrderStore.Detail accept(@PathVariable long orderId, Principal principal) {
        return orders.accept(merchantId(principal), orderId);
    }

    private long merchantId(Principal principal) { return users.findByEmail(principal.getName()).orElseThrow().id(); }
}
