package com.jwzz.server.common;

import static org.junit.jupiter.api.Assertions.*;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class RequestRateLimiterTest {
    @Test void concurrentLocalChecksAllowOnlyConfiguredLimit() throws Exception {
        var limiter = new RequestRateLimiter(null, false);
        var pool = Executors.newFixedThreadPool(16);
        try {
            var tasks = IntStream.range(0, 50).<Callable<Boolean>>mapToObj(index -> () -> {
                try { limiter.check("concurrency-test", 987654321L, 10); return true; }
                catch (ResponseStatusException exception) { return false; }
            }).toList();
            long accepted = 0;
            for (var result : pool.invokeAll(tasks)) if (result.get()) accepted++;
            assertEquals(10, accepted);
        } finally { pool.shutdownNow(); }
    }
}
