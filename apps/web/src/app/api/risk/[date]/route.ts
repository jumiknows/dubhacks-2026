import { riskDay, riskSummary } from "../../../../lib/server/risk";

/** One day's ranking. A day that could not be scored returns 404 with its coverage. */
export async function GET(_request: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const day = riskDay(date);
  if (day) return Response.json(day, { headers: { "Cache-Control": "public, max-age=3600" } });
  const listed = riskSummary()?.dates[date];
  return Response.json(
    { error: { code: "unavailable-snapshot", message: listed ? `No ranking for ${date}: inputs were not available yet.` : `No ranking was produced for ${date}.` }, coverage: listed?.coverage ?? null },
    { status: 404 },
  );
}
