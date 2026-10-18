import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { FileSnapshotStore, type PublicationStage } from "./store";
import path from "node:path";
import { canonicalJson, sha256 } from "./hash";
import { parseFirmsCsv, type NormalizedObservation } from "./firms";
import { assertManifestShape, type SnapshotManifest } from "./manifest";

export const TRANSFORM_VERSION = "firms-normalize-2";

export interface RegionConfig {
  id: string;
  label: string;
  bbox: [number, number, number, number];
}

export interface PublishInput {
  repoRoot: string;
  rawBytes: Buffer;
  rawName: string;
  sourceId: string;
  provider: string;
  product: string;
  documentationUrl: string;
  fetchedAt: string;
  region: RegionConfig;
  codeCommit: string;
  mode?: "replay" | "live";
  datasetId: string;
  outputDir: string;
  runId?: string;
  emptyWindow?: { start: string; end: string; productVersion: string };
  onStage?: (stage: PublicationStage) => void;
}

export interface PublishedSnapshot {
  manifest: SnapshotManifest;
  observations: NormalizedObservation[];
  directory: string;
}

export function publishArchive(input: PublishInput): PublishedSnapshot {
  const runId = input.runId ?? randomUUID();
  const rawSha = sha256(input.rawBytes);
  const runDirectory = path.join(input.repoRoot, "artifacts/runs", runId);
  mkdirSync(runDirectory, { recursive: true });
  writeFileSync(path.join(runDirectory, "raw.csv"), input.rawBytes);
  const parsed = parseFirmsCsv(input.rawBytes.toString("utf8"), {
    product: input.product,
    sourceId: input.sourceId,
    rawSha256: rawSha,
    bbox: input.region.bbox,
  });
  writeFileSync(path.join(runDirectory, "quality-input.json"), JSON.stringify({
    rawRows: parsed.rawRows, excluded: parsed.excluded, quarantined: parsed.quarantined, duplicates: parsed.duplicates,
  }, null, 2));
  if (parsed.quarantined.length > 0 || parsed.conflicts > 0) {
    throw new Error(`publication blocked: ${parsed.quarantined.length} quarantined rows, ${parsed.conflicts} conflicts`);
  }
  const observations = parsed.retained;
  const times = observations.map((observation) => observation.observedAt).sort();
  if (times.length === 0 && !input.emptyWindow) throw new Error("empty archive requires an explicit window and product version");
  if (new Set(observations.map((row) => row.productVersion)).size > 1) throw new Error("mixed product revisions require review");
  const productVersion = observations[0]?.productVersion ?? input.emptyWindow!.productVersion;
  const windowStart = times[0] ?? input.emptyWindow!.start;
  const windowEnd = times.at(-1) ?? input.emptyWindow!.end;
  const normalized = Buffer.from(observations.map((observation) => canonicalJson(observation)).join("\n") + (observations.length ? "\n" : ""));
  const byReason: Record<string, number> = {};
  for (const row of parsed.excluded) byReason[row.reason] = (byReason[row.reason] ?? 0) + 1;
  const byConfidence: Record<string, number> = {};
  const bySatellite: Record<string, number> = {};
  const byAcquisitionDate: Record<string, number> = {};
  let missingFrp = 0;
  for (const observation of observations) {
    byConfidence[observation.confidence] = (byConfidence[observation.confidence] ?? 0) + 1;
    bySatellite[observation.satellite] = (bySatellite[observation.satellite] ?? 0) + 1;
    byAcquisitionDate[observation.observedAt.slice(0, 10)] = (byAcquisitionDate[observation.observedAt.slice(0, 10)] ?? 0) + 1;
    if (observation.frpMw === null) missingFrp += 1;
  }
  const quality = {
    counts: {
      rawRows: parsed.rawRows,
      retainedRows: observations.length,
      duplicateRows: parsed.duplicateRows,
      excludedRows: parsed.excluded.length,
      quarantinedRows: 0,
    },
    byReason,
    byConfidence,
    bySatellite,
    byAcquisitionDate,
    missingFrp,
    earliestObservedAt: windowStart,
    latestObservedAt: windowEnd,
    coverageStatus: "unknown",
  };
  const qualityBytes = Buffer.from(canonicalJson(quality));
  const normalizedSha = sha256(normalized);
  const qualitySha = sha256(qualityBytes);
  const rawArtifactPath = `${input.outputDir}/raw/${input.rawName}`;
  const normalizedPath = `${input.outputDir}/normalized.jsonl`;
  const qualityPath = `${input.outputDir}/quality.json`;
  const datasetVersion = sha256(canonicalJson({
    productVersions: [input.product, productVersion],
    rawHashes: [rawSha],
    transformVersion: TRANSFORM_VERSION,
    schemaVersion: "1.0",
    scope: {
      regionId: input.region.id,
      bbox: input.region.bbox,
      windowStart,
      windowEnd,
    },
    normalizedSha256: normalizedSha,
  }));
  const manifestWithoutId = {
    manifestVersion: "1.0" as const,
    datasetId: input.datasetId,
    datasetVersion,
    supersedesSnapshotId: null,
    runId,
    mode: input.mode ?? "replay",
    synthetic: false as const,
    source: {
      id: input.sourceId,
      provider: input.provider,
      product: input.product,
      productVersion,
      documentationUrl: input.documentationUrl,
      fetchedAt: input.fetchedAt,
      availableAt: null,
    },
    scope: {
      regionId: input.region.id,
      bbox: input.region.bbox,
      windowStart,
      windowEnd,
      asOf: windowEnd,
    },
    transformVersion: TRANSFORM_VERSION,
    codeCommit: input.codeCommit,
    artifacts: {
      raw: [{ path: rawArtifactPath, sha256: rawSha, bytes: input.rawBytes.byteLength }],
      normalized: { path: normalizedPath, sha256: normalizedSha, bytes: normalized.byteLength },
      quality: { path: qualityPath, sha256: qualitySha, bytes: qualityBytes.byteLength },
    },
    counts: quality.counts,
    qualityStatus: "passed" as const,
    coverageStatus: "unknown" as const,
    attribution: `NASA FIRMS ${input.product} thermal detections, filtered to ${input.region.label}.`,
  };
  const snapshotId = sha256(canonicalJson(manifestWithoutId));
  const manifest = { ...manifestWithoutId, snapshotId };
  const schemaPath = path.join(input.repoRoot, "data/schemas/snapshot-manifest.schema.json");
  assertManifestShape(manifest, schemaPath);

  const artifacts = new Map([
    [rawArtifactPath, input.rawBytes], [normalizedPath, normalized], [qualityPath, qualityBytes],
  ]);
  return new FileSnapshotStore(input.repoRoot).putVerified(manifest as SnapshotManifest, artifacts, input.onStage);
}
