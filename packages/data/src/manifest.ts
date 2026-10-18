import { readFileSync } from "node:fs";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";

export interface ArtifactRef {
  path: string;
  sha256: string;
  bytes: number;
}

export interface SnapshotManifest {
  manifestVersion: "1.0";
  datasetId: string;
  datasetVersion: string;
  snapshotId: string;
  supersedesSnapshotId: string | null;
  runId: string;
  mode: "live" | "replay" | "test";
  synthetic: boolean;
  source: {
    id: string;
    provider: string;
    product: string;
    productVersion: string;
    documentationUrl: string;
    fetchedAt: string;
    availableAt: string | null;
  };
  scope: {
    regionId: string;
    bbox: [number, number, number, number];
    windowStart: string;
    windowEnd: string;
    asOf: string;
  };
  transformVersion: string;
  codeCommit: string;
  artifacts: {
    raw: ArtifactRef[];
    normalized: ArtifactRef;
    quality: ArtifactRef;
  };
  counts: {
    rawRows: number;
    retainedRows: number;
    duplicateRows: number;
    excludedRows: number;
    quarantinedRows: 0;
  };
  qualityStatus: "passed";
  coverageStatus: "unknown" | "provider-reported";
  attribution: string;
}

let validator: ValidateFunction | null = null;

export function manifestValidator(schemaPath: string): ValidateFunction {
  if (validator) return validator;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  validator = ajv.compile(schema);
  return validator;
}

export function assertManifestShape(manifest: unknown, schemaPath: string): SnapshotManifest {
  const validate = manifestValidator(schemaPath);
  if (!validate(manifest)) {
    const detail = (validate.errors ?? []).map((error: ErrorObject) => `${error.instancePath} ${error.message}`).join("; ");
    throw new Error(`manifest schema failed: ${detail}`);
  }
  const parsed = manifest as SnapshotManifest;
  const [west, south, east, north] = parsed.scope.bbox;
  if (!(west < east) || !(south < north)) throw new Error("invalid bbox");
  if (parsed.scope.windowStart > parsed.scope.windowEnd) throw new Error("window is reversed");
  if (parsed.scope.asOf !== parsed.scope.windowEnd) throw new Error("cutoff must equal the window end");
  const counts = parsed.counts;
  if (counts.rawRows !== counts.retainedRows + counts.duplicateRows + counts.excludedRows + counts.quarantinedRows) {
    throw new Error("counts do not reconcile");
  }
  const artifacts = [...parsed.artifacts.raw, parsed.artifacts.normalized, parsed.artifacts.quality];
  for (const artifact of artifacts) assertRelativePath(artifact.path);
  return parsed;
}

export function assertRelativePath(artifactPath: string): void {
  if (!artifactPath || artifactPath.startsWith("/") || artifactPath.includes("\\")) {
    throw new Error(`artifact path is not relative: ${artifactPath}`);
  }
  if (artifactPath.split("/").includes("..")) throw new Error(`artifact path escapes root: ${artifactPath}`);
  let parsed: URL | null = null;
  try {
    parsed = new URL(artifactPath);
  } catch {
    parsed = null;
  }
  if (parsed) throw new Error(`artifact path must not be a remote URL: ${artifactPath}`);
  if (path.posix.normalize(artifactPath) !== artifactPath) throw new Error(`artifact path is not normalized: ${artifactPath}`);
}
