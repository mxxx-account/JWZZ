package com.jwzz.server.pharmacy;

import com.jwzz.server.auth.UserStore;
import com.jwzz.server.common.RequestRateLimiter;
import java.security.Principal;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/pharmacies")
public class PharmacyController {
    private final PharmacyLocator locator;
    private final UserStore users;
    private final RequestRateLimiter limiter;
    public PharmacyController(PharmacyLocator locator, UserStore users, RequestRateLimiter limiter) {
        this.locator = locator; this.users = users; this.limiter = limiter;
    }

    @GetMapping("/nearby")
    public PharmacyLocator.NearbyResult nearby(@RequestParam double lat, @RequestParam double lon, Principal principal) {
        if (!Double.isFinite(lat) || !Double.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid coordinates");
        var user = users.findByEmail(principal.getName())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        limiter.check("pharmacy-lookup", user.id(), 12);
        return locator.nearby(lat, lon);
    }
}
