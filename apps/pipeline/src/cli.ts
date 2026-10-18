import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  FileSnapshotStore,
  FirmsLiveClient,
  findRepoRoot,
  publishArchive,
  sourceCodeFor,
  type RegionConfig,
} from "@emberready/data";

const SOURCES: Record<string, { product: string; provider: string; documentationUrl: string }> = {
  "firms-viirs-snpp": {
    product: "VIIRS_SNPP_NRT",
    provider: "NASA FIRMS",
    documentationUrl: "https://firms.modaps.eosdis.nasa.gov/api/area/",
  },
  "firms-viirs-noaa20": {
    product: "VIIRS_NOAA20_NRT",
    provider: "NASA FIRMS",
    documentationUrl: "https://firms.modaps.eosdis.nasa.gov/api/area/",
  },
};



function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readRegion(repoRoot: string, regionId: string): RegionConfig {
  if (regionId !== "wa-demo") fail("Only wa-demo is configured.");
  const regionPath = path.join(repoRoot, "data/regions", `${regionId}.json`);
  try {
    return JSON.parse(readFileSync(regionPath, "utf8")) as RegionConfig;
  } catch {
    fail(`Unknown region ${regionId}. Expected ${regionPath}`);
  }
}

function codeCommit(repoRoot: string): string {
  return execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
}

function writeRun(repoRoot: string, run: Record<string, unknown>): void {
  const directory = path.join(repoRoot, "artifacts/runs", String(run.runId));
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "run.json"), JSON.stringify(run, null, 2) + "\n");
}

async function ingest(repoRoot: string, values: Record<string, string | undefined>): Promise<void> {
  const sourceId = values.source;
  const regionId = values.region ?? "wa-demo";
  if (!sourceId || !SOURCES[sourceId]) fail("Pass --source firms-viirs-snpp or firms-viirs-noaa20.");
  const region = readRegion(repoRoot, regionId);
  const source = SOURCES[sourceId];
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const commit = codeCommit(repoRoot);
  try {
    let rawBytes: Buffer;
    let fetchedAt: string;
    let sourceUrl = source.documentationUrl;
    let mode: "replay" | "live" = "replay";
    let emptyWindow: { start: string; end: string; productVersion: string } | undefined;
    if (values.raw) {
      if (!values["fetched-at"]) throw new Error("Archive ingest requires --fetched-at.");
      fetchedAt = values["fetched-at"];
      rawBytes = readFileSync(path.resolve(repoRoot, values.raw));
      if (values["source-url"]) {
        const url = new URL(values["source-url"]);
        if (url.protocol !== "https:" || url.hostname !== "firms.modaps.eosdis.nasa.gov" || url.search || url.username || url.password || url.pathname.includes("/csv/" + process.env.FIRMS_MAP_KEY)) throw new Error("Use a public NASA source URL without credentials.");
        if (url.pathname.startsWith("/api/area/csv/")) throw new Error("Use the public API documentation URL.");
        sourceUrl = url.href;
      }
    } else {
      mode = "live";
      const days = Number(values.days ?? "1");
      const sourceCode = sourceCodeFor(sourceId)!;
      const result = await new FirmsLiveClient({ apiKey: process.env.FIRMS_MAP_KEY }).fetchArea({ sourceCode, bbox: region.bbox, days });
      if (result.error || result.body === null || !result.fetchedAt || result.fetchStatus !== "ok") throw new Error(`Live ingest failed: ${result.error ?? "unavailable"}`);
      rawBytes = Buffer.from(result.body);
      fetchedAt = result.fetchedAt;
      emptyWindow = { start: new Date(Date.parse(fetchedAt) - days * 86400000).toISOString(), end: fetchedAt, productVersion: "2.0NRT" };
    }
    const outputDir = `artifacts/snapshots/${runId}`;
    const published = publishArchive({
      repoRoot, rawBytes, rawName: "source.csv", sourceId, provider: source.provider, product: source.product,
      documentationUrl: sourceUrl, fetchedAt, region, codeCommit: commit, mode,
      datasetId: `${regionId}-${sourceId}`, outputDir, runId, emptyWindow,
    });
    writeRun(repoRoot, {
      runId, state: "published", startedAt, finishedAt: new Date().toISOString(), codeCommit: commit,
      transformVersion: published.manifest.transformVersion, sourceId, regionId,
      parameters: { input: values.raw ? "archive" : "provider", days: values.days ?? null },
      snapshotId: published.manifest.snapshotId, datasetVersion: published.manifest.datasetVersion, counts: published.manifest.counts,
    });
    console.log(JSON.stringify({ manifest: `${outputDir}/manifest.json`, snapshotId: published.manifest.snapshotId, datasetVersion: published.manifest.datasetVersion }));
  } catch (error) {
    writeRun(repoRoot, { runId, state: "failed", startedAt, finishedAt: new Date().toISOString(), codeCommit: commit, sourceId, regionId, error: "ingest-failed" });
    // Never include a provider URL, response body or credential in diagnostics.
    if (error instanceof Error && error.message.startsWith("Live ingest failed:")) fail(error.message);
    fail(`Ingest failed. Review artifacts/runs/${runId}. The previous snapshot remains current.`);
  }
}

function validate(repoRoot: string, manifestPath: string | undefined): void {
  if (!manifestPath) fail("Pass --manifest.");
  const absolute = path.resolve(repoRoot, manifestPath);
  const store = new FileSnapshotStore(repoRoot);
  const loaded = store.readManifest(absolute);
  console.log(`validated ${loaded.manifest.snapshotId} retained ${loaded.manifest.counts.retainedRows}`);
}

function replay(repoRoot: string, manifestPath: string | undefined): void {
  if (!manifestPath) fail("Pass --manifest.");
  const loaded = new FileSnapshotStore(repoRoot).readManifest(manifestPath);
  if (loaded.manifest.mode !== "replay") fail("Expected a replay manifest.");
  const { scope, counts, source } = loaded.manifest;
  console.log(JSON.stringify({
    snapshotId: loaded.manifest.snapshotId,
    mode: loaded.manifest.mode,
    synthetic: loaded.manifest.synthetic,
    regionId: scope.regionId,
    windowStart: scope.windowStart,
    asOf: scope.asOf,
    fetchedAt: source.fetchedAt,
    counts,
  }, null, 2));
}

function publish(repoRoot: string, values: Record<string, string | undefined>): void {
  if (!values.manifest) fail("Pass --manifest.");
  if (values.mode !== "replay" && values.mode !== "live") fail("Pass --mode replay or --mode live.");
  const store = new FileSnapshotStore(repoRoot);
  const loaded = store.readManifest(values.manifest);
  if (loaded.manifest.mode !== values.mode) fail("Manifest mode does not match.");
  store.setCurrent(loaded.manifest);
  console.log(`current ${loaded.manifest.snapshotId}`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      source: { type: "string" },
      region: { type: "string" },
      days: { type: "string" },
      raw: { type: "string" },
      manifest: { type: "string" },
      mode: { type: "string" },
      "fetched-at": { type: "string" },
      "source-url": { type: "string" },
    },
  });
  const repoRoot = findRepoRoot(process.cwd());
  if (command === "ingest") await ingest(repoRoot, values);
  else if (command === "validate") validate(repoRoot, values.manifest);
  else if (command === "replay") replay(repoRoot, values.manifest);
  else if (command === "publish") publish(repoRoot, values);
  else fail("Use ingest, validate, replay, or publish.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
