import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FirmsLiveClient, PUBLIC_NOAA20_URL } from "./live";
import { FirmsParseError, parseFirmsCsv } from "./firms";
import { assertManifestShape, assertRelativePath } from "./manifest";
import { findRepoRoot } from "./store";

const bbox: [number, number, number, number] = [-124.85, 45.5, -116.9, 49.05];
const header = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight";

function row(values: Partial<Record<string, string>>): string {
  const base: Record<string, string> = {
    latitude: "47.10000",
    longitude: "-120.10000",
    bright_ti4: "320.00",
    scan: "0.40",
    track: "0.38",
    acq_date: "2026-10-17",
    acq_time: "0954",
    satellite: "N20",
    confidence: "nominal",
    version: "2.0NRT",
    bright_ti5: "290.00",
    frp: "1.50",
    daynight: "D",
  };
  return header.split(",").map((name) => values[name] ?? base[name]).join(",");
}

function parse(body: string, window?: { windowStart?: string; windowEnd?: string }) {
  return parseFirmsCsv(`${header}\n${body}\n`, {
    product: "VIIRS_NOAA20_NRT",
    sourceId: "firms-viirs-noaa20",
    rawSha256: "abc",
    bbox,
    ...window,
  });
}

describe("FIRMS parser", () => {
  it("reads the synthetic edge fixture without treating it as NASA replay", () => {
    const text = readFileSync(new URL("../../../tests/fixtures/synthetic/firms-edges.csv", import.meta.url), "utf8");
    const result = parseFirmsCsv(text, {
      product: "VIIRS_NOAA20_NRT",
      sourceId: "synthetic",
      rawSha256: "synthetic",
      bbox,
    });
    expect(result.retained.map((item) => item.confidence)).toEqual(["nominal", "low"]);
    expect(result.retained[0].frpMw).toBeNull();
    expect(result.duplicateRows).toBe(1);
    expect(result.quarantined.map((item) => item.reason)).toEqual(["invalid-coordinate", "unknown-confidence"]);
  });

  it("keeps missing FRP as null and retains low confidence", () => {
    const result = parse([row({ frp: "" }), row({ latitude: "47.20000", confidence: "low", acq_time: "1000" })].join("\n"));
    expect(result.quarantined).toEqual([]);
    expect(result.retained.map((item) => item.frpMw)).toEqual([null, 1.5]);
    expect(result.retained[1].confidence).toBe("low");
  });

  it("counts an identical row once and quarantines conflicting duplicates", () => {
    const identical = parse([row({}), row({})].join("\n"));
    expect(identical.retained).toHaveLength(1);
    expect(identical.duplicateRows).toBe(1);
    const conflict = parse([row({ frp: "1.50" }), row({ frp: "4.00" })].join("\n"));
    expect(conflict.retained).toHaveLength(0);
    expect(conflict.conflicts).toBe(1);
    expect(conflict.quarantined.every((item) => item.reason === "conflicting-duplicate")).toBe(true);
  });

  it("quarantines unknown confidence and swapped coordinates without repairing them", () => {
    const result = parse([
      row({ confidence: "87" }),
      row({ latitude: "-120.10000", longitude: "47.10000", acq_time: "1100" }),
    ].join("\n"));
    expect(result.retained).toHaveLength(0);
    expect(result.quarantined.map((item) => item.reason)).toEqual(["unknown-confidence", "invalid-coordinate"]);
  });

  it("excludes rows outside the region and window", () => {
    const result = parse(
      [row({ latitude: "34.00000", longitude: "-118.00000" }), row({ acq_time: "0800" })].join("\n"),
      { windowStart: "2026-10-17T09:00:00Z", windowEnd: "2026-10-17T12:00:00Z" },
    );
    expect(result.excluded.map((item) => item.reason)).toEqual(["outside-region", "outside-window"]);
    expect(result.rawRows).toBe(result.retained.length + result.duplicateRows + result.excluded.length + result.quarantined.length);
  });

  it("accepts an empty headered file and rejects malformed bodies", () => {
    const empty = parseFirmsCsv(`${header}\n`, {
      product: "VIIRS_NOAA20_NRT",
      sourceId: "firms-viirs-noaa20",
      rawSha256: "abc",
      bbox,
    });
    expect(empty.rawRows).toBe(0);
    expect(() => parseFirmsCsv("<html>nope</html>", {
      product: "VIIRS_NOAA20_NRT",
      sourceId: "firms-viirs-noaa20",
      rawSha256: "abc",
      bbox,
    })).toThrow(FirmsParseError);
    expect(() => parseFirmsCsv("latitude,longitude\n1,2\n\"unterminated", {
      product: "VIIRS_NOAA20_NRT",
      sourceId: "firms-viirs-noaa20",
      rawSha256: "abc",
      bbox,
    })).toThrow(FirmsParseError);
  });
});

