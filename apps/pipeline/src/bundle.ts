import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FileSnapshotStore, findRepoRoot } from "@emberready/data";
import { readFileSync } from "node:fs";
const root = findRepoRoot(process.cwd());
const snapshot = new FileSnapshotStore(root, true).getCurrent("firms-viirs-noaa20", "wa-demo");
if (!snapshot || snapshot.manifest.mode !== "replay") throw new Error("Verified replay required for web bundle");
const quality = JSON.parse(readFileSync(path.join(root, snapshot.manifest.artifacts.quality.path), "utf8"));
writeFileSync(path.join(root, "apps/web/src/lib/server/replay.generated.json"), JSON.stringify({ manifest: snapshot.manifest, observations: snapshot.observations, quality }));
console.log(`Bundled verified replay ${snapshot.manifest.snapshotId}`);

// Research danger-zone rankings from research/wildfire/serve.py, checked against the grid before bundling.
const riskDir = path.join(root, "data/risk");
const riskOut = path.join(root, "apps/web/src/lib/server/risk.generated.json");
if (existsSync(path.join(riskDir, "index.json")) && existsSync(path.join(riskDir, "grid.json"))) {
  const index = JSON.parse(readFileSync(path.join(riskDir, "index.json"), "utf8"));
  const grid = JSON.parse(readFileSync(path.join(riskDir, "grid.json"), "utf8"));
  const cells = grid.cellIds.length;
  if (grid.polygons.length !== cells) throw new Error("Risk grid polygons and ids differ in length");
  const days: Record<string, unknown> = {};
  for (const file of readdirSync(riskDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))) {
    const day = JSON.parse(readFileSync(path.join(riskDir, file), "utf8"));
    for (const key of ["probability", "rank", "tier", "top"]) {
      if (day.cells?.[key]?.length !== cells) throw new Error(`${file}: ${key} does not match the ${cells}-cell grid`);
    }
    days[day.date] = day;
  }
  writeFileSync(riskOut, JSON.stringify({ index, grid, days }));
  console.log(`Bundled research risk rankings for ${Object.keys(days).length} days`);
} else {
  writeFileSync(riskOut, JSON.stringify({ index: null, grid: null, days: {} }));
  console.log("No research risk rankings found in data/risk");
}
