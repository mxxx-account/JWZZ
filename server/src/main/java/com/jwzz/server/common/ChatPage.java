package com.jwzz.server.common;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public record ChatPage<T>(List<T> items, boolean hasMore) {
    public static void validate(Long before, Long after, int size) {
        if ((before != null && before <= 0) || (after != null && after < 0)
            || (before != null && after != null) || size < 1 || size > 100)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid message cursor or page size");
    }
    public static <T> ChatPage<T> of(List<T> rows, int size, boolean reverse) {
        boolean more = rows.size() > size;
        var selected = new ArrayList<>(rows.subList(0, Math.min(rows.size(), size)));
        if (reverse) Collections.reverse(selected);
        return new ChatPage<>(selected, more);
    }
    public record ReadRequest(@jakarta.validation.constraints.NotNull
        @jakarta.validation.constraints.Positive Long lastReadMessageId) {}
}
