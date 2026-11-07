package com.jwzz.server.shop;

import com.jwzz.server.auth.UserStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.security.Principal;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/shop")
public class ShopController {
    public record AddRequest(@NotNull Long skuId, @NotNull @Min(1) @Max(99) Integer quantity) {}
    public record QuantityRequest(@NotNull @Min(1) @Max(99) Integer quantity) {}
    private static final Set<String> CATEGORIES = Set.of("", "健康器械", "日常用品", "营养补充");
    private static final Set<String> SORTS = Set.of("NEWEST", "PRICE_ASC", "PRICE_DESC");

    private final UserStore users;
    private final ShopStore shop;
    public ShopController(UserStore users, ShopStore shop) { this.users = users; this.shop = shop; }

    @GetMapping("/products")
    public ShopStore.Page search(@RequestParam(defaultValue = "") String query,
                                 @RequestParam(defaultValue = "") String category,
                                 @RequestParam(defaultValue = "NEWEST") String sort,
                                 @RequestParam(defaultValue = "0") int page,
                                 @RequestParam(defaultValue = "12") int size) {
        String cleaned = query.trim();
        if (cleaned.length() > 80 || !CATEGORIES.contains(category) || !SORTS.contains(sort)
            || page < 0 || page > 1000 || size < 1 || size > 30)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid search options");
        return shop.search(cleaned, category, sort, page, size);
    }

    @GetMapping("/products/{skuId}")
    public ShopStore.Offer product(@PathVariable long skuId) {
        return shop.offer(skuId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    @GetMapping("/cart")
    public List<ShopStore.CartItem> cart(Principal principal) { return shop.cart(userId(principal)); }

    @PostMapping("/cart/items")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public List<ShopStore.CartItem> add(@Valid @RequestBody AddRequest request, Principal principal) {
        long userId = userId(principal);
        shop.lockUser(userId);
        var offer = shop.offer(request.skuId())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Product unavailable"));
        var items = shop.cart(userId);
        if (!items.isEmpty() && items.get(0).storeId() != offer.storeId())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Cart contains another store");
        int current = items.stream().filter(item -> item.skuId() == offer.skuId())
            .mapToInt(ShopStore.CartItem::quantity).findFirst().orElse(0);
        int target = current + request.quantity();
        if (target > 99 || target > offer.available())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Requested quantity exceeds available stock");
        shop.add(userId, offer.skuId(), target);
        return shop.cart(userId);
    }

    @PutMapping("/cart/items/{itemId}")
    @Transactional
    public List<ShopStore.CartItem> update(@PathVariable long itemId,
                                           @Valid @RequestBody QuantityRequest request, Principal principal) {
        long userId = userId(principal);
        shop.lockUser(userId);
        var item = shop.cartItem(userId, itemId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        var offer = shop.offer(item.skuId())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "Product unavailable"));
        if (request.quantity() > offer.available())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Requested quantity exceeds available stock");
        shop.updateQuantity(userId, itemId, request.quantity());
        return shop.cart(userId);
    }

    @DeleteMapping("/cart/items/{itemId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void remove(@PathVariable long itemId, Principal principal) {
        long userId = userId(principal);
        shop.lockUser(userId);
        if (shop.remove(userId, itemId) == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }

    private long userId(Principal principal) {
        return users.findByEmail(principal.getName()).orElseThrow().id();
    }
}
