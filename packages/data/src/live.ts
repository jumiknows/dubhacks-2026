import type { FetchStatus } from "@emberready/domain";

export interface LiveRequest {
  sourceCode: string;
  bbox: [number, number, number, number];
  days: number;
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
    if (!this.options.apiKey) {
      return { fetchStatus: "unavailable", body: null, fetchedAt: null, sourceUrl: REDACTED, error: "missing-credential" };
    }
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
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${this.options.apiKey}/${request.sourceCode}/${area}/${request.days}`;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const timeoutMs = this.options.timeoutMs ?? 20_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`upstream-${response.status}`);
      const body = await response.text();
      if (Buffer.byteLength(body) > (this.options.maxBytes ?? 5_000_000)) throw new Error("too-large");
      return { body, fetchedAt: new Date().toISOString().replace(".000Z", "Z"), sourceUrl: REDACTED };
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
