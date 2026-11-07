package com.jwzz.server.shop;

import com.jwzz.server.auth.UserStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
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
@RequestMapping("/api/merchant/conversations")
public class MerchantShopMessageController {
    public record MessageRequest(@NotBlank @Size(max = 2000) String body) {}
    private final UserStore users;
    private final ShopConversationService service;
    public MerchantShopMessageController(UserStore users, ShopConversationService service) {
        this.users = users; this.service = service;
    }

    @GetMapping
    public List<ShopConversationStore.Summary> list(Principal principal) {
        return service.list(merchantId(principal), true);
    }

    @GetMapping("/{id}")
    public ShopConversationStore.Detail detail(@PathVariable long id, Principal principal) {
        return service.detail(merchantId(principal), true, id);
    }

    @PostMapping("/{id}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    public ShopConversationStore.Message send(@PathVariable long id,
                                              @Valid @RequestBody MessageRequest request, Principal principal) {
        return service.send(merchantId(principal), true, id, request.body());
    }

    @PostMapping("/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void read(@PathVariable long id, Principal principal) {
        service.markRead(merchantId(principal), true, id);
    }

    private long merchantId(Principal principal) { return users.findByEmail(principal.getName()).orElseThrow().id(); }
}
