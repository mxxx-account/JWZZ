package com.jwzz.server.pharmacy;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import org.junit.jupiter.api.Test;

class RegionResolverTest {
    private final RegionResolver resolver = new RegionResolver(new ObjectMapper(), "https://example.invalid/reverse");

    @Test void createsReadableRegionWithoutRepeatingMunicipality() throws IOException {
        assertEquals("湖北省 · 武汉市 · 洪山区", resolver.parseRegion("""
            {"address":{"state":"湖北省","city":"武汉市","city_district":"洪山区","road":"某路"}}
            """));
        assertEquals("北京市 · 海淀区", resolver.parseRegion("""
            {"address":{"state":"北京市","city":"北京市","city_district":"海淀区"}}
            """));
    }

    @Test void rejectsMissingAddressInsteadOfGuessing() {
        assertThrows(IOException.class, () -> resolver.parseRegion("{}"));
    }
}
