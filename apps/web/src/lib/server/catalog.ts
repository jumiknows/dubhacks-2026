import bundle from "./replay.generated.json";
import placeCatalog from "../../../../../data/places/wa-communities.json";
import regionCatalog from "../../../../../data/regions/wa-demo.json";
import {
  buildPlaceContext,
  parseUtc,
  validatePlaces,
  buildSnapshotResponse,
  type ApiErrorBody,
  type Mode,
  type Place,
  type PlaceContext,
  type SourceStatus,
  type ThermalObservation,
} from "@emberready/domain";
import {
  FirmsLiveClient,
  parseFirmsCsv,
  sha256,
  canonicalJson,
  sourceCodeFor,
  type LoadedSnapshot,
  type RegionConfig,
} from "@emberready/data";

interface LiveMemory {
  observations: ThermalObservation[];
  source: SourceStatus;
  asOf: string;
  rawSha256: string;
  counts: Record<string, number>;
}

const liveMemory = new Map<string, LiveMemory>();

const replay = bundle as unknown as LoadedSnapshot;
const places = validatePlaces(placeCatalog.places);
let liveClient: FirmsLiveClient | null = null;

export function loadPlaces(): Place[] { return places; }
export function loadRegion(): RegionConfig { return regionCatalog as RegionConfig; }
export function currentReplay(): LoadedSnapshot { return replay; }
function replayById(id: string): LoadedSnapshot | null { return id === replay.manifest.snapshotId ? replay : null; }
export function knownSnapshotIds(): Set<string> { return new Set([replay.manifest.snapshotId, ...liveMemory.keys()]); }

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
  if (parseUtc(input.asOf) === null) return { error: jsonError(400, "invalid-input", "asOf must be a valid UTC timestamp.") };
  if (input.mode === "replay") {
    const snapshot = input.snapshotId ? replayById(input.snapshotId) : currentReplay();
    if (!snapshot || snapshot.manifest.mode === "test" || snapshot.manifest.synthetic) {
      return { error: jsonError(404, "unavailable-snapshot", "The replay snapshot is not available.") };
    }
    if (input.asOf > snapshot.manifest.scope.asOf) return { error: jsonError(400, "invalid-input", "Cutoff exceeds this replay archive.") };
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
  const sourceId = process.env.FIRMS_MAP_KEY ? "firms-viirs-snpp" : "firms-viirs-noaa20";
  const sourceCode = sourceCodeFor(sourceId);
  if (!sourceCode) return { error: jsonError(500, "upstream-failure", "The live source is not configured.") };
  liveClient ??= new FirmsLiveClient({ apiKey: process.env.FIRMS_MAP_KEY });
  const result = await liveClient.fetchArea({ sourceCode, bbox: region.bbox, days: 1, publicFeed: !process.env.FIRMS_MAP_KEY });
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
      product: sourceCode,
      sourceId,
      rawSha256: sha256(Buffer.from(result.body)),
      bbox: region.bbox,
    });
  } catch {
    return { error: jsonError(502, "upstream-failure", "NASA FIRMS returned a response that could not be parsed.") };
  }
  if (parsed.quarantined.length > 0 || parsed.conflicts > 0) {
    return { error: jsonError(502, "upstream-failure", "The live feed failed validation and was not published.") };
  }
  const observations = parsed.retained;
  const newest = observations.at(-1)?.observedAt ?? null;
  const rawSha256 = sha256(result.body);
  const snapshotId = sha256(canonicalJson({ rawSha256, fetchedAt: result.fetchedAt, asOf: generatedAt, fetchStatus: result.fetchStatus, sourceCode }));
  const asOf = generatedAt;
  const source: SourceStatus = {
    provider: "NASA FIRMS",
    product: sourceCode,
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
  liveMemory.set(snapshotId, { observations, source, asOf, rawSha256, counts: { rawRows: parsed.rawRows, retainedRows: parsed.retained.length, excludedRows: parsed.excluded.length, duplicateRows: parsed.duplicateRows, quarantinedRows: parsed.quarantined.length } });
  while (liveMemory.size > 32) liveMemory.delete(liveMemory.keys().next().value!);
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
  if (parseUtc(input.asOf) === null) return { error: jsonError(400, "invalid-input", "asOf must be a UTC timestamp.") };
  if (input.mode === "replay") {
    const snapshot = replayById(input.snapshotId);
    if (!snapshot || snapshot.manifest.synthetic || snapshot.manifest.mode !== "replay") {
      return { error: jsonError(404, "unavailable-snapshot", "Unknown replay snapshot.") };
    }
    if (input.asOf > snapshot.manifest.scope.asOf) return { error: jsonError(400, "invalid-input", "Cutoff exceeds this replay archive.") };
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
  if (input.asOf !== live.asOf) return { error: jsonError(400, "invalid-input", "Live cutoff must match the immutable snapshot.") };
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
  const live = liveMemory.get(snapshotId);
  if (live) return { provenance: { snapshotId, mode: "live", synthetic: false, source: live.source, asOf: live.asOf, rawSha256: live.rawSha256, counts: live.counts, coverageStatus: "unknown", storage: "Process memory. Up to 32 snapshots, cleared at restart.", attribution: "NASA FIRMS thermal observations. Public US 24-hour file or keyed Area API, filtered to Washington." } };
  const snapshot = replayById(snapshotId);
  if (!snapshot) return { error: jsonError(404, "unavailable-snapshot", "Unknown snapshot.") };
  const manifest = snapshot.manifest;
  const quality = bundle.quality;
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
