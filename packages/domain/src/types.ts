export const SCHEMA_VERSION = "1.0" as const;
export const ATTENTION_RULE_VERSION = "1" as const;
export const REVIEW_KM = 5;
export const MONITOR_KM = 25;
export const ATTENTION_HOURS = 24;

export type Mode = "live" | "replay";
export type FetchStatus = "ok" | "stale" | "unavailable";
export type CoverageStatus = "unknown" | "provider-reported";
export type Confidence = "low" | "nominal" | "high";
export type AttentionBand = "unknown" | "review" | "monitor" | "no-signal";

export interface OfficialLink {
  label: string;
  url: string;
}

export interface Place {
  id: string;
  name: string;
  censusName: string;
  geoid: string;
  latitude: number;
  longitude: number;
  sourceUrl: string;
  sourceVintage: string;
  officialInfoLinks: OfficialLink[];
}

export interface ThermalObservation {
  id: string;
  sourceId: string;
  product: string;
  productVersion: string;
  satellite: string;
  latitude: number;
  longitude: number;
  observedAt: string;
  confidenceRaw: string;
  confidence: Confidence;
  rawRowId: string;
  frpMw: number | null;
}

export interface SourceStatus {
  provider: string;
  product: string;
  sourceUrl: string;
  fetchedAt: string | null;
  newestObservationAt: string | null;
  fetchStatus: FetchStatus;
  coverageStatus: CoverageStatus;
  requestRange: {
    regionId: string;
    bbox: [number, number, number, number];
    windowStart: string | null;
    windowEnd: string | null;
  };
}

export interface SnapshotWarning {
  code: string;
  message: string;
}

export interface SnapshotResponse {
  schemaVersion: typeof SCHEMA_VERSION;
  snapshotId: string;
  mode: Mode;
  asOf: string;
  generatedAt: string;
  sources: SourceStatus[];
  observations: ThermalObservation[];
  warnings: SnapshotWarning[];
}

export interface PlaceContext {
  contextVersion: string;
  placeId: string;
  snapshotId: string;
  mode: Mode;
  asOf: string;
  nearestObservationKm: number | null;
  matchingObservationIds: string[];
  countLast24h: number;
  attentionBand: AttentionBand;
  ruleVersion: typeof ATTENTION_RULE_VERSION;
  reasons: string[];
  sources: SourceStatus[];
  briefingText: string;
  officialInfoLinks: OfficialLink[];
}

export interface ApiErrorBody {
  error: {
    code: "missing-credential" | "invalid-input" | "upstream-failure" | "unavailable-snapshot" | "timeout";
    message: string;
  };
}
