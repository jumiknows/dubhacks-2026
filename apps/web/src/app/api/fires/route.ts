import { firesNear } from "../../../lib/server/evidence";

/** GET /api/fires?lat=&lon=&km= → NASA FIRMS detections in the last 24 hours near a point. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat")), lon = Number(params.get("lon")), km = Math.min(400, Number(params.get("km") ?? 200));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return Response.json({ error: { message: "lat and lon are required." } }, { status: 400 });
  try {
    const fires = await firesNear({ latitude: lat, longitude: lon }, km);
    return Response.json({ source: "NASA FIRMS VIIRS NOAA-20, last 24 hours, known industrial heat sources removed", fires });
  } catch {
    return Response.json({ error: { message: "NASA FIRMS is unavailable right now." } }, { status: 502 });
  }
}
