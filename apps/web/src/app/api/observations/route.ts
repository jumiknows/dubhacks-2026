import { jsonError, liveObservations, observationsFor } from "../../../lib/server/catalog";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  if (mode === "live") {
    const result = await liveObservations(generatedAt);
    if ("error" in result) return result.error;
    return Response.json(result.response);
  }
  if (mode !== "replay") return jsonError(400, "invalid-input", "mode must be live or replay.");
  const asOf = url.searchParams.get("asOf");
  if (!asOf || !asOf.endsWith("Z")) return jsonError(400, "invalid-input", "asOf must be a UTC timestamp.");
  const result = observationsFor({
    mode: "replay",
    snapshotId: url.searchParams.get("snapshotId") ?? undefined,
    asOf,
    generatedAt,
  });
  if ("error" in result) return result.error;
  return Response.json(result.response);
}
