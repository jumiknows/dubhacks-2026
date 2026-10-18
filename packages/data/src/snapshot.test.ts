import { describe, expect, it } from "vitest";
import { FileSnapshotStore, findRepoRoot } from "./index";

describe("checked-in Washington replay", () => {
  it("loads a real NOAA-20 VIIRS snapshot with reconciled hashes", () => {
    const store = new FileSnapshotStore(findRepoRoot(process.cwd()));
    const loaded = store.getCurrent("firms-viirs-noaa20", "wa-demo");
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.manifest.synthetic).toBe(false);
    expect(loaded.manifest.mode).toBe("replay");
    expect(loaded.manifest.coverageStatus).toBe("unknown");
    expect(loaded.manifest.source.availableAt).toBeNull();
    expect(loaded.observations.length).toBe(loaded.manifest.counts.retainedRows);
    expect(loaded.observations.every((observation) => observation.observedAt <= loaded.manifest.scope.asOf)).toBe(true);
    expect(loaded.observations.every((observation) => observation.latitude >= 45.5 && observation.latitude <= 49.05)).toBe(true);
    expect(loaded.observations.every((observation) => observation.longitude >= -124.85 && observation.longitude <= -116.9)).toBe(true);
  });
});
