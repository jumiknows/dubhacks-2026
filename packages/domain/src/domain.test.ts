import { describe, expect, it } from "vitest";
import {
  acceptsAudioResponse,
  buildPlaceContext,
  buildSnapshotResponse,
  changeSummary,
  contextVersion,
  destinationNorthKm,
  distanceKm,
  inAttentionWindow,
  parseFirmsAcquisition,
  type Place,
  type SourceStatus,
  type ThermalObservation,
} from "./index";

const place: Place = {
  id: "wa-test",
  name: "Test Place",
  censusName: "Test Place city",
  geoid: "0000000",
  latitude: 47,
  longitude: -120,
  sourceUrl: "https://example.com/gazetteer",
  sourceVintage: "2026",
  officialInfoLinks: [{ label: "Official", url: "https://mil.wa.gov/wildfire" }],
};

function source(fetchStatus: SourceStatus["fetchStatus"]): SourceStatus {
  return {
    provider: "NASA FIRMS",
    product: "VIIRS_NOAA20_NRT",
    sourceUrl: "https://firms.modaps.eosdis.nasa.gov/api/area/",
    fetchedAt: "2026-10-18T04:34:28Z",
    newestObservationAt: "2026-10-17T21:00:00Z",
    fetchStatus,
    coverageStatus: "unknown",
    requestRange: {
      regionId: "wa-demo",
      bbox: [-124.85, 45.5, -116.9, 49.05],
      windowStart: "2026-10-10T00:00:00Z",
      windowEnd: "2026-10-17T23:59:00Z",
    },
  };
}

function observation(partial: Partial<ThermalObservation> & Pick<ThermalObservation, "id" | "latitude" | "longitude" | "observedAt">): ThermalObservation {
  return {
    sourceId: "firms-viirs-noaa20",
    product: "VIIRS_NOAA20_NRT",
    productVersion: "2.0NRT",
    satellite: "N20",
    confidenceRaw: "nominal",
    confidence: "nominal",
    rawRowId: "raw:1",
    frpMw: 1.2,
    ...partial,
  };
}

describe("FIRMS time parsing", () => {
  it("parses midnight UTC and zero-padded HHMM", () => {
    expect(parseFirmsAcquisition("2026-10-10", "0000")).toBe("2026-10-10T00:00:00Z");
    expect(parseFirmsAcquisition("2026-10-10", "0954")).toBe("2026-10-10T09:54:00Z");
  });

  it("rejects unpadded HHMM and impossible dates", () => {
    expect(parseFirmsAcquisition("2026-10-10", "954")).toBeNull();
    expect(parseFirmsAcquisition("2026-02-31", "0000")).toBeNull();
  });

  it("uses a left-open 24 hour window and excludes future rows", () => {
    const asOf = "2026-10-17T12:00:00Z";
    expect(inAttentionWindow("2026-10-16T12:00:00Z", asOf)).toBe(false);
    expect(inAttentionWindow("2026-10-16T12:00:01Z", asOf)).toBe(true);
    expect(inAttentionWindow("2026-10-17T12:00:00Z", asOf)).toBe(true);
    expect(inAttentionWindow("2026-10-17T12:00:01Z", asOf)).toBe(false);
  });
});

