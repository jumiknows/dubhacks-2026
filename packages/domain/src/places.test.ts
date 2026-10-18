import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validatePlaces } from "./places";
import catalog from "../../../data/places/wa-communities.json";
const places = catalog.places;
describe("reviewed Washington catalog", () => {
  it("matches every coordinate and ID to the 2026 Census source", () => {
    expect(validatePlaces(places)).toHaveLength(8);
    const rows = readFileSync("data/places/2026_gaz_place_53.txt", "utf8").trim().split(/\r?\n/).slice(1).map((line) => line.split("|").map((cell) => cell.trim()));
    for (const place of places) {
      const row = rows.find((cells) => cells[1] === place.geoid)!;
      expect(row).toBeDefined();
      expect(row[4]).toBe(place.censusName);
      expect(Number(row.at(-2))).toBe(place.latitude);
      expect(Number(row.at(-1))).toBe(place.longitude);
    }
  });
  it("rejects duplicate IDs and invalid coordinates", () => {
    expect(() => validatePlaces([places[0], ...places.slice(0, 7)])).toThrow("duplicate");
    expect(() => validatePlaces([{ ...places[0], latitude: 181 }, ...places.slice(1)])).toThrow("outside");
  });
});
