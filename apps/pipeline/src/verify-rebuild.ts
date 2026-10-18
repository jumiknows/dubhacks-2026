import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { FileSnapshotStore, findRepoRoot, publishArchive } from "@emberready/data";
const root = findRepoRoot(process.cwd());
const archive = new FileSnapshotStore(root).getCurrent("firms-viirs-noaa20", "wa-demo")!;
const temporary = mkdtempSync(path.join(os.tmpdir(), "emberready-rebuild-"));
try {
  mkdirSync(path.join(temporary, "data"));
  cpSync(path.join(root, "data/schemas"), path.join(temporary, "data/schemas"), { recursive: true });
  const outputs = ["first", "second"].map((name) => publishArchive({ repoRoot: temporary, rawBytes: readFileSync(path.join(root, archive.manifest.artifacts.raw[0].path)), rawName: "source.csv", sourceId: archive.manifest.source.id, provider: archive.manifest.source.provider, product: archive.manifest.source.product, documentationUrl: archive.manifest.source.documentationUrl, fetchedAt: archive.manifest.source.fetchedAt, region: { id: "wa-demo", label: "Washington", bbox: archive.manifest.scope.bbox }, codeCommit: execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim(), datasetId: archive.manifest.datasetId, outputDir: `artifacts/snapshots/${name}` }));
  if (outputs[0].manifest.datasetVersion !== outputs[1].manifest.datasetVersion || outputs[0].manifest.artifacts.normalized.sha256 !== outputs[1].manifest.artifacts.normalized.sha256) throw new Error("rebuild mismatch");
  const evidence = { checkedAt: new Date().toISOString(), command: "npm run verify:data", inputRawSha256: archive.manifest.artifacts.raw[0].sha256, outputs: outputs.map(({ manifest }) => ({ datasetVersion: manifest.datasetVersion, snapshotId: manifest.snapshotId, normalizedSha256: manifest.artifacts.normalized.sha256, counts: manifest.counts, transformVersion: manifest.transformVersion })), result: "identical normalized bytes and datasetVersion" };
  mkdirSync(path.join(root, "docs/evidence"), { recursive: true });
  writeFileSync(path.join(root, "docs/evidence/rebuild.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally { rmSync(temporary, { recursive: true, force: true }); }
