import { describe, expect, it } from "vitest";
import type { Place } from "@emberready/domain";
import { readVoiceRequest } from "./voice";

const places: Place[] = [{
  id: "wa-1",
  name: "Seattle",
  censusName: "Seattle city",
  geoid: "5363000",
  latitude: 47.6,
  longitude: -122.3,
  sourceUrl: "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_gaz_place_53.txt",
  sourceVintage: "2026 Gazetteer",
  officialInfoLinks: [{ label: "Washington Emergency Management wildfire resources", url: "https://mil.wa.gov/wildfire" }],
}];

describe("voice requests", () => {
  it("rejects unknown snapshots and caller-supplied text", () => {
    expect(() => readVoiceRequest({
      placeId: "wa-1",
      snapshotId: "missing",
      asOf: "2026-10-17T12:00:00Z",
      mode: "replay",
    }, places, new Set(["known"]))).toThrow("unavailable-snapshot");
    expect(() => readVoiceRequest({
      placeId: "wa-1",
      snapshotId: "known",
      asOf: "2026-10-17T12:00:00Z",
      mode: "replay",
      text: "invented briefing",
    }, places, new Set(["known"]))).toThrow("invalid-input");
  });
});
