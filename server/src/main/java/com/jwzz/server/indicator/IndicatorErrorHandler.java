package com.jwzz.server.indicator;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice(assignableTypes = IndicatorController.class)
public class IndicatorErrorHandler {
    public record ErrorBody(String code, String message) {}

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ErrorBody> invalidInput(ResponseStatusException exception) {
        String message = exception.getStatusCode().value() == 400 && exception.getReason() != null
            ? exception.getReason() : "请求未能完成";
        return ResponseEntity.status(exception.getStatusCode())
            .body(new ErrorBody("INDICATOR_REQUEST_FAILED", message));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorBody> unreadableInput() {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(new ErrorBody("INVALID_INDICATOR_INPUT", "输入格式不正确，请核对数值和测量时间"));
    }
}
