package com.jwzz.server.merchant;

import com.jwzz.server.auth.UserStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.security.Principal;
import java.util.List;
import java.util.Set;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/merchant")
public class MerchantCatalogController {
    public record CreateRequest(Long templateId, @Size(max = 80) String name, String category,
                                @Size(max = 500) String description,
                                @NotNull @Min(1) @Max(100_000_000) Long priceCents) {}
    public record UpdateRequest(@NotBlank @Size(max = 80) String name,
                                @Size(max = 500) String description,
                                @NotNull @Min(1) @Max(100_000_000) Long priceCents) {}
    public record StatusRequest(@NotBlank String status) {}
    public record StockRequest(@NotNull @Min(0) @Max(1_000_000) Integer available,
                               @Size(max = 200) String note) {}

    private static final Set<String> CATEGORIES = Set.of("健康器械", "日常用品", "营养补充");
    private static final Set<String> STATUSES = Set.of("ON_SHELF", "OFF_SHELF", "ARCHIVED");
    private final UserStore users;
    private final MerchantStore stores;
    private final MerchantCatalogStore catalog;

    public MerchantCatalogController(UserStore users, MerchantStore stores, MerchantCatalogStore catalog) {
        this.users = users;
        this.stores = stores;
        this.catalog = catalog;
    }

    @GetMapping("/templates")
    public List<MerchantCatalogStore.Template> templates() { return catalog.templates(); }

    @GetMapping("/products")
    public List<MerchantCatalogStore.Product> products(Principal principal) {
        return catalog.products(storeId(principal));
    }

    @PostMapping("/products")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public MerchantCatalogStore.Product create(@Valid @RequestBody CreateRequest request, Principal principal) {
        long storeId = storeId(principal);
        String name;
        String category;
        String description;
        if (request.templateId() != null) {
            var template = catalog.template(request.templateId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown template"));
            name = template.name(); category = template.category(); description = template.description();
        } else {
            name = clean(request.name()); category = clean(request.category());
            description = clean(request.description());
            if (name.isBlank() || !CATEGORIES.contains(category))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid product name or category");
        }
        try {
            return catalog.create(storeId, request.templateId(), name, category, description, request.priceCents());
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Template already added to store");
        }
    }

    @PutMapping("/products/{skuId}")
    public MerchantCatalogStore.Product update(@PathVariable long skuId, @Valid @RequestBody UpdateRequest request,
                                               Principal principal) {
        String name = clean(request.name());
        if (name.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Product name is required");
        return catalog.update(storeId(principal), skuId, name, clean(request.description()), request.priceCents())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Product not found"));
    }

    @PutMapping("/products/{skuId}/status")
    public MerchantCatalogStore.Product status(@PathVariable long skuId, @Valid @RequestBody StatusRequest request,
                                               Principal principal) {
        if (!STATUSES.contains(request.status()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid product status");
        return catalog.setStatus(storeId(principal), skuId, request.status())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Product not found"));
    }

    @PutMapping("/products/{skuId}/inventory")
    @Transactional
    public MerchantCatalogStore.Product inventory(@PathVariable long skuId,
                                                  @Valid @RequestBody StockRequest request, Principal principal) {
        long merchantId = merchantId(principal);
        long storeId = storeId(merchantId);
        int before = catalog.lockAvailable(storeId, skuId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Product not found"));
        catalog.setAvailable(skuId, merchantId, before, request.available(), clean(request.note()));
        return catalog.product(storeId, skuId).orElseThrow();
    }

    @GetMapping("/products/{skuId}/inventory/ledger")
    public List<MerchantCatalogStore.Ledger> ledger(@PathVariable long skuId, Principal principal) {
        long storeId = storeId(principal);
        if (catalog.product(storeId, skuId).isEmpty())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Product not found");
        return catalog.ledger(storeId, skuId);
    }

    private long merchantId(Principal principal) {
        return users.findByEmail(principal.getName()).orElseThrow().id();
    }

    private long storeId(Principal principal) { return storeId(merchantId(principal)); }

    private long storeId(long merchantId) {
        return stores.ownedBy(merchantId).map(MerchantStore.Store::id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Create a store first"));
    }

    private String clean(String value) { return value == null ? "" : value.trim(); }
}
