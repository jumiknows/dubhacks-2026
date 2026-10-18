import { describe, expect, it } from "vitest";
import { riskDateFor } from "./risk";

describe("riskDateFor", () => {
  it("uses the cutoff's Pacific date, so a ranking never needs data from after the cutoff", () => {
    expect(riskDateFor("2026-10-17T20:49:00Z")).toBe("2026-10-17");
    // 05:00 UTC on the 17th is still the evening of the 16th in Washington.
    expect(riskDateFor("2026-10-17T05:00:00Z")).toBe("2026-10-16");
  });
});
