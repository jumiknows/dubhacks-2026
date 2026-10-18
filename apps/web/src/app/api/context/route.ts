import { contextFor, jsonError } from "../../../lib/server/catalog";

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const placeId = url.searchParams.get("placeId");
  const snapshotId = url.searchParams.get("snapshotId");
  const asOf = url.searchParams.get("asOf");
  const mode = url.searchParams.get("mode");
  if (!placeId || !snapshotId || !asOf || (mode !== "live" && mode !== "replay")) {
    return jsonError(400, "invalid-input", "placeId, snapshotId, asOf, and mode are required.");
  }
  const result = contextFor({ placeId, snapshotId, asOf, mode });
  if ("error" in result) return result.error;
  return Response.json(result.context);
}
