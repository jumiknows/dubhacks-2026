import { describe, expect, it } from "vitest";
import { parseTripRequest, upcomingSaturday } from "./trip-request";

const today = "2026-10-18"; // a Sunday

describe("parseTripRequest", () => {
  it("reads the demo sentence", () => {
    expect(parseTripRequest("I'm hiking near Seattle this weekend. I have $200, already own hiking boots, and need everything else. Find me the best deals.", today)).toEqual({
      destination: "Seattle", startDate: "2026-10-24", nights: 1, people: null, budget: 200, owned: ["hiking boots"],
    });
  });

  it("reads a destination with a state, several owned items and a group", () => {
    const trip = parseTripRequest("Camping in Moab, UT for 3 nights with 2 friends, budget 350 dollars. I already have a tent and my stove but need the rest.", today);
    expect(trip).toMatchObject({ destination: "Moab, UT", nights: 3, people: 3, budget: 350, owned: ["tent", "stove"] });
  });

  it("handles multi-word places and next weekend", () => {
    const trip = parseTripRequest("Taking my partner to Mount Rainier next weekend", today);
    expect(trip).toMatchObject({ destination: "Mount Rainier", startDate: "2026-10-31", people: 2 });
  });

  it("reads a place at the start of a short request", () => {
    expect(parseTripRequest("Moab, UT this weekend, $200, I own boots", today)).toMatchObject({ destination: "Moab, UT", startDate: "2026-10-24", budget: 200, owned: ["boots"] });
    expect(parseTripRequest("Mount Rainier for 2 nights", today)).toMatchObject({ destination: "Mount Rainier", nights: 2 });
    expect(parseTripRequest("I want to go camping", today).destination).toBeNull();
  });

  it("leaves unknown fields empty instead of guessing", () => {
    expect(parseTripRequest("help me pack", today)).toEqual({ destination: null, startDate: null, nights: null, people: null, budget: null, owned: [] });
  });

  it("finds the coming Saturday", () => {
    expect(upcomingSaturday("2026-10-18")).toBe("2026-10-24");
    expect(upcomingSaturday("2026-10-24")).toBe("2026-10-24");
  });
});
