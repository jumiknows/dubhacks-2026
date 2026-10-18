import { describe, expect, it } from "vitest";
import { buildKit, compareKits, ownsItem, type Evidence, type EvidenceId, type Trip } from "./kit";

const trip: Trip = { destination: "Seattle", startDate: "2026-10-24", nights: 2, people: 2, budget: 200, owned: ["hiking boots"], fireWarnings: false };

function evidence(values: Partial<Record<EvidenceId, number>>) {
  const out: Partial<Record<EvidenceId, Evidence>> = {};
  for (const [id, value] of Object.entries(values)) {
    out[id as EvidenceId] = { id: id as EvidenceId, kind: "typical", label: id, value, unit: "", text: "", source: { name: "test", product: "test", url: "", period: "" } };
  }
  return out;
}

const seattle = evidence({ "typical.high": 15, "typical.low": 7, "typical.coldNight": 3, "typical.rainDays": 0.55, "typical.uv": 0.32, "typical.wind": 6, "terrain.relief": 120, "terrain.elevation": 60 });
const moab = evidence({ "typical.high": 32, "typical.low": 9, "typical.coldNight": 6, "typical.rainDays": 0.12, "typical.uv": 0.92, "typical.wind": 8, "terrain.relief": 420, "terrain.elevation": 1250 });

const ids = (kit: ReturnType<typeof buildKit>) => kit.items.map((item) => item.id);

describe("camping kit", () => {
  it("adds rain gear for Seattle and cites the NASA rain-day evidence", () => {
    const kit = buildKit(trip, seattle);
    const jacket = kit.items.find((item) => item.id === "rain-jacket");
    expect(jacket?.evidence).toEqual(["typical.rainDays"]);
    expect(jacket?.reason).toContain("55%");
    expect(jacket?.quantity).toBe(2);
    expect(ids(kit)).not.toContain("sun-kit");
    expect(ids(kit)).toContain("warm-layer");
  });

  it("swaps rain gear for sun and water in Moab", () => {
    const kit = buildKit(trip, moab);
    expect(ids(kit)).toEqual(expect.arrayContaining(["sun-kit", "water-capacity", "trekking-poles"]));
    expect(ids(kit)).not.toContain("rain-jacket");
  });

  it("explains what changed when the destination changes", () => {
    const changes = compareKits(buildKit(trip, seattle), buildKit(trip, moab));
    expect(changes.find((c) => c.id === "sun-kit")).toMatchObject({ change: "added" });
    expect(changes.find((c) => c.id === "rain-jacket")).toMatchObject({ change: "removed" });
    expect(changes.find((c) => c.id === "sun-kit")?.why).toContain("UV index");
  });

  it("drops what the user already owns and says so", () => {
    const kit = buildKit({ ...trip, owned: ["hiking boots", "a 2-person tent", "Headlamps"] }, seattle);
    expect(ids(kit)).not.toContain("tent");
    expect(ids(kit)).not.toContain("headlamp");
    expect(kit.skipped.map((s) => s.id)).toEqual(expect.arrayContaining(["tent", "headlamp"]));
    expect(kit.notes.join(" ")).toContain("boots");
  });

  it("protects owned boots after a wet week instead of selling new ones", () => {
    const kit = buildKit(trip, { ...moab, ...evidence({ "recent.rain7d": 40 }) });
    expect(kit.items.find((item) => item.id === "boot-care")?.evidence).toEqual(["recent.rain7d"]);
    // Mud on the trail is not rain during the trip: no rain jacket from recent rain alone.
    expect(ids(kit)).not.toContain("rain-jacket");
  });

  it("uses the elevation-corrected cold night instead of the raw grid value", () => {
    const kit = buildKit(trip, { ...moab, ...evidence({ "typical.coldNight": -3.5, "typical.siteLow": 0.3 }) });
    expect(kit.items.find((item) => item.id === "warm-layer")?.evidence).toEqual(["typical.siteLow", "terrain.elevation"]);
    expect(ids(kit)).not.toContain("beanie");
  });

  it("adds microspikes only when snow is common and the site gets cold enough", () => {
    expect(ids(buildKit(trip, { ...seattle, ...evidence({ "typical.snow": 0.05, "typical.siteLow": -4 }) }))).not.toContain("microspikes");
    // Snowy mountains in the same grid cell, but a mild site: no microspikes.
    expect(ids(buildKit(trip, { ...seattle, ...evidence({ "typical.snow": 0.6, "typical.siteLow": 3.4 }) }))).not.toContain("microspikes");
    const snowy = buildKit(trip, { ...seattle, ...evidence({ "typical.snow": 0.6, "typical.siteLow": -4 }) });
    expect(snowy.items.find((item) => item.id === "microspikes")?.evidence).toEqual(["typical.snow", "typical.siteLow", "terrain.elevation"]);
  });

  it("cites the colder of forecast and history for cold-weather gear", () => {
    const kit = buildKit(trip, { ...seattle, ...evidence({ "forecast.low": -2 }) });
    expect(kit.items.find((item) => item.id === "beanie")?.evidence).toEqual(["forecast.low"]);
    expect(kit.items.find((item) => item.id === "sleeping-bag")?.spec).toBe("Comfort rating -5°C or lower");
  });

  it("adds smoke protection only for a nearby fire", () => {
    expect(ids(buildKit(trip, { ...seattle, ...evidence({ "hazard.fireKm": 20 }) }))).toContain("smoke-mask");
    expect(ids(buildKit(trip, { ...seattle, ...evidence({ "hazard.fireKm": 140 }) }))).not.toContain("smoke-mask");
  });

  it("keeps working when evidence is missing", () => {
    const kit = buildKit(trip, {});
    expect(ids(kit)).toEqual(["tent", "sleeping-bag", "sleeping-pad", "headlamp", "stove", "water-filter", "first-aid"]);
    expect(kit.items.find((item) => item.id === "sleeping-bag")?.spec).toBeNull();
  });

  it("matches owned items by whole words", () => {
    expect(ownsItem(["chat app"], ["hat"])).toBeNull();
    expect(ownsItem(["Trekking Poles"], ["trekking poles"])).toBe("trekking poles");
  });
});
