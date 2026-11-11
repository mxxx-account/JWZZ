package com.jwzz.server.report;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
class ReportDraftModelGateway {
    enum Topic { CURRENT_REVIEW, MEASUREMENT_DETAILS, COMPARE_RECORDS, FOLLOW_UP }
    enum Opening { DIRECT, POLITE }
    enum Focus {
        BALANCED(null), MEASUREMENT(Topic.MEASUREMENT_DETAILS), COMPARISON(Topic.COMPARE_RECORDS), FOLLOW_UP(Topic.FOLLOW_UP);
        final Topic primary;
        Focus(Topic primary) { this.primary = primary; }
    }
    record Context(String context, boolean hasComparableHistory, Focus focus) {}
    record Plan(Opening opening, List<Topic> topics) {}

    private static final int MAX_RESPONSE_BYTES = 2048;
    private final Semaphore slots = new Semaphore(4);
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
        .proxy(ProxySelector.of(null)).followRedirects(HttpClient.Redirect.NEVER)
        .version(HttpClient.Version.HTTP_1_1).build();
    private final ObjectMapper mapper;
    private final ObjectReader reader;
    private final URI endpoint;
    private final String sharedToken;
    private final int timeoutMillis;

    ReportDraftModelGateway(ObjectMapper mapper, @Value("${app.agent.url}") String endpoint,
                            @Value("${app.agent.shared-token}") String sharedToken,
                            @Value("${app.agent.timeout-ms}") int timeoutMillis) {
        this.mapper = mapper;
        this.reader = mapper.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .with(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
        this.endpoint = loopbackEndpoint(endpoint);
        this.sharedToken = sharedToken;
        this.timeoutMillis = Math.max(1, Math.min(timeoutMillis, 7000));
    }

    Optional<Plan> request(Context context) {
        if (endpoint == null || !sharedToken.matches("[A-Za-z0-9._~+/=-]{1,256}") || !slots.tryAcquire())
            return Optional.empty();
        CompletableFuture<HttpResponse<byte[]>> pending = null;
        try {
            var request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofMillis(timeoutMillis))
                .header("Content-Type", "application/json").header("Accept", "application/json")
                .header("Authorization", "Bearer " + sharedToken)
                .POST(HttpRequest.BodyPublishers.ofByteArray(mapper.writeValueAsBytes(context))).build();
            pending = client.sendAsync(request, ignored -> new BoundedBody());
            var response = pending.get(timeoutMillis, TimeUnit.MILLISECONDS);
            String contentType = response.headers().firstValue("Content-Type").orElse("");
            if (response.statusCode() != 200 || !"application/json".equalsIgnoreCase(contentType.split(";", 2)[0].trim()))
                return Optional.empty();
            return parse(reader.readTree(response.body()), context);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        } catch (IOException | ExecutionException | TimeoutException | IllegalArgumentException exception) {
            return Optional.empty();
        } finally {
            if (pending != null && !pending.isDone()) pending.cancel(true);
            slots.release();
        }
    }

    private static Optional<Plan> parse(JsonNode json, Context context) {
        if (json == null || !json.isObject() || json.size() != 2 || !json.path("opening").isTextual())
            return Optional.empty();
        JsonNode topics = json.path("topics");
        if (!topics.isArray() || topics.size() != 2 || !topics.get(0).isTextual() || !topics.get(1).isTextual())
            return Optional.empty();
        Opening opening = Opening.valueOf(json.path("opening").textValue());
        Topic first = Topic.valueOf(topics.get(0).textValue()), second = Topic.valueOf(topics.get(1).textValue());
        if (first == second || (context.focus().primary != null && context.focus().primary != first)
            || (!context.hasComparableHistory() && (first == Topic.COMPARE_RECORDS || second == Topic.COMPARE_RECORDS)))
            return Optional.empty();
        return Optional.of(new Plan(opening, List.of(first, second)));
    }

    private static URI loopbackEndpoint(String value) {
        try {
            URI uri = URI.create(value);
            String host = uri.getHost();
            if (!"http".equals(uri.getScheme()) || host == null || !List.of("127.0.0.1", "[::1]").contains(host)
                || uri.getPort() < 1 || uri.getPort() > 65535 || !"/v1/report-draft".equals(uri.getRawPath())
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null)
                return null;
            return uri;
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private static final class BoundedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private Flow.Subscription subscription;
        @Override public CompletionStage<byte[]> getBody() { return result; }
        @Override public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            subscription.request(1);
        }
        @Override public void onNext(List<ByteBuffer> chunks) {
            for (ByteBuffer chunk : chunks) {
                if (chunk.remaining() > MAX_RESPONSE_BYTES - bytes.size()) {
                    subscription.cancel();
                    result.completeExceptionally(new IOException("Model bridge response is too large"));
                    return;
                }
                byte[] next = new byte[chunk.remaining()];
                chunk.get(next);
                bytes.writeBytes(next);
            }
            subscription.request(1);
        }
        @Override public void onError(Throwable error) { result.completeExceptionally(error); }
        @Override public void onComplete() { result.complete(bytes.toByteArray()); }
    }
}
