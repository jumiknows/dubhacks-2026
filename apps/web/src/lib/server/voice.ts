import type { Mode, Place } from "@emberready/domain";

export interface VoiceRequest {
  placeId: string;
  snapshotId: string;
  asOf: string;
  mode: Mode;
}

export function readVoiceRequest(body: unknown, places: Place[], knownSnapshots: Set<string>): VoiceRequest {
  if (!body || typeof body !== "object") throw new Error("invalid-input");
  const record = body as Record<string, unknown>;
  const placeId = record.placeId;
  const snapshotId = record.snapshotId;
  const asOf = record.asOf;
  const mode = record.mode;
  if (typeof placeId !== "string" || !places.some((place) => place.id === placeId)) throw new Error("invalid-input");
  if (typeof snapshotId !== "string" || !knownSnapshots.has(snapshotId)) throw new Error("unavailable-snapshot");
  if (typeof asOf !== "string" || !asOf.endsWith("Z")) throw new Error("invalid-input");
  if (mode !== "live" && mode !== "replay") throw new Error("invalid-input");
  if ("text" in record || "url" in record) throw new Error("invalid-input");
  return { placeId, snapshotId, asOf, mode };
}

export async function mintVoiceSession(fetchImpl: typeof fetch = fetch): Promise<{ ok: true; token: unknown } | { ok: false; status: number; message: string }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 503, message: "XAI_API_KEY is not configured. Spoken Grok audio is unavailable." };
  }
  const response = await fetchImpl("https://api.x.ai/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expires_after: { seconds: 300 } }),
  });
  if (!response.ok) return { ok: false, status: 502, message: "The voice credential service rejected the request." };
  return { ok: true, token: await response.json() };
}

export async function synthesizeBriefing(text: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; audio: ArrayBuffer } | { ok: false; status: number; message: string }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 503, message: "XAI_API_KEY is not configured. The readable briefing is still available." };
  }
  const response = await fetchImpl("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, voice_id: "eve", language: "en" }),
  });
  if (!response.ok) return { ok: false, status: 502, message: "Grok text to speech did not return audio." };
  return { ok: true, audio: await response.arrayBuffer() };
}
