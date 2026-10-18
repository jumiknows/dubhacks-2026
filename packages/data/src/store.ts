import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import { canonicalJson, sha256 } from "./hash";
import { assertManifestShape, assertRelativePath, type SnapshotManifest } from "./manifest";
import { parseFirmsCsv, type NormalizedObservation } from "./firms";

export interface LoadedSnapshot {
  manifest: SnapshotManifest;
  observations: NormalizedObservation[];
  directory: string;
}

export type PublicationStage = "artifact" | "manifest" | "directory" | "pointer";

export class FileSnapshotStore {
  constructor(private readonly repoRoot: string, private readonly readOnly = false) {}

  get(snapshotId: string): LoadedSnapshot | null {
    return this.list().find((item) => item.manifest.snapshotId === snapshotId) ?? null;
  }

  getCurrent(sourceId: string, regionId: string, mode: "replay" | "live" = "replay"): LoadedSnapshot | null {
    try {
      const pointer = JSON.parse(readFileSync(this.pointerPath(mode, sourceId, regionId), "utf8"));
      if (pointer.sourceId !== sourceId || pointer.regionId !== regionId) return null;
      const loaded = this.get(pointer.snapshotId);
      return loaded?.manifest.mode === mode ? loaded : null;
    } catch {
      return null;
    }
  }

