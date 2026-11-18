package com.jwzz.server.notification;

import com.jwzz.server.auth.UserStore;
import com.jwzz.server.common.ChatPage;
import java.security.Principal;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    public record Count(long unreadCount) {}
    private final UserStore users;
    private final NotificationStore notifications;
    public NotificationController(UserStore users,NotificationStore notifications) { this.users=users;this.notifications=notifications; }
    @GetMapping
    public ChatPage<NotificationStore.Item> page(Principal principal,@RequestParam(required=false) Long beforeId,
        @RequestParam(defaultValue="20") int size,@RequestParam(defaultValue="false") boolean unreadOnly) {
        return notifications.page(actor(principal),beforeId,size,unreadOnly);
    }
    @GetMapping("/unread-count") public Count unread(Principal principal) { return new Count(notifications.unread(actor(principal))); }
    @PostMapping("/{id}/read") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void read(Principal principal,@PathVariable long id) { notifications.read(actor(principal),id); }
    private long actor(Principal principal) {
        return users.findByEmail(principal.getName()).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED)).id();
    }
}
