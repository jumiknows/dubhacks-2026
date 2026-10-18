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

import { afterEach, vi } from "vitest";
import { contextTicket, readContextTicket, mintVoiceSession, synthesizeBriefing } from "./voice";
import { voiceAccess } from "./voice-access";
afterEach(() => vi.unstubAllEnvs());
const selected = { placeId: "wa-1", snapshotId: "known", asOf: "2026-10-17T12:00:00Z", mode: "replay" as const };
const args = { placeId: selected.placeId, snapshotId: selected.snapshotId, asOf: selected.asOf };
describe("bounded Voice access and grounding", () => {
  it("requires site identity in private mode even when an access code remains configured", () => {
    vi.stubEnv("XAI_API_KEY", "synthetic-test-key");
    vi.stubEnv("VOICE_ACCESS_MODE", "private-site");
    vi.stubEnv("VOICE_ACCESS_TOKEN", "old-test-access");
    const endpoint = "https://demo.example/api/voice/briefing";
    expect(voiceAccess(new Request(endpoint, { headers: { Authorization: "Bearer old-test-access" } }), "speech")?.status).toBe(403);
    expect(voiceAccess(new Request(endpoint, { headers: { "oai-authenticated-user-id": "test-site-owner" } }), "speech")).toBeNull();
  });
  it("signs a context and rejects other places, snapshots, times, extra arguments and expiration", () => {
    vi.stubEnv("XAI_API_KEY", "synthetic-test-key");
    const ticket = contextTicket(selected, 1000);
    expect(readContextTicket(ticket, args, 1001)).toEqual(selected);
    for (const changed of [{ ...args, placeId: "other" }, { ...args, snapshotId: "other" }, { ...args, asOf: "2026-10-18T12:00:00Z" }, { ...args, mode: "live" }]) expect(() => readContextTicket(ticket, changed, 1001)).toThrow("context-mismatch");
    expect(() => readContextTicket(ticket + "broken", args, 1001)).toThrow("invalid-ticket");
    expect(() => readContextTicket(ticket, args, 181000)).toThrow("expired-ticket");
  });
  it("rejects invalid calendar timestamps", () => {
    expect(() => readVoiceRequest({ ...selected, asOf: "2026-02-30T12:00:00Z" }, places, new Set(["known"]))).toThrow("invalid-input");
  });
  it("fails closed without authorization and enforces a process quota", () => {
    vi.stubEnv("XAI_API_KEY", "synthetic-test-key"); vi.stubEnv("VOICE_ACCESS_TOKEN", "test-access"); vi.stubEnv("VOICE_ACCESS_MODE", "");
    expect(voiceAccess(new Request("https://demo.example/api/voice/session"), "session")?.status).toBe(403);
    expect(voiceAccess(new Request("https://demo.example/api/voice/session", { headers: { Authorization: "Bearer test-access", Origin: "https://other.example" } }), "session")?.status).toBe(403);
    const request = new Request("https://demo.example/api/voice/session", { headers: { Authorization: "Bearer test-access" } });
    for (let i = 0; i < 5; i += 1) expect(voiceAccess(request, "session")).toBeNull();
    expect(voiceAccess(request, "session")?.status).toBe(429);
  });
  it("handles missing credentials and provider failures without returning provider bodies", async () => {
    vi.stubEnv("XAI_API_KEY", ""); expect((await mintVoiceSession()).ok).toBe(false);
    vi.stubEnv("XAI_API_KEY", "synthetic-test-key");
    const reject = vi.fn(async () => new Response("secret-provider-error", { status: 401 })) as typeof fetch;
    expect(await mintVoiceSession(reject)).toMatchObject({ ok: false, status: 502 });
    expect(JSON.stringify(await synthesizeBriefing("Test", reject))).not.toContain("secret-provider-error");
    expect(await synthesizeBriefing("Test", vi.fn(async () => { throw new Error("timeout"); }) as typeof fetch)).toMatchObject({ ok: false, status: 502 });
  });
  it("uses documented token and speech request payloads", async () => {
    vi.stubEnv("XAI_API_KEY", "synthetic-test-key");
    const tokenFetch = vi.fn(async () => Response.json({ value: "synthetic-ephemeral-token" }));
    expect(await mintVoiceSession(tokenFetch)).toEqual({ ok: true, token: "synthetic-ephemeral-token" });
    const speechFetch = vi.fn(async () => new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "audio/mpeg" } }));
    expect((await synthesizeBriefing("Test", speechFetch)).ok).toBe(true);
  });
});
