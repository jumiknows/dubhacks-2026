import { jsonError } from "../../../../lib/server/catalog";
import { mintVoiceSession } from "../../../../lib/server/voice";
import { voiceAccess } from "../../../../lib/server/voice-access";
import { shopInstructions, shopTools } from "../../../../lib/server/shop-voice";

/** A Grok Voice session for OrbiCart shopping. Same access control and quota as the fire briefing. */
export async function POST(request: Request): Promise<Response> {
  const denied = voiceAccess(request, "session"); if (denied) return denied;
  const minted = await mintVoiceSession();
  if (!minted.ok) return jsonError(minted.status, "upstream-failure", minted.message);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return Response.json({
    token: minted.token, expiresInSeconds: 60, sessionSeconds: 300,
    model: process.env.XAI_VOICE_MODEL ?? "grok-voice-latest",
    instructions: shopInstructions(today), tools: shopTools,
  }, { headers: { "Cache-Control": "no-store" } });
}
