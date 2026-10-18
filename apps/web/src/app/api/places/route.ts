import { loadPlaces } from "../../../lib/server/catalog";

export function GET(): Response {
  return Response.json({ places: loadPlaces() });
}
