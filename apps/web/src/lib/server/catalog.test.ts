import { describe, expect, it } from "vitest";
import { contextFor, currentReplay, observationsFor, loadPlaces, provenanceFor } from "./catalog";
describe("public snapshot routes", () => {
  const replay = currentReplay(); const place = loadPlaces()[0];
  it("rejects unknown places, snapshots, malformed cutoffs and mismatched modes", () => {
    const base = { placeId: place.id, snapshotId: replay.manifest.snapshotId, asOf: replay.manifest.scope.asOf, mode: "replay" as const };
    for (const input of [{ ...base, placeId: "unknown" }, { ...base, snapshotId: "unknown" }, { ...base, asOf: "invalidZ" }, { ...base, mode: "live" as const }]) expect(contextFor(input)).toHaveProperty("error");
  });
  it("keeps observation and context cutoffs aligned without future rows", () => {
    const asOf = replay.observations[0].observedAt;
    const observations = observationsFor({ mode: "replay", snapshotId: replay.manifest.snapshotId, asOf, generatedAt: "2026-10-18T00:00:00Z" });
    const context = contextFor({ placeId: place.id, snapshotId: replay.manifest.snapshotId, asOf, mode: "replay" });
    if (!("response" in observations) || !("context" in context)) throw new Error("missing replay");
    expect(observations.response.observations.every((row) => row.observedAt <= asOf)).toBe(true);
    expect(context.context.matchingObservationIds.every((id) => observations.response.observations.some((row) => row.id === id))).toBe(true);
    expect(context.context.briefingText).toContain("Current weather and current alerts are not included");
  });
  it("sanitizes provenance without paths or credentials", () => {
    const result = provenanceFor(replay.manifest.snapshotId);
    expect(result).toHaveProperty("provenance");
    expect(JSON.stringify(result)).not.toContain("data/replay/");
    expect(JSON.stringify(result)).not.toContain("MAP_KEY");
  });
});
