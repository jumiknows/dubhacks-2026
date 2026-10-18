import { riskGrid, riskSummary } from "../../../lib/server/risk";

/** Model summary, the cell grid and which days have rankings. Static per deployment. */
export function GET() {
  const summary = riskSummary();
  const grid = riskGrid();
  if (!summary || !grid) {
    return Response.json({ error: { code: "unavailable-snapshot", message: "No research rankings are bundled with this build." } }, { status: 404 });
  }
  return Response.json({ summary, grid }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