describe("distance and attention bands", () => {
  it("agrees with an independent spherical distance for Seattle to Spokane", () => {
    const seattle = { latitude: 47.619335, longitude: -122.351538 };
    const spokane = { latitude: 47.666935, longitude: -117.433322 };
    const primary = distanceKm(seattle.latitude, seattle.longitude, spokane.latitude, spokane.longitude);
    const radius = 6371.0088;
    const φ1 = (seattle.latitude * Math.PI) / 180;
    const φ2 = (spokane.latitude * Math.PI) / 180;
    const Δλ = ((spokane.longitude - seattle.longitude) * Math.PI) / 180;
    const central = Math.acos(Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(Δλ));
    const independent = radius * central;
    expect(Math.abs(primary - independent)).toBeLessThan(0.01);
    expect(primary).toBeGreaterThan(350);
    expect(primary).toBeLessThan(400);
  });

  it("measures a northbound geodesic in kilometers", () => {
    const moved = destinationNorthKm(47, -120, 5);
    const distance = distanceKm(47, -120, moved.latitude, moved.longitude);
    expect(distance).toBeGreaterThan(4.99);
    expect(distance).toBeLessThan(5.01);
  });

  it("classifies the 5 km and 25 km boundaries", () => {
    const asOf = "2026-10-17T12:00:00Z";
    const cases: Array<[number, string]> = [
      [5, "review"],
      [5.05, "monitor"],
      [25, "monitor"],
      [25.05, "no-signal"],
    ];
    for (const [kilometers, band] of cases) {
      const point = destinationNorthKm(place.latitude, place.longitude, kilometers);
      const context = buildPlaceContext({
        place,
        snapshotId: "snap",
        mode: "replay",
        asOf,
        source: source("ok"),
        observations: [
          observation({
            id: `d-${kilometers}`,
            latitude: point.latitude,
            longitude: point.longitude,
            observedAt: "2026-10-17T11:00:00Z",
          }),
        ],
      });
      expect(context.attentionBand).toBe(band);
    }
  });

  it("keeps low confidence rows out of the band", () => {
    const point = destinationNorthKm(place.latitude, place.longitude, 1);
    const context = buildPlaceContext({
      place,
      snapshotId: "snap",
      mode: "replay",
      asOf: "2026-10-17T12:00:00Z",
      source: source("ok"),
      observations: [
        observation({
          id: "low",
          latitude: point.latitude,
          longitude: point.longitude,
          observedAt: "2026-10-17T11:00:00Z",
          confidence: "low",
          confidenceRaw: "low",
        }),
      ],
    });
    expect(context.attentionBand).toBe("no-signal");
    expect(context.countLast24h).toBe(0);
  });

  it("marks stale and unavailable live sources as unknown", () => {
    const point = destinationNorthKm(place.latitude, place.longitude, 1);
    for (const fetchStatus of ["stale", "unavailable"] as const) {
      const context = buildPlaceContext({
        place,
        snapshotId: "snap",
        mode: "live",
        asOf: "2026-10-17T12:00:00Z",
        source: source(fetchStatus),
        observations: [
          observation({
            id: fetchStatus,
            latitude: point.latitude,
            longitude: point.longitude,
            observedAt: "2026-10-17T11:00:00Z",
          }),
        ],
      });
      expect(context.attentionBand).toBe("unknown");
    }
  });
});

describe("briefing and replay", () => {
  it("uses different sentences for empty and unavailable data", () => {
    const empty = buildPlaceContext({
      place,
      snapshotId: "snap",
      mode: "replay",
      asOf: "2026-10-17T12:00:00Z",
      source: source("ok"),
      observations: [],
    });
    const unavailable = buildPlaceContext({
      place,
      snapshotId: "snap",
      mode: "live",
      asOf: "2026-10-17T12:00:00Z",
      source: source("unavailable"),
      observations: [],
    });
    expect(empty.briefingText).toContain("No nominal or high confidence");
    expect(unavailable.briefingText).toContain("source is unavailable");
    expect(empty.briefingText).not.toBe(unavailable.briefingText);
    expect(empty.briefingText).toContain("observation-time replay");
    expect(empty.briefingText).not.toContain("current weather is calm");
  });

  it("hides observations after the cutoff and counts the interval as observations", () => {
    const observations = [
      observation({ id: "old", latitude: 47, longitude: -120, observedAt: "2026-10-17T08:00:00Z" }),
      observation({ id: "new", latitude: 47, longitude: -120, observedAt: "2026-10-17T10:00:00Z" }),
      observation({ id: "future", latitude: 47, longitude: -120, observedAt: "2026-10-17T12:30:00Z" }),
    ];
    const response = buildSnapshotResponse({
      snapshotId: "snap",
      mode: "replay",
      asOf: "2026-10-17T11:00:00Z",
      generatedAt: "2026-10-18T04:40:00Z",
      source: source("ok"),
      observations,
    });
    expect(response.observations.map((item) => item.id)).toEqual(["old", "new"]);
    const summary = changeSummary(observations, "2026-10-17T09:00:00Z", "2026-10-17T11:00:00Z");
    expect(summary).toEqual({ count: 1, observationIds: ["new"] });
  });

  it("changes context version when the place changes so late audio can be ignored", () => {
    const first = contextVersion({ placeId: "a", snapshotId: "s", mode: "replay", asOf: "2026-10-17T11:00:00Z" });
    const second = contextVersion({ placeId: "b", snapshotId: "s", mode: "replay", asOf: "2026-10-17T11:00:00Z" });
    expect(first).not.toBe(second);
    expect(acceptsAudioResponse(second, first)).toBe(false);
    expect(acceptsAudioResponse(second, second)).toBe(true);
  });
});
