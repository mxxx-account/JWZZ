package com.jwzz.server.report;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jwzz.server.report.ReportDraftModelGateway.Context;
import com.jwzz.server.report.ReportDraftModelGateway.Focus;
import com.jwzz.server.report.ReportDraftModelGateway.Opening;
import com.jwzz.server.report.ReportDraftModelGateway.Topic;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ReportDraftModelGatewayTest {
    private static final String AUTH = "SyntheticStageThreeSharedToken";
    private static final String GOOD = "{\"opening\":\"POLITE\",\"topics\":[\"MEASUREMENT_DETAILS\",\"FOLLOW_UP\"]}";
    private final ObjectMapper mapper = new ObjectMapper();
    private final AtomicReference<String> posted = new AtomicReference<>();
    private final AtomicReference<String> auth = new AtomicReference<>();
    private final AtomicReference<String> reply = new AtomicReference<>(GOOD);
    private HttpServer local;
    private ReportDraftModelGateway bridge;

    @BeforeEach
    void startFakePython() throws IOException {
        local = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        local.createContext("/v1/report-draft", this::answer);
        local.start();
        bridge = new ReportDraftModelGateway(mapper,
            "http://127.0.0.1:" + local.getAddress().getPort() + "/v1/report-draft", AUTH, 3000);
    }

    @AfterEach
    void stopFakePython() { local.stop(0); }

    @Test
    void sendsOnlyMinimizedContextAndParsesValidPlan() throws Exception {
        var result = bridge.request(new Context("HOME", false, Focus.MEASUREMENT)).orElseThrow();
        assertEquals(Opening.POLITE, result.opening());
        assertEquals(List.of(Topic.MEASUREMENT_DETAILS, Topic.FOLLOW_UP), result.topics());
        assertEquals("Bearer " + AUTH, auth.get());
        assertEquals(mapper.readTree("{\"context\":\"HOME\",\"hasComparableHistory\":false,\"focus\":\"MEASUREMENT\"}"),
            mapper.readTree(posted.get()));
    }

    @Test
    void rejectsUnverifiedComparisonWrongPrimaryExtraFieldsAndDuplicateTopics() {
        var request = new Context("HOME", false, Focus.MEASUREMENT);
        for (String bad : List.of(
            "{\"opening\":\"DIRECT\",\"topics\":[\"MEASUREMENT_DETAILS\",\"COMPARE_RECORDS\"]}",
            "{\"opening\":\"DIRECT\",\"topics\":[\"FOLLOW_UP\",\"MEASUREMENT_DETAILS\"]}",
            "{\"opening\":\"DIRECT\",\"topics\":[\"MEASUREMENT_DETAILS\",\"MEASUREMENT_DETAILS\"]}",
            "{\"opening\":\"DIRECT\",\"topics\":[\"MEASUREMENT_DETAILS\",\"SOMETHING_ELSE\"]}",
            GOOD.replace("}", ",\"draft\":\"unexpected\"}"))) {
            reply.set(bad);
            assertTrue(bridge.request(request).isEmpty(), bad);
        }
    }

    @Test
    void rejectsDuplicateKeysTrailingJsonAndOversizedResponse() {
        var request = new Context("HOME", false, Focus.MEASUREMENT);
        for (String bad : List.of(GOOD.replace("{", "{\"opening\":\"DIRECT\","),
                                  GOOD + "{}", GOOD + " ".repeat(2050))) {
            reply.set(bad);
            assertTrue(bridge.request(request).isEmpty());
        }
    }

    @Test
    void neverConnectsToNonLoopbackOrWhenTokenIsMissing() {
        var request = new Context("HOME", false, Focus.BALANCED);
        assertTrue(new ReportDraftModelGateway(mapper, "https://example.invalid:443/v1/report-draft", AUTH, 3000)
            .request(request).isEmpty());
        assertTrue(new ReportDraftModelGateway(mapper, "http://127.0.0.1:" + local.getAddress().getPort() + "/v1/report-draft", "", 3000)
            .request(request).isEmpty());
        assertNull(posted.get());
    }

    private void answer(HttpExchange exchange) throws IOException {
        try (exchange) {
            auth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            posted.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] bytes = reply.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
        }
    }
}
