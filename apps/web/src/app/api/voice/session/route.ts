import { jsonError } from "../../../../lib/server/catalog";
import { mintVoiceSession } from "../../../../lib/server/voice";

export async function POST(): Promise<Response> {
  const minted = await mintVoiceSession();
  if (!minted.ok) return jsonError(minted.status, minted.status === 503 ? "missing-credential" : "upstream-failure", minted.message);
  return Response.json({
    expiresInSeconds: 300,
    model: process.env.XAI_VOICE_MODEL ?? "grok-voice-latest",
    credential: minted.token,
    note: "Use this short-lived credential from the browser. Do not log it. Conversational tool calling is not connected in this build.",
  });
}
