import { contextFor, jsonError, knownSnapshotIds, loadPlaces } from "../../../../lib/server/catalog";
import { contextTicket, contextTool, mintVoiceSession, readVoiceRequest, voiceInstructions } from "../../../../lib/server/voice";
import { voiceAccess } from "../../../../lib/server/voice-access";

export async function POST(request: Request): Promise<Response> {
  const denied = voiceAccess(request, "session"); if (denied) return denied;
  let selected;
  try { selected = readVoiceRequest(await request.json(), loadPlaces(), knownSnapshotIds()); }
  catch { return jsonError(400, "invalid-input", "Choose a known place, snapshot, mode and cutoff."); }
  const result = contextFor(selected); if ("error" in result) return result.error;
  const minted = await mintVoiceSession();
  if (!minted.ok) return jsonError(minted.status, "upstream-failure", minted.message);
  return Response.json({ token: minted.token, ticket: contextTicket(selected), expiresInSeconds: 60, sessionSeconds: 120, model: process.env.XAI_VOICE_MODEL ?? "grok-voice-latest", instructions: voiceInstructions(result.context), tools: [contextTool], contextVersion: result.context.contextVersion }, { headers: { "Cache-Control": "no-store" } });
}
