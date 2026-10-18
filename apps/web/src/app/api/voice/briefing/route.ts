import { contextFor, jsonError, knownSnapshotIds, loadPlaces } from "../../../../lib/server/catalog";
import { readVoiceRequest, synthesizeBriefing } from "../../../../lib/server/voice";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid-input", "Expected a JSON body.");
  }
  let voiceRequest;
  try {
    voiceRequest = readVoiceRequest(body, loadPlaces(), knownSnapshotIds());
  } catch (error) {
    const code = error instanceof Error && error.message === "unavailable-snapshot" ? "unavailable-snapshot" : "invalid-input";
    return jsonError(code === "unavailable-snapshot" ? 404 : 400, code, "The voice request did not match a known place and snapshot.");
  }
  const context = contextFor(voiceRequest);
  if ("error" in context) return context.error;
  const spoken = await synthesizeBriefing(context.context.briefingText);
  if (!spoken.ok) {
    return Response.json({
      contextVersion: context.context.contextVersion,
      briefingText: context.context.briefingText,
      audio: null,
      error: { code: spoken.status === 503 ? "missing-credential" : "upstream-failure", message: spoken.message },
    }, { status: spoken.status });
  }
  return new Response(spoken.audio, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "X-Context-Version": context.context.contextVersion,
    },
  });
}
