package com.jwzz.server.shop;

import com.jwzz.server.auth.UserStore;
import jakarta.validation.Valid;
import java.security.Principal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class FulfillmentController {
    private final FulfillmentService service;private final UserStore users;
    public FulfillmentController(FulfillmentService service,UserStore users) {this.service=service;this.users=users;}
    private UserStore.User actor(Principal p) {return users.findByEmail(p.getName()).orElseThrow();}
    @GetMapping({"/shop/orders/{id}/lifecycle","/merchant/orders/{id}/lifecycle"})
    public FulfillmentService.Detail detail(@PathVariable long id,Principal p) {return service.detail(id,actor(p));}
    @PostMapping("/merchant/orders/{id}/ship")
    public FulfillmentService.Detail ship(@PathVariable long id,@Valid @RequestBody FulfillmentService.Tracking body,Principal p) {return service.ship(id,body,actor(p));}
    @PostMapping("/shop/orders/{id}/receive")
    public FulfillmentService.Detail receive(@PathVariable long id,Principal p) {return service.receive(id,actor(p));}
    @PostMapping("/shop/orders/{id}/refunds")
    public FulfillmentService.Detail request(@PathVariable long id,@Valid @RequestBody FulfillmentService.Request body,Principal p) {return service.request(id,body,actor(p));}
    @PostMapping("/merchant/orders/{id}/refunds/{refund}/review")
    public FulfillmentService.Detail review(@PathVariable long id,@PathVariable long refund,@Valid @RequestBody FulfillmentService.Review body,Principal p) {return service.review(id,refund,body,actor(p));}
    @PostMapping("/shop/orders/{id}/refunds/{refund}/return")
    public FulfillmentService.Detail returnGoods(@PathVariable long id,@PathVariable long refund,@Valid @RequestBody FulfillmentService.Tracking body,Principal p) {return service.returnGoods(id,refund,body,actor(p));}
    @PostMapping("/merchant/orders/{id}/refunds/{refund}/inspect")
    public FulfillmentService.Detail inspect(@PathVariable long id,@PathVariable long refund,@Valid @RequestBody FulfillmentService.Inspection body,Principal p) {return service.inspect(id,refund,body,actor(p));}
}
