package com.jwzz.server.merchant;

import com.jwzz.server.auth.UserStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.security.Principal;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;

@RestController
@RequestMapping("/api/merchant/store")
public class MerchantStoreController {
    public record StoreRequest(@NotBlank @Size(max = 80) String name,
                               @Size(max = 500) String description,
                               @NotBlank @Size(max = 80) String city,
                               @NotBlank @Size(max = 200) String address) {}

    private final UserStore users;
    private final MerchantStore stores;
    private final MerchantCatalogStore catalog;

    public MerchantStoreController(UserStore users, MerchantStore stores, MerchantCatalogStore catalog) {
        this.users = users;
        this.stores = stores;
        this.catalog = catalog;
    }

    @GetMapping
    public MerchantStore.Store mine(Principal principal) {
        return stores.ownedBy(merchantId(principal))
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Store not created"));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public MerchantStore.Store create(@Valid @RequestBody StoreRequest request, Principal principal) {
        long merchantId = merchantId(principal);
        try {
            var store = stores.create(merchantId, clean(request.name()), clean(request.description()),
                clean(request.city()), clean(request.address()));
            catalog.seedStarter(store.id());
            return store;
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Store already exists");
        }
    }

    @PutMapping
    public MerchantStore.Store update(@Valid @RequestBody StoreRequest request, Principal principal) {
        return stores.update(merchantId(principal), clean(request.name()), clean(request.description()),
            clean(request.city()), clean(request.address()))
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Store not created"));
    }

    private long merchantId(Principal principal) {
        return users.findByEmail(principal.getName()).orElseThrow().id();
    }

    private String clean(String value) { return value == null ? "" : value.trim(); }
}
