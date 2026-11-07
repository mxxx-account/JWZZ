package com.jwzz.server.shop;

import com.jwzz.server.auth.UserStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
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
@RequestMapping("/api/shop")
public class UserShopMessageController {
    public record MessageRequest(@Size(max = 2000) String body) {}
    private final UserStore users;
    private final ShopConversationService service;
    public UserShopMessageController(UserStore users, ShopConversationService service) {
        this.users = users; this.service = service;
    }

    @PostMapping("/orders/{orderId}/conversation")
    @ResponseStatus(HttpStatus.CREATED)
    public ShopConversationStore.Detail open(@PathVariable long orderId,
                                             @Valid @RequestBody MessageRequest request, Principal principal) {
        return service.open(userId(principal), orderId, request.body());
    }

    @GetMapping("/conversations")
    public List<ShopConversationStore.Summary> list(Principal principal) {
        return service.list(userId(principal), false);
    }

    @GetMapping("/conversations/{id}")
    public ShopConversationStore.Detail detail(@PathVariable long id, Principal principal) {
        return service.detail(userId(principal), false, id);
    }

    @PostMapping("/conversations/{id}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    public ShopConversationStore.Message send(@PathVariable long id,
                                              @Valid @RequestBody MessageRequest request, Principal principal) {
        return service.send(userId(principal), false, id, request.body());
    }

    @PostMapping("/conversations/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void read(@PathVariable long id, Principal principal) { service.markRead(userId(principal), false, id); }

    private long userId(Principal principal) { return users.findByEmail(principal.getName()).orElseThrow().id(); }
}
