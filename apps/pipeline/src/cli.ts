import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  FileSnapshotStore,
  FirmsLiveClient,
  findRepoRoot,
  parseFirmsCsv,
  publishArchive,
  sha256,
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

const OUTPUT_DIR = "data/replay/wa-viirs-noaa20-20261010";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readRegion(repoRoot: string, regionId: string): RegionConfig {
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
  if (values.raw) {
    const fetchedAt = values["fetched-at"];
    if (!fetchedAt || !fetchedAt.endsWith("Z")) fail("Archive ingest requires --fetched-at with a UTC timestamp.");
    const rawPath = path.resolve(repoRoot, values.raw);
    const rawBytes = readFileSync(rawPath);
    const published = publishArchive({
      repoRoot,
      rawBytes,
      rawName: path.basename(rawPath),
      sourceId,
      provider: source.provider,
      product: source.product,
      documentationUrl: values["source-url"] ?? source.documentationUrl,
      fetchedAt,
      region,
      codeCommit: codeCommit(repoRoot),
      datasetId: "wa-viirs-noaa20-20261010",
      outputDir: OUTPUT_DIR,
    });
    writePointer(repoRoot, {
      sourceId,
      regionId,
      snapshotId: published.manifest.snapshotId,
      manifestPath: `${OUTPUT_DIR}/manifest.json`,
    });
    writeRun(repoRoot, {
      runId,
      state: "published",
      startedAt,
      finishedAt: new Date().toISOString(),
      sourceId,
      regionId,
      parameters: { raw: values.raw, fetchedAt },
      snapshotId: published.manifest.snapshotId,
      counts: published.manifest.counts,
    });
    console.log(path.join(repoRoot, OUTPUT_DIR, "manifest.json"));
    return;
  }

  const days = Number(values.days ?? "1");
  const client = new FirmsLiveClient({ apiKey: process.env.FIRMS_MAP_KEY });
  const sourceCode = sourceCodeFor(sourceId);
  if (!sourceCode) fail(`No FIRMS source code for ${sourceId}`);
  const result = await client.fetchArea({ sourceCode, bbox: region.bbox, days });
  if (result.error || !result.body || !result.fetchedAt) {
    writeRun(repoRoot, {
      runId,
      state: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      sourceId,
      regionId,
      parameters: { days },
      error: result.error,
    });
    fail(`Live ingest failed: ${result.error ?? "empty response"}. The current replay snapshot was left unchanged.`);
  }
  const rawBytes = Buffer.from(result.body);
  const parsed = parseFirmsCsv(result.body, {
    product: source.product,
    sourceId,
    rawSha256: sha256(rawBytes),
    bbox: region.bbox,
  });
  if (parsed.quarantined.length > 0) {
    writeRun(repoRoot, {
      runId,
      state: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      sourceId,
      regionId,
      parameters: { days },
      quarantined: parsed.quarantined.length,
    });
    fail(`Live ingest quarantined ${parsed.quarantined.length} rows. Nothing was published.`);
  }
  const published = publishArchive({
    repoRoot,
    rawBytes,
    rawName: `${sourceId}-${runId}.csv`,
    sourceId,
    provider: source.provider,
    product: source.product,
    documentationUrl: source.documentationUrl,
    fetchedAt: result.fetchedAt,
    region,
    codeCommit: codeCommit(repoRoot),
    mode: "live",
    datasetId: `${sourceId}-live`,
    outputDir: `artifacts/snapshots/${runId}`,
  });
  writeRun(repoRoot, {
    runId,
    state: "published",
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceId,
    regionId,
    parameters: { days },
    snapshotId: published.manifest.snapshotId,
    counts: published.manifest.counts,
  });
  console.log(published.manifest.snapshotId);
}

function validate(repoRoot: string, manifestPath: string | undefined): void {
  if (!manifestPath) fail("Pass --manifest.");
  const absolute = path.resolve(repoRoot, manifestPath);
  const store = new FileSnapshotStore(repoRoot);
  const manifest = JSON.parse(readFileSync(absolute, "utf8")) as { snapshotId: string };
  const loaded = store.get(manifest.snapshotId);
  if (!loaded) fail(`Snapshot ${manifest.snapshotId} failed validation or is not readable.`);
  console.log(`validated ${loaded.manifest.snapshotId} retained ${loaded.manifest.counts.retainedRows}`);
}

function replay(repoRoot: string, manifestPath: string | undefined): void {
  if (!manifestPath) fail("Pass --manifest.");
  const manifest = JSON.parse(readFileSync(path.resolve(repoRoot, manifestPath), "utf8")) as { snapshotId: string };
  const loaded = new FileSnapshotStore(repoRoot).get(manifest.snapshotId);
  if (!loaded) fail("Replay manifest could not be loaded.");
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

function writePointer(repoRoot: string, pointer: { sourceId: string; regionId: string; snapshotId: string; manifestPath: string }): void {
  const pointerPath = path.join(repoRoot, "data/replay/current.json");
  mkdirSync(path.dirname(pointerPath), { recursive: true });
  const temporary = `${pointerPath}.tmp`;
  writeFileSync(temporary, JSON.stringify(pointer, null, 2) + "\n");
  renameSync(temporary, pointerPath);
}

function publish(repoRoot: string, values: Record<string, string | undefined>): void {
  if (!values.manifest) fail("Pass --manifest.");
  if (values.mode !== "replay" && values.mode !== "live") fail("Pass --mode replay or --mode live.");
  const absolute = path.resolve(repoRoot, values.manifest);
  const manifest = JSON.parse(readFileSync(absolute, "utf8")) as { snapshotId: string; mode: string; source: { id: string }; scope: { regionId: string } };
  if (manifest.mode !== values.mode) fail(`Manifest mode is ${manifest.mode}.`);
  const loaded = new FileSnapshotStore(repoRoot).get(manifest.snapshotId);
  if (!loaded) fail("Refusing to point at a snapshot that does not validate.");
  writePointer(repoRoot, {
    sourceId: manifest.source.id,
    regionId: manifest.scope.regionId,
    snapshotId: manifest.snapshotId,
    manifestPath: path.relative(repoRoot, absolute).split(path.sep).join("/"),
  });
  console.log(`current ${manifest.snapshotId}`);
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
