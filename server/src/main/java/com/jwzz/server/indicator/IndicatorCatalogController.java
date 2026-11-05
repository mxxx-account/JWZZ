package com.jwzz.server.indicator;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/public/indicators")
public class IndicatorCatalogController {
    public record Item(String code, String name, String unit, String description) {}
    public record Catalog(String version, List<Item> items) {}
    private static final String VERSION = "catalog-2026-01";
    private static final String CACHE_KEY = "jwzz:indicator-catalog:" + VERSION;
    private static final Catalog CATALOG = new Catalog(VERSION, List.of(
        new Item("systolic_bp", "收缩压", "mmHg", "记录血压计显示的收缩压，并注明居家或诊室测量。"),
        new Item("diastolic_bp", "舒张压", "mmHg", "记录血压计显示的舒张压；须与收缩压为同一次测量。"),
        new Item("blood_glucose", "血糖", "mmol/L 或 mg/dL", "注明空腹、随机、餐后或指尖测量；不同条件不可直接混为一组趋势。"),
        new Item("hba1c", "糖化血红蛋白", "%", "按体检单原样录入；当前仅保存，不据此单项确诊。"),
        new Item("total_cholesterol", "总胆固醇", "mmol/L 或 mg/dL", "按体检单原样录入，并注明空腹状态。"),
        new Item("ldl_cholesterol", "LDL 胆固醇", "mmol/L 或 mg/dL", "按体检单原样录入；个体目标需由医生结合病史判断。"),
        new Item("hdl_cholesterol", "HDL 胆固醇", "mmol/L 或 mg/dL", "按体检单原样录入。"),
        new Item("triglycerides", "甘油三酯", "mmol/L 或 mg/dL", "按体检单原样录入，并注明空腹状态。")));

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final boolean redisEnabled;
    public IndicatorCatalogController(StringRedisTemplate redis, ObjectMapper mapper,
                                      @Value("${app.redis.enabled:false}") boolean redisEnabled) {
        this.redis = redis; this.mapper = mapper; this.redisEnabled = redisEnabled;
    }

    @GetMapping
    public ResponseEntity<Catalog> catalog() {
        if (redisEnabled) {
            try {
                String cached = redis.opsForValue().get(CACHE_KEY);
                if (cached != null) return response(mapper.readValue(cached, Catalog.class));
                redis.opsForValue().set(CACHE_KEY, mapper.writeValueAsString(CATALOG), Duration.ofMinutes(10));
            } catch (org.springframework.dao.DataAccessException | JsonProcessingException ignored) {
                // Public, non-sensitive reference data remains available if Redis is unavailable.
            }
        }
        return response(CATALOG);
    }

    private ResponseEntity<Catalog> response(Catalog catalog) {
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(Duration.ofMinutes(10)).cachePublic()).body(catalog);
    }
}
