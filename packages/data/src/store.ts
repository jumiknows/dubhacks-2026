import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { sha256 } from "./hash";
import { assertManifestShape, assertRelativePath, type SnapshotManifest } from "./manifest";
import type { NormalizedObservation } from "./firms";

export interface LoadedSnapshot {
  manifest: SnapshotManifest;
  observations: NormalizedObservation[];
  directory: string;
}

export class FileSnapshotStore {
  constructor(private readonly repoRoot: string) {}

  get(snapshotId: string): LoadedSnapshot | null {
    const found = this.list().find((item) => item.manifest.snapshotId === snapshotId);
    return found ?? null;
  }

  getCurrent(sourceId: string, regionId: string): LoadedSnapshot | null {
    const pointerPath = path.join(this.repoRoot, "data/replay/current.json");
    let pointer: { sourceId: string; regionId: string; snapshotId: string };
    try {
      pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
    } catch {
      return null;
    }
    if (pointer.sourceId !== sourceId || pointer.regionId !== regionId) return null;
    return this.get(pointer.snapshotId);
  }

  list(): LoadedSnapshot[] {
    const replayRoot = path.join(this.repoRoot, "data/replay");
    let entries: string[] = [];
    try {
      entries = readdirSync(replayRoot);
    } catch {
      return [];
    }
    const loaded: LoadedSnapshot[] = [];
    for (const entry of entries) {
      const directory = path.join(replayRoot, entry);
      if (!statSync(directory).isDirectory()) continue;
      const manifestPath = path.join(directory, "manifest.json");
      try {
        loaded.push(this.readDirectory(directory, manifestPath));
      } catch {
        continue;
      }
    }
    return loaded;
  }

  private readDirectory(directory: string, manifestPath: string): LoadedSnapshot {
    const schemaPath = path.join(this.repoRoot, "data/schemas/snapshot-manifest.schema.json");
    const manifest = assertManifestShape(JSON.parse(readFileSync(manifestPath, "utf8")), schemaPath);
    const artifacts = [...manifest.artifacts.raw, manifest.artifacts.normalized, manifest.artifacts.quality];
    for (const artifact of artifacts) {
      assertRelativePath(artifact.path);
      const absolute = path.resolve(this.repoRoot, artifact.path);
      const root = path.resolve(this.repoRoot);
      if (!absolute.startsWith(root + path.sep)) throw new Error("artifact escaped repository");
      const bytes = readFileSync(absolute);
      if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
        throw new Error(`artifact hash mismatch: ${artifact.path}`);
      }
    }
    const normalizedPath = path.resolve(this.repoRoot, manifest.artifacts.normalized.path);
    const observations = readFileSync(normalizedPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as NormalizedObservation);
    if (observations.length !== manifest.counts.retainedRows) throw new Error("retained row count mismatch");
    return { manifest, observations, directory };
  }
}

export function findRepoRoot(start: string): string {
  let current = path.resolve(start);
  for (let i = 0; i < 6; i += 1) {
    try {
      statSync(path.join(current, "data/source-registry.json"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error("repository root not found");
}
