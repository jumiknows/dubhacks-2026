import { contextFor, jsonError } from "../../../../lib/server/catalog";
import { readContextTicket } from "../../../../lib/server/voice";
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const selected = readContextTicket(body.ticket, body.arguments);
    const result = contextFor(selected);
    if ("error" in result) return result.error;
    return Response.json(result.context, { headers: { "Cache-Control": "no-store" } });
  } catch { return jsonError(400, "invalid-input", "The tool must use the selected context and an unexpired session."); }
}
