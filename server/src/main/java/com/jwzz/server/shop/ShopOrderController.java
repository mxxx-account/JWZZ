package com.jwzz.server.shop;

import com.jwzz.server.auth.UserStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.security.Principal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/shop/orders")
public class ShopOrderController {
    public record CheckoutRequest(@NotBlank @Pattern(regexp = "[A-Za-z0-9-]{8,64}") String idempotencyKey) {}
    private final UserStore users;
    private final OrderService orders;
    public ShopOrderController(UserStore users, OrderService orders) { this.users = users; this.orders = orders; }

    @GetMapping
    public List<OrderStore.Order> list(Principal principal) { return orders.forUser(userId(principal)); }

    @GetMapping("/{orderId}")
    public OrderStore.Detail detail(@PathVariable long orderId, Principal principal) {
        return orders.userDetail(userId(principal), orderId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public OrderStore.Detail checkout(@Valid @RequestBody CheckoutRequest request, Principal principal) {
        return orders.checkout(userId(principal), request.idempotencyKey());
    }

    @PostMapping("/{orderId}/pay")
    public OrderStore.Detail pay(@PathVariable long orderId, Principal principal) {
        return orders.pay(userId(principal), orderId);
    }

    @PostMapping("/{orderId}/cancel")
    public OrderStore.Detail cancel(@PathVariable long orderId, Principal principal) {
        return orders.cancel(userId(principal), orderId);
    }

    private long userId(Principal principal) { return users.findByEmail(principal.getName()).orElseThrow().id(); }
}
