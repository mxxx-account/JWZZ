package com.jwzz.server.pharmacy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class PharmacyLocator {
    public record Pharmacy(String id, String name, double latitude, double longitude, int distanceMeters,
                           String address, String openingHours, String phone, String osmUrl) {}
    public record NearbyResult(String source, int radiusMeters, List<Pharmacy> pharmacies) {}
    record Place(String id, String name, double latitude, double longitude,
                         String address, String openingHours, String phone, String osmUrl) {}
    private record Cached(Instant expiresAt, List<Place> places) {}

    private static final int RADIUS_METERS = 5000;
    private final ObjectMapper mapper;
    private volatile HttpClient client;
    private final ConcurrentHashMap<String, Cached> cache = new ConcurrentHashMap<>();
    private final String overpassUrl;

    public PharmacyLocator(ObjectMapper mapper,
                           @Value("${JWZZ_OVERPASS_URL:https://overpass-api.de/api/interpreter}") String overpassUrl) {
        this.mapper = mapper;
        this.overpassUrl = overpassUrl;
    }

    public NearbyResult nearby(double latitude, double longitude) {
        // Round to roughly 100 m: reduce third-party precision and share short-lived POI results.
        double queryLat = Math.round(latitude * 1000d) / 1000d;
        double queryLon = Math.round(longitude * 1000d) / 1000d;
        String key = String.format(Locale.ROOT, "%.3f,%.3f", queryLat, queryLon);
        Cached cached = cache.get(key);
        if (cached == null || cached.expiresAt().isBefore(Instant.now())) {
            List<Place> fetched = fetch(queryLat, queryLon);
            if (cache.size() > 200) cache.clear();
            cached = new Cached(Instant.now().plus(Duration.ofMinutes(10)), fetched);
            cache.put(key, cached);
        }
        return nearbyFromPlaces(cached.places(), latitude, longitude);
    }

    static NearbyResult nearbyFromPlaces(List<Place> places, double latitude, double longitude) {
        List<Pharmacy> sorted = places.stream()
            .map(place -> new Pharmacy(place.id(), place.name(), place.latitude(), place.longitude(),
                (int) Math.round(distanceMeters(latitude, longitude, place.latitude(), place.longitude())),
                place.address(), place.openingHours(), place.phone(), place.osmUrl()))
            .filter(place -> place.distanceMeters() <= RADIUS_METERS)
            .sorted(Comparator.comparingInt(Pharmacy::distanceMeters).thenComparing(Pharmacy::id))
            .limit(30).toList();
        return new NearbyResult("OPENSTREETMAP", RADIUS_METERS, sorted);
    }

    private List<Place> fetch(double latitude, double longitude) {
        if (client == null) client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();
        String query = String.format(Locale.ROOT,
            "[out:json][timeout:8];nwr[\"amenity\"=\"pharmacy\"](around:6000,%.3f,%.3f);out center;",
            latitude, longitude);
        String body = "data=" + URLEncoder.encode(query, StandardCharsets.UTF_8);
        HttpRequest request = HttpRequest.newBuilder(URI.create(overpassUrl))
            .timeout(Duration.ofSeconds(12))
            .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
            .header("User-Agent", "JWZZ-student-demo/1.0 (nearby pharmacy lookup)")
            .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) throw new IOException("Upstream status " + response.statusCode());
            return parsePlaces(response.body());
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "附近药店地图服务暂不可用，请稍后重试", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "附近药店地图服务请求已中断", exception);
        }
    }

    List<Place> parsePlaces(String json) throws IOException {
        JsonNode elements = mapper.readTree(json).path("elements");
        if (!elements.isArray()) throw new IOException("Invalid Overpass response");
        var places = new ArrayList<Place>();
        for (JsonNode element : elements) {
            String type = element.path("type").asText("");
            long osmId = element.path("id").asLong(0);
            JsonNode point = type.equals("node") ? element : element.path("center");
            double lat = point.path("lat").asDouble(Double.NaN);
            double lon = point.path("lon").asDouble(Double.NaN);
            if (osmId < 1 || !List.of("node", "way", "relation").contains(type)
                || !Double.isFinite(lat) || !Double.isFinite(lon)) continue;
            JsonNode tags = element.path("tags");
            String name = tags.path("name:zh").asText(tags.path("name").asText("未命名药店"));
            String address = tags.path("addr:full").asText("");
            if (address.isBlank()) address = String.join("", tags.path("addr:city").asText(""),
                tags.path("addr:street").asText(""), tags.path("addr:housenumber").asText(""));
            places.add(new Place(type + "/" + osmId, name, lat, lon, address,
                tags.path("opening_hours").asText(""), tags.path("phone").asText(""),
                "https://www.openstreetmap.org/" + type + "/" + osmId));
        }
        return places;
    }

    static double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
        double lat = Math.toRadians(lat2 - lat1);
        double lon = Math.toRadians(lon2 - lon1);
        double a = Math.pow(Math.sin(lat / 2), 2) + Math.cos(Math.toRadians(lat1))
            * Math.cos(Math.toRadians(lat2)) * Math.pow(Math.sin(lon / 2), 2);
        return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
