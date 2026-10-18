import type { FetchStatus } from "@emberready/domain";

export interface LiveRequest {
  sourceCode: string;
  bbox: [number, number, number, number];
  days: number;
  publicFeed?: boolean;
}

export interface LiveResult {
  fetchStatus: FetchStatus;
  body: string | null;
  fetchedAt: string | null;
  sourceUrl: string;
  error: "missing-credential" | "timeout" | "upstream-failure" | null;
}

interface CacheEntry {
  storedAt: number;
  fetchedAt: string;
  body: string;
  sourceUrl: string;
}

export const PUBLIC_NOAA20_URL = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv";

const REDACTED = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}";

export class FirmsLiveClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<LiveResult>>();

  constructor(
    private readonly options: {
      apiKey: string | undefined;
      fetchImpl?: typeof fetch;
      now?: () => number;
      cacheMs?: number;
      staleMs?: number;
      timeoutMs?: number;
      maxBytes?: number;
    },
  ) {}

  async fetchArea(request: LiveRequest): Promise<LiveResult> {
    if (!this.options.apiKey && !request.publicFeed) {
      return { fetchStatus: "unavailable", body: null, fetchedAt: null, sourceUrl: REDACTED, error: "missing-credential" };
    }
    if (request.publicFeed && (request.sourceCode !== "VIIRS_NOAA20_NRT" || request.days !== 1)) return { fetchStatus: "unavailable", body: null, fetchedAt: null, sourceUrl: PUBLIC_NOAA20_URL, error: "upstream-failure" };
    if (!Number.isInteger(request.days) || request.days < 1 || request.days > 5) {
      return { fetchStatus: "unavailable", body: null, fetchedAt: null, sourceUrl: REDACTED, error: "upstream-failure" };
    }
    const key = JSON.stringify(request);
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = this.load(key, request).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private async load(key: string, request: LiveRequest): Promise<LiveResult> {
    const now = this.options.now ?? Date.now;
    const cacheMs = this.options.cacheMs ?? 10 * 60 * 1000;
    const staleMs = this.options.staleMs ?? 15 * 60 * 1000;
    const cached = this.cache.get(key);
    if (cached && now() - cached.storedAt <= cacheMs) {
      return { fetchStatus: "ok", body: cached.body, fetchedAt: cached.fetchedAt, sourceUrl: cached.sourceUrl, error: null };
    }
    try {
      const loaded = await this.request(request);
      this.cache.set(key, { storedAt: now(), ...loaded });
      return { fetchStatus: "ok", body: loaded.body, fetchedAt: loaded.fetchedAt, sourceUrl: loaded.sourceUrl, error: null };
    } catch (error) {
      if (cached && now() - cached.storedAt <= staleMs) {
        return { fetchStatus: "stale", body: cached.body, fetchedAt: cached.fetchedAt, sourceUrl: cached.sourceUrl, error: null };
      }
      const timedOut = error instanceof Error && error.message === "timeout";
      return {
        fetchStatus: "unavailable",
        body: null,
        fetchedAt: null,
        sourceUrl: REDACTED,
        error: timedOut ? "timeout" : "upstream-failure",
      };
    }
  }

  private async request(request: LiveRequest): Promise<{ body: string; fetchedAt: string; sourceUrl: string }> {
    const [west, south, east, north] = request.bbox;
    const area = `${west},${south},${east},${north}`;
    const url = request.publicFeed ? PUBLIC_NOAA20_URL : `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${this.options.apiKey}/${request.sourceCode}/${area}/${request.days}`;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const timeoutMs = this.options.timeoutMs ?? 20_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`upstream-${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("empty-body");
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > (this.options.maxBytes ?? 5_000_000)) { await reader.cancel(); throw new Error("too-large"); }
        chunks.push(chunk.value);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      return { body, fetchedAt: new Date((this.options.now ?? Date.now)()).toISOString().replace(".000Z", "Z"), sourceUrl: request.publicFeed ? PUBLIC_NOAA20_URL : REDACTED };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function sourceCodeFor(sourceId: string): string | null {
  if (sourceId === "firms-viirs-snpp") return "VIIRS_SNPP_NRT";
  if (sourceId === "firms-viirs-noaa20") return "VIIRS_NOAA20_NRT";
  return null;
}
