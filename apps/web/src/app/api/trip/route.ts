import { buildKit, type Trip } from "@emberready/domain";
import { gatherEvidence, geocode } from "../../../lib/server/evidence";

/**
 * POST /api/trip
 *   { destination, startDate (YYYY-MM-DD), nights, people, budget?, owned: string[], fireWarnings? }
 * → { trip, place, evidence, unavailable, kit }
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return error(400, "Send a JSON trip."); }
  const destination = typeof body.destination === "string" ? body.destination.trim().slice(0, 120) : "";
  const startDate = typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate) ? body.startDate : null;
  const nights = Number(body.nights ?? 2), people = Number(body.people ?? 1);
  if (!destination) return error(400, "Where are you going?");
  if (!startDate) return error(400, "startDate must be YYYY-MM-DD.");
  if (!Number.isInteger(nights) || nights < 0 || nights > 14) return error(400, "nights must be 0 to 14.");
  if (!Number.isInteger(people) || people < 1 || people > 12) return error(400, "people must be 1 to 12.");
  const trip: Trip = {
    destination, startDate, nights, people,
    budget: typeof body.budget === "number" && body.budget > 0 ? body.budget : null,
    owned: Array.isArray(body.owned) ? body.owned.filter((v): v is string => typeof v === "string").map((v) => v.slice(0, 60)).slice(0, 30) : [],
    fireWarnings: body.fireWarnings === true,
  };
  const place = await geocode(destination).catch(() => null);
  if (!place) return error(404, `Could not find "${destination}". Try a town or park name.`);
  const started = Date.now();
  const report = await gatherEvidence(place, trip);
  return Response.json({ trip, ...report, kit: buildKit(trip, report.evidence), tookMs: Date.now() - started });
}

function error(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}