  list(): LoadedSnapshot[] {
    const loaded: LoadedSnapshot[] = [];
    for (const root of ["data/replay", "artifacts/snapshots"]) {
      let entries: string[];
      try { entries = readdirSync(path.join(this.repoRoot, root)); } catch { continue; }
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const directory = path.join(this.repoRoot, root, entry);
        try {
          if (statSync(directory).isDirectory()) loaded.push(this.readManifest(path.join(directory, "manifest.json")));
        } catch { /* Incomplete or invalid directories are never visible to readers. */ }
      }
    }
    return loaded;
  }

  readManifest(manifestPath: string): LoadedSnapshot {
    const absolute = path.resolve(this.repoRoot, manifestPath);
    if (!absolute.startsWith(path.resolve(this.repoRoot) + path.sep)) throw new Error("manifest escaped repository");
    const manifest = JSON.parse(readFileSync(absolute, "utf8"));
    const artifacts = new Map<string, Buffer>();
    for (const artifact of [...manifest.artifacts.raw, manifest.artifacts.normalized, manifest.artifacts.quality]) {
      assertRelativePath(artifact.path);
      artifacts.set(artifact.path, readFileSync(path.join(this.repoRoot, artifact.path)));
    }
    const observations = this.verify(manifest, artifacts);
    return { manifest, observations, directory: path.dirname(absolute) };
  }

  putVerified(manifest: SnapshotManifest, artifacts: Map<string, Buffer>, onStage?: (stage: PublicationStage) => void): LoadedSnapshot {
    if (this.readOnly) throw new Error("read-only snapshot store");
    const observations = this.verify(manifest, artifacts);
    const directory = path.dirname(manifest.artifacts.normalized.path);
    if (!/^(data\/replay|artifacts\/snapshots)\/[^/.][^/]*$/.test(directory)) throw new Error("invalid snapshot directory");
    if ([...artifacts.keys()].some((key) => !key.startsWith(directory + "/"))) throw new Error("artifact outside snapshot");
    const destination = path.join(this.repoRoot, directory);
    if (existsSync(destination)) throw new Error("immutable snapshot directory already exists");
    const staging = path.join(path.dirname(destination), `.staging-${randomUUID()}`);
    mkdirSync(staging, { recursive: true });
    for (const [name, bytes] of artifacts) {
      const target = path.join(staging, path.relative(directory, name));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: "wx" });
      onStage?.("artifact");
    }
    writeFileSync(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    onStage?.("manifest");
    // Staging is a sibling, so rename is on the same filesystem. A single publisher owns this store.
    renameSync(staging, destination);
    onStage?.("directory");
    const loaded = this.readManifest(path.join(destination, "manifest.json"));
    this.setCurrent(loaded.manifest, onStage);
    return { manifest, observations, directory: destination };
  }

  setCurrent(manifest: SnapshotManifest, onStage?: (stage: PublicationStage) => void): void {
    if (this.readOnly) throw new Error("read-only snapshot store");
    if (manifest.synthetic || manifest.mode === "test") throw new Error("test snapshot cannot be published");
    const loaded = this.get(manifest.snapshotId);
    if (!loaded) throw new Error("snapshot is not verified");
    const pointerPath = this.pointerPath(manifest.mode, manifest.source.id, manifest.scope.regionId);
    mkdirSync(path.dirname(pointerPath), { recursive: true });
    const temporary = `${pointerPath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({
      sourceId: manifest.source.id,
      regionId: manifest.scope.regionId,
      snapshotId: manifest.snapshotId,
      manifestPath: path.relative(this.repoRoot, path.join(loaded.directory, "manifest.json")),
    }, null, 2) + "\n", { flag: "wx" });
    onStage?.("pointer");
    renameSync(temporary, pointerPath);
  }

  private pointerPath(mode: "live" | "replay", sourceId: string, regionId: string): string {
    if (!/^[a-z0-9-]+$/.test(sourceId) || !/^[a-z0-9-]+$/.test(regionId)) throw new Error("invalid pointer scope");
    return path.join(this.repoRoot, mode === "replay" ? "data/replay/current.json" : `artifacts/current/${sourceId}-${regionId}.json`);
  }

  private verify(value: unknown, artifacts: Map<string, Buffer>): NormalizedObservation[] {
    const manifest = assertManifestShape(value, path.join(this.repoRoot, "data/schemas/snapshot-manifest.schema.json"));
    if (manifest.synthetic || manifest.mode === "test") throw new Error("test snapshot cannot be published");
    const { snapshotId, ...identity } = manifest;
    if (sha256(canonicalJson(identity)) !== snapshotId) throw new Error("snapshot identity mismatch");
    for (const artifact of [...manifest.artifacts.raw, manifest.artifacts.normalized, manifest.artifacts.quality]) {
      const bytes = artifacts.get(artifact.path);
      if (!bytes || bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) throw new Error("artifact hash mismatch");
    }
    if (manifest.artifacts.raw.length !== 1) throw new Error("one raw product is supported");
    const raw = manifest.artifacts.raw[0];
    const parsed = parseFirmsCsv(artifacts.get(raw.path)!.toString("utf8"), {
      product: manifest.source.product, sourceId: manifest.source.id, rawSha256: raw.sha256, bbox: manifest.scope.bbox,
    });
    if (parsed.quarantined.length || parsed.conflicts) throw new Error("raw data failed quality gates");
    const normalized = parsed.retained.map((row) => canonicalJson(row)).join("\n") + (parsed.retained.length ? "\n" : "");
    if (normalized !== artifacts.get(manifest.artifacts.normalized.path)!.toString("utf8")) throw new Error("normalized data differs from raw transform");
    const actual = { rawRows: parsed.rawRows, retainedRows: parsed.retained.length, duplicateRows: parsed.duplicateRows, excludedRows: parsed.excluded.length, quarantinedRows: 0 };
    if (canonicalJson(actual) !== canonicalJson(manifest.counts)) throw new Error("retained or raw row count mismatch");
    const quality = JSON.parse(artifacts.get(manifest.artifacts.quality.path)!.toString("utf8"));
    if (canonicalJson(quality.counts) !== canonicalJson(actual)) throw new Error("quality counts mismatch");
    if (parsed.retained.some((row) => row.observedAt < manifest.scope.windowStart || row.observedAt > manifest.scope.windowEnd)) throw new Error("observation outside manifest window");
    const datasetVersion = sha256(canonicalJson({
      productVersions: [manifest.source.product, manifest.source.productVersion], rawHashes: [raw.sha256],
      transformVersion: manifest.transformVersion, schemaVersion: "1.0",
      scope: { regionId: manifest.scope.regionId, bbox: manifest.scope.bbox, windowStart: manifest.scope.windowStart, windowEnd: manifest.scope.windowEnd },
      normalizedSha256: manifest.artifacts.normalized.sha256,
    }));
    if (datasetVersion !== manifest.datasetVersion) throw new Error("dataset identity mismatch");
    return parsed.retained;
  }
}

export function findRepoRoot(start: string): string {
  let current = path.resolve(start);
  for (let i = 0; i < 6; i += 1) {
    try { statSync(path.join(current, "data/source-registry.json")); return current; }
    catch { const parent = path.dirname(current); if (parent === current) break; current = parent; }
  }
  throw new Error("repository root not found");
}
