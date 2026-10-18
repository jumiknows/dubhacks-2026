/**
 * Shared plumbing for store adapters: HTTP with timeouts, a TTL cache,
 * OAuth client-credential tokens, and the RawProduct builder.
 *
 * Every adapter returns RawProduct (see fetchBot.js) plus these optional fields:
 *   description: string | null
 *   source: provider id, e.g. "bestbuy"
 *   isMock: true for sample-data APIs (DummyJSON, Fake Store)
 *   warnings: string[]   caveats a shopper should see, e.g. price age
 *   gtin: string | null  barcode, used by Icecat enrichment
 *   estimatedArrival, shippingPrice, shippingCurrency: only when the source states them
 */

export const USER_AGENT = "Planboard/0.1 (DubHacks 2026 hackathon project)";

export class StoreError extends Error {
  constructor(message, { status = null, retryAfterMs = null } = {}) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const cache = new Map();

export function clearCache() {
  cache.clear();
}

/** Memoize an async lookup for ttlMs. Failed lookups are not cached. */
export async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return value;
}

/** fetch + JSON with a timeout. Throws StoreError on HTTP or parse failures. */
export async function requestJson(url, { method = "GET", headers = {}, body, timeoutMs = 5000, fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...headers },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new StoreError(err?.name === "TimeoutError" ? "timed out" : "network error");
  }
  if (!response.ok) {
    const retry = Number(response.headers.get("retry-after"));
    throw new StoreError(`HTTP ${response.status}`, {
      status: response.status,
      retryAfterMs: Number.isFinite(retry) && retry > 0 ? retry * 1000 : null,
    });
  }
  try {
    return await response.json();
  } catch {
    throw new StoreError("invalid JSON");
  }
}

/** OAuth2 client-credentials token, cached until shortly before it expires. */
const tokens = new Map();
export async function clientCredentialsToken({ tokenUrl, clientId, clientSecret, scope, fetchImpl }) {
  const key = `${tokenUrl}|${clientId}|${scope}`;
  const hit = tokens.get(key);
  if (hit && hit.expires > Date.now()) return hit.token;
  const body = await requestJson(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString(),
    fetchImpl,
  });
  if (typeof body?.access_token !== "string") throw new StoreError("no access token");
  const ttl = (Number(body.expires_in) || 1800) * 1000;
  tokens.set(key, { token: body.access_token, expires: Date.now() + ttl - 60_000 });
  return body.access_token;
}

export function clearTokens() {
  tokens.clear();
}

/** Build a RawProduct. Drops unsafe URLs and non-finite or negative prices. */
export function rawProduct(source, fields) {
  const price = toPrice(fields.price);
  return {
    id: `${source}-${String(fields.id)}`.replace(/[^A-Za-z0-9_.:-]+/g, "-"),
    store: cleanText(fields.store) || source,
    title: cleanText(fields.title) || "Untitled product",
    description: truncate(stripHtml(fields.description), 400),
    price,
    currency: price === null ? "USD" : fields.currency || "USD",
    image: httpsUrl(fields.image),
    url: httpsUrl(fields.url),
    dimensions: cleanText(fields.dimensions) ? { label: cleanText(fields.dimensions) } : null,
    shippingDays: Number.isInteger(fields.shippingDays) && fields.shippingDays >= 0 ? fields.shippingDays : null,
    inStock: typeof fields.inStock === "boolean" ? fields.inStock : null,
    source,
    isMock: fields.isMock === true,
    warnings: fields.warnings?.filter(Boolean) ?? [],
    gtin: cleanText(fields.gtin) || null,
    ...(isoDate(fields.estimatedArrival) ? { estimatedArrival: isoDate(fields.estimatedArrival) } : {}),
    ...(toPrice(fields.shippingPrice) !== null ? { shippingPrice: toPrice(fields.shippingPrice), shippingCurrency: fields.currency || "USD" } : {}),
  };
}

export function toPrice(value) {
  const number = typeof value === "string" ? Number(value.replace(/[$,]/g, "")) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100) / 100;
}

export function httpsUrl(value) {
  if (typeof value !== "string") return null;
  const text = value.startsWith("//") ? `https:${value}` : value.replace(/^http:\/\//, "https://");
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function isoDate(value) {
  const match = typeof value === "string" && /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

export function stripHtml(value) {
  if (typeof value !== "string") return null;
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function truncate(text, max) {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "Ships in 1-2 business days" → 2, "Ships in 1 week" → 7, "Ships overnight" → 1. */
export function shippingDaysFromText(text) {
  if (typeof text !== "string") return null;
  if (/overnight/i.test(text)) return 1;
  const match = /(\d+)(?:\s*-\s*(\d+))?\s*(business\s+)?(day|week|month)/i.exec(text);
  if (!match) return null;
  const count = Number(match[2] || match[1]);
  const unit = match[4].toLowerCase();
  return count * (unit === "week" ? 7 : unit === "month" ? 30 : 1);
}

const STOPWORDS = new Set(["a", "an", "and", "the", "for", "of", "with", "to", "in", "set", "kit", "pack", "package"]);

/** Significant search words: "2-person tent" → ["person", "tent"]. */
export function queryTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
}

/** Crude plural stripper: berries → berry, boxes → box, bags → bag, glass stays. */
export function stem(word) {
  if (/ies$/.test(word)) return word.replace(/ies$/, "y");
  if (/(s|x|z|ch|sh)es$/.test(word)) return word.replace(/es$/, "");
  if (/[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Is the title's last word the query's head noun? "Classico Pasta sauce" is not pasta. */
export function endsWithHead(query, title) {
  const terms = queryTerms(query);
  const words = String(title || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return terms.length > 0 && words.length > 0 && stem(words.at(-1)) === stem(terms.at(-1));
}

/**
 * Does the product title share the query's head noun? Store search is loose
 * ("wedding bands" also returns rubber bands), so require the last
 * significant query word to appear in the title.
 */
export function isRelevant(query, product) {
  const terms = queryTerms(query);
  if (terms.length === 0) return true;
  const title = ` ${String(product.title || "").toLowerCase().split(/[^a-z0-9]+/).map(stem).join(" ")} `;
  return title.includes(` ${stem(terms.at(-1))} `);
}

/** "shop.com, other.com|token" → [{ domain, token }]. Bare domains only, no paths. */
export function storeList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [domain, token] = entry.split("|").map((part) => part.trim());
      return { domain: domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase(), token: token || null };
    })
    .filter(({ domain }) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain));
}

/** Does the title contain every significant query word? */
export function matchesAllTerms(query, product) {
  const title = ` ${String(product.title || "").toLowerCase().split(/[^a-z0-9]+/).map(stem).join(" ")} `;
  return queryTerms(query).every((term) => title.includes(` ${stem(term)} `));
}
