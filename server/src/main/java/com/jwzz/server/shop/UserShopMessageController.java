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
import org.springframework.web.bind.annotation.RequestParam;
import com.jwzz.server.common.ChatPage;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/shop")
public class UserShopMessageController {
    public record MessageRequest(@Size(max = 2000) String body,
        @jakarta.validation.constraints.Pattern(regexp="[A-Za-z0-9-]{8,64}") String clientMessageId) {}
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
    public ShopConversationStore.Detail detail(@PathVariable long id, Principal principal,
            @RequestParam(required=false) Long beforeId, @RequestParam(required=false) Long afterId,
            @RequestParam(defaultValue="50") int size) {
        return service.detail(userId(principal), false, id, beforeId, afterId, size);
    }

    @GetMapping("/conversations/page")
    public ChatPage<ShopConversationStore.Summary> page(Principal principal,
            @RequestParam(required=false) Long beforeId, @RequestParam(defaultValue="20") int size) {
        return service.page(userId(principal), false, beforeId, size);
    }

    @PostMapping("/conversations/{id}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    public ShopConversationStore.Message send(@PathVariable long id,
                                              @Valid @RequestBody MessageRequest request, Principal principal) {
        return service.send(userId(principal), false, id, request.body(), request.clientMessageId());
    }

    @PostMapping("/conversations/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void read(@PathVariable long id, Principal principal, @Valid @RequestBody ChatPage.ReadRequest request) {
        service.markRead(userId(principal), false, id, request.lastReadMessageId());
    }

    private long userId(Principal principal) { return users.findByEmail(principal.getName()).orElseThrow().id(); }
}
