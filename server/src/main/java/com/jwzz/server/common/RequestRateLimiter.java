package com.jwzz.server.common;

import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class RequestRateLimiter {
    private static final DefaultRedisScript<Long> INCREMENT = new DefaultRedisScript<>(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n", Long.class);
    private final StringRedisTemplate redis;
    private final boolean redisEnabled;
    private final ConcurrentHashMap<String, AtomicInteger> local = new ConcurrentHashMap<>();

    public RequestRateLimiter(StringRedisTemplate redis, @Value("${app.redis.enabled:false}") boolean redisEnabled) {
        this.redis = redis; this.redisEnabled = redisEnabled;
    }

    public void check(String action, long actorId, int maxPerMinute) {
        long window = Instant.now().getEpochSecond() / 60;
        String key = "jwzz:rate:" + action + ":" + actorId + ":" + window;
        long count;
        if (redisEnabled) {
            try {
                Long result = redis.execute(INCREMENT, java.util.List.of(key), "120");
                count = result == null ? localCount(key) : result;
            } catch (org.springframework.dao.DataAccessException exception) {
                count = localCount(key);
            }
        } else {
            count = localCount(key);
        }
        if (count > maxPerMinute)
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many requests; retry next minute");
    }

    private long localCount(String key) {
        if (local.size() > 10_000) {
            long previous = Instant.now().getEpochSecond() / 60 - 2;
            local.keySet().removeIf(item -> Long.parseLong(item.substring(item.lastIndexOf(':') + 1)) < previous);
        }
        return local.computeIfAbsent(key, ignored -> new AtomicInteger()).incrementAndGet();
    }
}
