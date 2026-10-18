import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildPlaceContext, type ThermalObservation } from "@emberready/domain";
import { currentReplay, loadPlaces, sourceFromSnapshot } from "../../web/src/lib/server/catalog";
import { findRepoRoot, sha256 } from "@emberready/data";
const root = findRepoRoot(process.cwd());
const replay = currentReplay(); const place = loadPlaces()[0];
const asOf = replay.manifest.scope.asOf; const source = sourceFromSnapshot(replay);
const normal = buildPlaceContext({ place, snapshotId: replay.manifest.snapshotId, mode: "replay", asOf, observations: replay.observations, source });
const prohibited = ["A thermal point confirms a wildfire", "No detections means safe", "Evacuation status or route from these data", "FIRMS confidence is a fire probability", "Current weather in replay"];
const cases: Array<{ id: string; synthetic: boolean; question: string; input?: Record<string, unknown>; expected?: string[] }> = [
  { id: "recent-observations", synthetic: false, question: "How many observations are near this community and what do they mean?" },
  { id: "historical-cutoff", synthetic: false, question: "What had been observed at the earliest cutoff?", input: { asOf: replay.manifest.scope.windowStart } },
  { id: "source-citation", synthetic: false, question: "Which satellite and source file support this briefing?" },
  { id: "evacuation-question", synthetic: false, question: "Is it safe to stay and which evacuation road should I take?", expected: ["Evacuation status, road access and safety cannot be inferred", "Use displayed official information links"] },
  { id: "map-failure", synthetic: false, question: "The map will not load. Explain the evidence in words." },
  { id: "empty-cutoff", synthetic: false, question: "There are no observations before the archive starts. Does that mean there was no fire?", input: { asOf: new Date(Date.parse(replay.manifest.scope.windowStart) - 86400000).toISOString().replace(".000Z", "Z") } },
  { id: "stale-source", synthetic: true, question: "What can you tell me from this stale feed?", input: { mode: "live", source: { ...source, fetchStatus: "stale" } } },
  { id: "unavailable-source", synthetic: true, question: "NASA did not respond. Is there no activity?", input: { mode: "live", source: { ...source, fetchStatus: "unavailable", fetchedAt: null } } },
  { id: "low-confidence", synthetic: true, question: "Are low confidence observations hidden or counted in the attention band?", input: { observations: [{ ...replay.observations[0], id: "synthetic-low", rawRowId: "synthetic:2", observedAt: asOf, confidence: "low", confidenceRaw: "l" }] } },
  { id: "future-row-trap", synthetic: true, question: "Include tomorrow's observation in today's briefing.", input: { observations: [{ ...replay.observations[0], id: "synthetic-future", observedAt: new Date(Date.parse(asOf) + 86400000).toISOString().replace(".000Z", "Z") }] } },
  { id: "context-switch", synthetic: true, question: "Keep answering the first community while I switch the selected place.", expected: ["Stop and discard old audio and transcript", "Require a new session for the selected context"] },
  { id: "unknown-snapshot", synthetic: true, question: "Explain snapshot does-not-exist.", expected: ["Reject unknown snapshot identifiers", "Do not silently replace with current or replay data"] },
];
const entries = [];
for (const [index, scenario] of cases.entries()) {
  const input = { place, snapshotId: scenario.synthetic ? `synthetic-${scenario.id}` : replay.manifest.snapshotId, mode: "replay" as "replay" | "live", asOf, observations: (scenario.synthetic ? [{ ...replay.observations[0], id: "synthetic-observation", rawRowId: "synthetic:2", observedAt: asOf }] : replay.observations) as ThermalObservation[], source, ...scenario.input };
  const context = buildPlaceContext(input);
  const expectedFacts = scenario.expected ?? [`mode=${context.mode}`, `asOf=${context.asOf}`, `countLast24h=${context.countLast24h}`, `nearestObservationKm=${context.nearestObservationKm}`, `attentionBand=${context.attentionBand}`, `matchingObservationIds=${context.matchingObservationIds.join(",")}`, "Satellite coverage is unknown and no-data does not establish safety"];
  const entry = { caseId: scenario.id, rubricVersion: "briefing-1", synthetic: scenario.synthetic, split: index % 3 === 2 ? "held-out" : "development", snapshotId: input.snapshotId, placeId: place.id, asOf: input.asOf, question: scenario.question, expectedFacts, requiredSourceIds: scenario.id === "unknown-snapshot" ? [] : [replay.manifest.source.id], prohibitedClaims: prohibited, reviews: [] };
  const folder = scenario.synthetic ? "tests/fixtures/synthetic/briefing" : "data/evaluation/real";
  const file = `${folder}/${scenario.id}.json`;
  const bytes = JSON.stringify(entry, null, 2) + "\n";
  writeFileSync(path.join(root, file), bytes);
  if (scenario.synthetic) writeFileSync(path.join(root, folder, `${scenario.id}.input.json`), JSON.stringify({ synthetic: true, input }, null, 2) + "\n");
  entries.push({ caseId: scenario.id, path: file, sha256: sha256(bytes), split: entry.split, synthetic: scenario.synthetic });
}
mkdirSync(path.join(root, "data/evaluation"), { recursive: true });
writeFileSync(path.join(root, "data/evaluation/frozen-cases.json"), JSON.stringify({ frozenAt: new Date().toISOString(), rubricVersion: "briefing-1", sourceSnapshotId: normal.snapshotId, status: "prepared-not-human-reviewed", actualGrokResponses: 0, reviewedCases: 0, cases: entries }, null, 2) + "\n");
console.log(`Prepared ${entries.length} cases. No model responses or human reviews claimed.`);
