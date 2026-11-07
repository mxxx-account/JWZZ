package com.jwzz.server.pharmacy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class RegionResolver {
    public record RegionResult(String label, String source) {}
    private record Cached(Instant expiresAt, RegionResult result) {}

    private final ObjectMapper mapper;
    private final String reverseUrl;
    private final ConcurrentHashMap<String, Cached> cache = new ConcurrentHashMap<>();
    private final Object rateLock = new Object();
    private volatile HttpClient client;
    private long lastUpstreamRequestMillis;

    public RegionResolver(ObjectMapper mapper,
                          @Value("${JWZZ_REVERSE_GEOCODE_URL:https://nominatim.openstreetmap.org/reverse}") String reverseUrl) {
        this.mapper = mapper;
        this.reverseUrl = reverseUrl;
    }

    public RegionResult resolve(double latitude, double longitude) {
        // Region-level precision is sufficient for the UI; never send raw GPS coordinates upstream.
        double lat = Math.round(latitude * 100d) / 100d;
        double lon = Math.round(longitude * 100d) / 100d;
        String key = String.format(Locale.ROOT, "%.2f,%.2f", lat, lon);
        Cached cached = cache.get(key);
        if (cached != null && cached.expiresAt().isAfter(Instant.now())) return cached.result();
        RegionResult result = fetch(lat, lon);
        if (cache.size() > 200) cache.clear();
        cache.put(key, new Cached(Instant.now().plus(Duration.ofHours(1)), result));
        return result;
    }

    private RegionResult fetch(double lat, double lon) {
        synchronized (rateLock) {
            long now = System.currentTimeMillis();
            if (now - lastUpstreamRequestMillis < 1000)
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Region lookup is temporarily busy");
            lastUpstreamRequestMillis = now;
        }
        if (client == null) client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();
        String url = String.format(Locale.ROOT,
            "%s?format=jsonv2&addressdetails=1&zoom=14&layer=address&lat=%.2f&lon=%.2f",
            reverseUrl, lat, lon);
        HttpRequest request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(8))
            .header("User-Agent", "JWZZ-student-project/1.0 (https://github.com/mxxx-account/JWZZ)")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.5")
            .GET().build();
        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) throw new IOException("Reverse geocoder status " + response.statusCode());
            String label = parseRegion(response.body());
            if (label.isBlank()) throw new IOException("No region in reverse geocoder response");
            return new RegionResult(label, "OPENSTREETMAP");
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "地区名称暂时无法解析", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "地区名称解析已中断", exception);
        }
    }

    String parseRegion(String json) throws IOException {
        JsonNode address = mapper.readTree(json).path("address");
        if (!address.isObject()) throw new IOException("Invalid reverse geocoder response");
        String state = first(address, "state", "province", "region");
        String city = first(address, "city", "municipality", "town", "county", "state_district");
        String district = first(address, "city_district", "district", "suburb", "borough", "county");
        List<String> parts = new ArrayList<>();
        for (String part : List.of(state, city, district)) {
            if (!part.isBlank() && !parts.contains(part)) parts.add(part);
        }
        if (parts.isEmpty()) {
            String country = address.path("country").asText("");
            if (!country.isBlank()) parts.add(country);
        }
        return String.join(" · ", parts);
    }

    private String first(JsonNode address, String... keys) {
        for (String key : keys) {
            String value = address.path(key).asText("").trim();
            if (!value.isBlank()) return value;
        }
        return "";
    }
}
