package com.jwzz.server.pharmacy;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.Test;

class PharmacyLocatorTest {
    private final PharmacyLocator locator = new PharmacyLocator(new ObjectMapper(), "https://example.invalid/api");

    @Test void parsesNodesAndWayCentersButSkipsMissingCoordinates() throws IOException {
        var places = locator.parsePlaces("""
            {"elements":[
              {"type":"node","id":1,"lat":30.5,"lon":114.4,"tags":{"name":"药店一","addr:street":"大学路","phone":"123"}},
              {"type":"way","id":2,"center":{"lat":30.51,"lon":114.41},"tags":{"name:zh":"药店二","opening_hours":"Mo-Fr 09:00-18:00"}},
              {"type":"way","id":3,"tags":{"name":"无坐标"}}
            ]}
            """);
        assertEquals(2, places.size());
        assertEquals("node/1", places.get(0).id());
        assertEquals("大学路", places.get(0).address());
        assertEquals("药店二", places.get(1).name());
        assertEquals("https://www.openstreetmap.org/way/2", places.get(1).osmUrl());
        assertThrows(IOException.class, () -> locator.parsePlaces("{}"));
    }

    @Test void distanceIsZeroAtSamePointAndSymmetric() {
        assertEquals(0, PharmacyLocator.distanceMeters(30.5, 114.4, 30.5, 114.4), 0.001);
        assertEquals(PharmacyLocator.distanceMeters(30.5, 114.4, 30.6, 114.5),
            PharmacyLocator.distanceMeters(30.6, 114.5, 30.5, 114.4), 0.001);
    }

    @Test void nearbySortsByDistanceAndExcludesOutsideRadius() {
        var far = new PharmacyLocator.Place("node/3", "太远", 30.7, 114.4, "", "", "", "");
        var middle = new PharmacyLocator.Place("node/2", "中间", 30.51, 114.4, "", "", "", "");
        var near = new PharmacyLocator.Place("node/1", "最近", 30.501, 114.4, "", "", "", "");
        var result = PharmacyLocator.nearbyFromPlaces(List.of(far, middle, near), 30.5, 114.4);
        assertEquals(2, result.pharmacies().size());
        assertEquals("最近", result.pharmacies().get(0).name());
        assertEquals("中间", result.pharmacies().get(1).name());
        assertTrue(result.pharmacies().get(0).distanceMeters() < result.pharmacies().get(1).distanceMeters());
    }
}