describe("live cache", () => {
  it("coalesces concurrent public requests and uses the fixed NOAA-20 URL", async () => {
    const urls: string[] = [];
    const client = new FirmsLiveClient({ apiKey: undefined, fetchImpl: (async (url) => {
      urls.push(String(url));
      return new Response(`${header}\n`);
    }) as typeof fetch });
    const request = { sourceCode: "VIIRS_NOAA20_NRT", bbox, days: 1, publicFeed: true };
    const results = await Promise.all([client.fetchArea(request), client.fetchArea(request)]);
    expect(urls).toEqual([PUBLIC_NOAA20_URL]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].fetchStatus).toBe("ok");
    await client.fetchArea(request);
    expect(urls).toHaveLength(1);
  });

  it("rejects invalid bounds, product and time before network access", async () => {
    let calls = 0;
    const client = new FirmsLiveClient({ apiKey: "secret-key", fetchImpl: (async () => {
      calls += 1;
      return new Response(`${header}\n`);
    }) as typeof fetch });
    const request = { sourceCode: "VIIRS_NOAA20_NRT", bbox, days: 1 };
    for (const invalid of [
      { ...request, bbox: [-180, -90, 180, 90] as typeof bbox },
      { ...request, bbox: [-120, 49, -121, 46] as typeof bbox },
      { ...request, bbox: [NaN, 46, -120, 47] as typeof bbox },
      { ...request, sourceCode: "../invalid" },
      { ...request, days: 0 },
      { ...request, days: 6 },
      { ...request, days: 1.5 },
      { ...request, publicFeed: true, days: 2 },
    ]) expect((await client.fetchArea(invalid)).error).toBe("upstream-failure");
    expect(calls).toBe(0);
  });

  it("recovers from a rate limit with at most one retry", async () => {
    let calls = 0;
    const client = new FirmsLiveClient({ apiKey: "secret-key", fetchImpl: (async () => {
      calls += 1;
      return calls === 1 ? new Response("slow down", { status: 429, headers: { "Retry-After": "0" } }) : new Response(`${header}\n`);
    }) as typeof fetch });
    const result = await client.fetchArea({ sourceCode: "VIIRS_NOAA20_NRT", bbox, days: 1 });
    expect(result.fetchStatus).toBe("ok");
    expect(calls).toBe(2);
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("stops after two transient failures and respects a longer provider wait", async () => {
    for (const retryAfter of ["0", "120"]) {
      let calls = 0;
      const client = new FirmsLiveClient({ apiKey: "secret-key", fetchImpl: (async () => {
        calls += 1;
        return new Response("unavailable", { status: 503, headers: { "Retry-After": retryAfter } });
      }) as typeof fetch });
      expect((await client.fetchArea({ sourceCode: "VIIRS_NOAA20_NRT", bbox, days: 1 })).error).toBe("upstream-failure");
      expect(calls).toBe(retryAfter === "0" ? 2 : 1);
    }
  });

  it("uses one total timeout across the retry delay", async () => {
    let calls = 0;
    const client = new FirmsLiveClient({ apiKey: undefined, timeoutMs: 10, fetchImpl: (async () => {
      calls += 1;
      return new Response("slow down", { status: 429, headers: { "Retry-After": "1" } });
    }) as typeof fetch });
    const result = await client.fetchArea({ sourceCode: "VIIRS_NOAA20_NRT", bbox, days: 1, publicFeed: true });
    expect(result.error).toBe("timeout");
    expect(result.sourceUrl).toBe(PUBLIC_NOAA20_URL);
    expect(calls).toBe(1);
  });

  it("times out and serves a stale cached body inside 15 minutes", async () => {
    let now = 1_000_000;
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return new Response(`${header}\n`, { status: 200 });
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as typeof fetch;
    const client = new FirmsLiveClient({
      apiKey: "secret-key",
      fetchImpl,
      now: () => now,
      cacheMs: 10 * 60 * 1000,
      staleMs: 15 * 60 * 1000,
      timeoutMs: 5,
    });
    const ok = await client.fetchArea({ sourceCode: "VIIRS_NOAA20_NRT", bbox, days: 1 });
    expect(ok.fetchStatus).toBe("ok");
    expect(ok.sourceUrl).not.toContain("secret-key");
    now += 11 * 60 * 1000;
    const stale = await client.fetchArea({ sourceCode: "VIIRS_NOAA20_NRT", bbox, days: 1 });
    expect(stale.fetchStatus).toBe("stale");
    expect(stale.body).toContain("latitude");
    now += 16 * 60 * 1000;
    const missed = await client.fetchArea({ sourceCode: "VIIRS_NOAA20_NRT", bbox, days: 1 });
    expect(missed.error).toBe("timeout");
    expect(missed.fetchStatus).toBe("unavailable");
  });

  it("returns a typed missing credential result without calling the network", async () => {
    let called = false;
    const client = new FirmsLiveClient({
      apiKey: undefined,
      fetchImpl: (async () => {
        called = true;
        return new Response("");
      }) as typeof fetch,
    });
    const result = await client.fetchArea({ sourceCode: "VIIRS_SNPP_NRT", bbox, days: 1 });
    expect(result.error).toBe("missing-credential");
    expect(called).toBe(false);
  });
});

describe("manifest guards", () => {
  it("rejects traversal, absolute paths, and remote artifact paths", () => {
    expect(() => assertRelativePath("../secret.csv")).toThrow(/escapes/);
    expect(() => assertRelativePath("/tmp/secret.csv")).toThrow(/relative/);
    expect(() => assertRelativePath("https://example.com/secret.csv")).toThrow(/remote/);
  });

  it("rejects a live manifest marked synthetic and a broken count", () => {
    const schemaPath = path.join(findRepoRoot(process.cwd()), "data/schemas/snapshot-manifest.schema.json");
    const base = {
      manifestVersion: "1.0",
      datasetId: "demo",
      datasetVersion: "a".repeat(64),
      snapshotId: "b".repeat(64),
      supersedesSnapshotId: null,
      runId: "run",
      mode: "live",
      synthetic: true,
      source: {
        id: "firms-viirs-noaa20",
        provider: "NASA FIRMS",
        product: "VIIRS_NOAA20_NRT",
        productVersion: "2.0NRT",
        documentationUrl: "https://firms.modaps.eosdis.nasa.gov/api/area/",
        fetchedAt: "2026-10-18T04:34:28Z",
        availableAt: null,
      },
      scope: {
        regionId: "wa-demo",
        bbox: [-124.85, 45.5, -116.9, 49.05],
        windowStart: "2026-10-10T09:54:00Z",
        windowEnd: "2026-10-17T21:00:00Z",
        asOf: "2026-10-17T21:00:00Z",
      },
      transformVersion: "firms-normalize-1",
      codeCommit: "c".repeat(40),
      artifacts: {
        raw: [{ path: "data/replay/demo/raw/file.csv", sha256: "d".repeat(64), bytes: 1 }],
        normalized: { path: "data/replay/demo/normalized.jsonl", sha256: "e".repeat(64), bytes: 1 },
        quality: { path: "data/replay/demo/quality.json", sha256: "f".repeat(64), bytes: 1 },
      },
      counts: { rawRows: 1, retainedRows: 1, duplicateRows: 0, excludedRows: 0, quarantinedRows: 0 },
      qualityStatus: "passed",
      coverageStatus: "unknown",
      attribution: "NASA FIRMS",
    };
    expect(() => assertManifestShape(base, schemaPath)).toThrow(/schema/);
    expect(() => assertManifestShape({
      ...base,
      synthetic: false,
      counts: { ...base.counts, rawRows: 3 },
    }, schemaPath)).toThrow(/reconcile/);
  });

  it("can round-trip a temporary manifest file", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "ember-"));
    writeFileSync(path.join(folder, "note.txt"), "ok");
    expect(readFileSync(path.join(folder, "note.txt"), "utf8")).toBe("ok");
  });
});
