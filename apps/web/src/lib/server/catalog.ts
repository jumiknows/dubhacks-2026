import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildPlaceContext,
  buildSnapshotResponse,
  type ApiErrorBody,
  type Mode,
  type Place,
  type PlaceContext,
  type SourceStatus,
  type ThermalObservation,
} from "@emberready/domain";
import {
  FileSnapshotStore,
  FirmsLiveClient,
  findRepoRoot,
  parseFirmsCsv,
  sha256,
  sourceCodeFor,
  type LoadedSnapshot,
  type RegionConfig,
} from "@emberready/data";

interface LiveMemory {
  observations: ThermalObservation[];
  source: SourceStatus;
  asOf: string;
}

const liveMemory = new Map<string, LiveMemory>();

export function repoRoot(): string {
  return findRepoRoot(process.cwd());
}

export function loadPlaces(): Place[] {
  const file = path.join(repoRoot(), "data/places/wa-communities.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { places: Place[] };
  return parsed.places;
}

export function loadRegion(): RegionConfig {
  return JSON.parse(readFileSync(path.join(repoRoot(), "data/regions/wa-demo.json"), "utf8")) as RegionConfig;
}

export function replayStore(): FileSnapshotStore {
  return new FileSnapshotStore(repoRoot());
}

export function currentReplay(): LoadedSnapshot | null {
  return replayStore().getCurrent("firms-viirs-noaa20", "wa-demo");
}

export function knownSnapshotIds(): Set<string> {
  const ids = new Set(replayStore().list().map((snapshot) => snapshot.manifest.snapshotId));
  for (const id of liveMemory.keys()) ids.add(id);
  return ids;
}

export function jsonError(status: number, code: ApiErrorBody["error"]["code"], message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function placeById(placeId: string): Place | undefined {
  return loadPlaces().find((place) => place.id === placeId);
}

export function sourceFromSnapshot(snapshot: LoadedSnapshot): SourceStatus {
  const manifest = snapshot.manifest;
  const newest = snapshot.observations.at(-1)?.observedAt ?? null;
  return {
    provider: manifest.source.provider,
    product: manifest.source.product,
    sourceUrl: manifest.source.documentationUrl,
    fetchedAt: manifest.source.fetchedAt,
    newestObservationAt: newest,
    fetchStatus: "ok",
    coverageStatus: manifest.coverageStatus,
    requestRange: {
      regionId: manifest.scope.regionId,
      bbox: manifest.scope.bbox,
      windowStart: manifest.scope.windowStart,
      windowEnd: manifest.scope.windowEnd,
    },
  };
}

export function observationsFor(input: {
  mode: Mode;
  snapshotId?: string;
  asOf: string;
  generatedAt: string;
}): { response: ReturnType<typeof buildSnapshotResponse> } | { error: Response } {
  if (input.mode === "replay") {
    const snapshot = input.snapshotId ? replayStore().get(input.snapshotId) : currentReplay();
    if (!snapshot || snapshot.manifest.mode === "test" || snapshot.manifest.synthetic) {
      return { error: jsonError(404, "unavailable-snapshot", "The replay snapshot is not available.") };
    }
    return {
      response: buildSnapshotResponse({
        snapshotId: snapshot.manifest.snapshotId,
        mode: "replay",
        asOf: input.asOf,
        generatedAt: input.generatedAt,
        source: sourceFromSnapshot(snapshot),
        observations: snapshot.observations,
      }),
    };
  }
  return { error: jsonError(400, "invalid-input", "Use the live route for live mode.") };
}

export async function liveObservations(generatedAt: string): Promise<{ response: ReturnType<typeof buildSnapshotResponse> } | { error: Response }> {
  const region = loadRegion();
  const sourceCode = sourceCodeFor("firms-viirs-snpp");
  if (!sourceCode) return { error: jsonError(500, "upstream-failure", "The live source is not configured.") };
  const client = new FirmsLiveClient({ apiKey: process.env.FIRMS_MAP_KEY });
  const result = await client.fetchArea({ sourceCode, bbox: region.bbox, days: 1 });
  if (result.error === "missing-credential") {
    return { error: jsonError(503, "missing-credential", "FIRMS_MAP_KEY is not configured. Live observations are unavailable. Replay remains separate.") };
  }
  if (result.error === "timeout") {
    return { error: jsonError(504, "timeout", "The NASA FIRMS request timed out. Replay was not substituted.") };
  }
  if (!result.body || !result.fetchedAt || result.fetchStatus === "unavailable") {
    return { error: jsonError(502, "upstream-failure", "NASA FIRMS did not return a usable live feed. Replay was not substituted.") };
  }
  let parsed;
  try {
    parsed = parseFirmsCsv(result.body, {
      product: "VIIRS_SNPP_NRT",
      sourceId: "firms-viirs-snpp",
      rawSha256: sha256(Buffer.from(result.body)),
      bbox: region.bbox,
    });
  } catch {
    return { error: jsonError(502, "upstream-failure", "NASA FIRMS returned a response that could not be parsed.") };
  }
  if (parsed.quarantined.length > 0) {
    return { error: jsonError(502, "upstream-failure", "The live feed failed validation and was not published.") };
  }
  const observations = parsed.retained;
  const newest = observations.at(-1)?.observedAt ?? null;
  const snapshotId = sha256(result.body);
  const asOf = generatedAt;
  const source: SourceStatus = {
    provider: "NASA FIRMS",
    product: "VIIRS_SNPP_NRT",
    sourceUrl: result.sourceUrl,
    fetchedAt: result.fetchedAt,
    newestObservationAt: newest,
    fetchStatus: result.fetchStatus,
    coverageStatus: "unknown",
    requestRange: {
      regionId: region.id,
      bbox: region.bbox,
      windowStart: observations[0]?.observedAt ?? null,
      windowEnd: newest,
    },
  };
  liveMemory.set(snapshotId, { observations, source, asOf });
  return {
    response: buildSnapshotResponse({
      snapshotId,
      mode: "live",
      asOf,
      generatedAt,
      source,
      observations,
    }),
  };
}

export function contextFor(input: {
  placeId: string;
  snapshotId: string;
  asOf: string;
  mode: Mode;
}): { context: PlaceContext } | { error: Response } {
  const place = placeById(input.placeId);
  if (!place) return { error: jsonError(400, "invalid-input", "Unknown place.") };
  if (!input.asOf.endsWith("Z")) return { error: jsonError(400, "invalid-input", "asOf must be a UTC timestamp.") };
  if (input.mode === "replay") {
    const snapshot = replayStore().get(input.snapshotId);
    if (!snapshot || snapshot.manifest.synthetic) {
      return { error: jsonError(404, "unavailable-snapshot", "Unknown replay snapshot.") };
    }
    return {
      context: buildPlaceContext({
        place,
        snapshotId: snapshot.manifest.snapshotId,
        mode: "replay",
        asOf: input.asOf,
        observations: snapshot.observations,
        source: sourceFromSnapshot(snapshot),
      }),
    };
  }
  const live = liveMemory.get(input.snapshotId);
  if (!live) {
    return { error: jsonError(404, "unavailable-snapshot", "The live snapshot is not in this server process. Restart clears the in-memory live cache.") };
  }
  return {
    context: buildPlaceContext({
      place,
      snapshotId: input.snapshotId,
      mode: "live",
      asOf: input.asOf,
      observations: live.observations,
      source: live.source,
    }),
  };
}

export function provenanceFor(snapshotId: string): { provenance: Record<string, unknown> } | { error: Response } {
  const snapshot = replayStore().get(snapshotId);
  if (!snapshot) return { error: jsonError(404, "unavailable-snapshot", "Unknown snapshot.") };
  const manifest = snapshot.manifest;
  const quality = JSON.parse(readFileSync(path.join(repoRoot(), manifest.artifacts.quality.path), "utf8")) as {
    byConfidence: Record<string, number>;
    bySatellite: Record<string, number>;
    missingFrp: number;
    earliestObservedAt: string;
    latestObservedAt: string;
  };
  return {
    provenance: {
      snapshotId: manifest.snapshotId,
      datasetId: manifest.datasetId,
      datasetVersion: manifest.datasetVersion,
      mode: manifest.mode,
      synthetic: manifest.synthetic,
      source: manifest.source,
      scope: manifest.scope,
      counts: manifest.counts,
      qualityStatus: manifest.qualityStatus,
      coverageStatus: manifest.coverageStatus,
      attribution: manifest.attribution,
      quality: {
        byConfidence: quality.byConfidence,
        bySatellite: quality.bySatellite,
        missingFrp: quality.missingFrp,
        earliestObservedAt: quality.earliestObservedAt,
        latestObservedAt: quality.latestObservedAt,
      },
    },
  };
}
