import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSnapshotStore, findRepoRoot, publishArchive, sha256 } from "./index";
import type { PublicationStage } from "./store";

const repo = findRepoRoot(process.cwd());
const raw = readFileSync(path.join(repo, "data/replay/wa-viirs-noaa20-20261010/raw/J1_VIIRS_C2_USA_contiguous_and_Hawaii_7d.csv"));
const dirs: string[] = [];
function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), "emberready-publish-")); dirs.push(root);
  mkdirSync(path.join(root, "data/schemas"), { recursive: true });
  copyFileSync(path.join(repo, "data/schemas/snapshot-manifest.schema.json"), path.join(root, "data/schemas/snapshot-manifest.schema.json"));
  return root;
}
function publish(root: string, name: string, onStage?: (stage: PublicationStage) => void, rawBytes = raw) {
  return publishArchive({ repoRoot: root, rawBytes, rawName: "source.csv", sourceId: "firms-viirs-noaa20", provider: "NASA FIRMS", product: "VIIRS_NOAA20_NRT", documentationUrl: "https://firms.modaps.eosdis.nasa.gov/api/area/", fetchedAt: "2026-10-18T04:34:28Z", region: { id: "wa-demo", label: "Washington", bbox: [-124.85, 45.5, -116.9, 49.05] }, codeCommit: "38d003d86b526e4f5270e0508ee29b08bfd9bd69", datasetId: "wa-reproducibility-check", outputDir: `artifacts/snapshots/${name}`, onStage });
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("real archive publication and recovery", () => {
  it("reproduces normalized bytes and datasetVersion while preserving both immutable snapshots", () => {
    const root = setup(); const first = publish(root, "first"); const second = publish(root, "second");
    expect(first.manifest.datasetVersion).toBe(second.manifest.datasetVersion);
    expect(first.manifest.artifacts.normalized.sha256).toBe(second.manifest.artifacts.normalized.sha256);
    expect(first.manifest.snapshotId).not.toBe(second.manifest.snapshotId);
    const restarted = new FileSnapshotStore(root);
    expect(restarted.get(first.manifest.snapshotId)?.observations).toEqual(first.observations);
    expect(restarted.getCurrent("firms-viirs-noaa20", "wa-demo")?.manifest.snapshotId).toBe(second.manifest.snapshotId);
    expect(() => publish(root, "first")).toThrow("immutable");
    expect(sha256(readFileSync(path.join(first.directory, "normalized.jsonl")))).toBe(first.manifest.artifacts.normalized.sha256);
  });
  for (const stage of ["artifact", "manifest", "directory", "pointer"] as const) {
    it(`keeps the last good pointer after interruption at ${stage}`, () => {
      const root = setup(); const first = publish(root, "good");
      expect(() => publish(root, "interrupted", (seen) => { if (seen === stage) throw new Error("interrupted"); })).toThrow("interrupted");
      const restarted = new FileSnapshotStore(root);
      expect(restarted.getCurrent("firms-viirs-noaa20", "wa-demo")?.manifest.snapshotId).toBe(first.manifest.snapshotId);
      expect(restarted.get(first.manifest.snapshotId)?.observations.length).toBe(397);
    });
  }
  it("rejects failed parsing and corrupted published bytes without moving the pointer", () => {
    const root = setup(); const first = publish(root, "good");
    expect(() => publish(root, "bad", undefined, Buffer.from("<html>provider error</html>"))).toThrow();
    expect(new FileSnapshotStore(root).getCurrent("firms-viirs-noaa20", "wa-demo")?.manifest.snapshotId).toBe(first.manifest.snapshotId);
    writeFileSync(path.join(first.directory, "normalized.jsonl"), "{}\n");
    expect(new FileSnapshotStore(root).get(first.manifest.snapshotId)).toBeNull();
  });
});
