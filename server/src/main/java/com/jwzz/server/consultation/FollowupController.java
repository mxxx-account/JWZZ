package com.jwzz.server.consultation;

import com.jwzz.server.auth.UserStore;
import jakarta.validation.Valid;
import java.security.Principal;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/followups")
public class FollowupController {
    public record ChangeRequest(Instant dueAt,Long reportId) {}
    private final FollowupService service;private final UserStore users;
    public FollowupController(FollowupService service,UserStore users) {this.service=service;this.users=users;}
    private UserStore.User actor(Principal principal) {return users.findByEmail(principal.getName()).orElseThrow(()->new ResponseStatusException(HttpStatus.UNAUTHORIZED));}
    @GetMapping public com.jwzz.server.common.ChatPage<FollowupService.Summary> page(Principal principal,@RequestParam(required=false) Long beforeId,@RequestParam(defaultValue="20") int size) {return service.page(actor(principal),beforeId,size);}
    @GetMapping("/{id}") public FollowupService.Detail detail(@PathVariable long id,Principal principal) {return service.detail(id,actor(principal));}
    @PostMapping("/{id}/close") public FollowupService.Detail close(@PathVariable long id,@Valid @RequestBody FollowupService.CloseRequest body,Principal principal) {return service.close(id,body,actor(principal));}
    @PostMapping("/{id}/tasks") public FollowupService.Detail add(@PathVariable long id,@Valid @RequestBody FollowupService.AddRequest body,Principal principal) {return service.add(id,body,actor(principal));}
    @PostMapping("/{id}/tasks/{task}/{action}") public FollowupService.Detail change(@PathVariable long id,@PathVariable long task,@PathVariable String action,@RequestBody ChangeRequest body,Principal principal) {return service.change(id,task,action,body.dueAt(),body.reportId(),actor(principal));}
}
