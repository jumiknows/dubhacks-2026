/**
 * Store registry. searchStores() fans one query out to every enabled
 * provider in parallel and merges their RawProducts.
 *
 * Environment (server/.env):
 *   provider keys            see .env.example; a provider without its keys is skipped
 *   STORES_DISABLED          comma list of provider ids to skip, e.g. "upcitemdb,etsy"
 *   STORES_SAMPLE_DATA       "fallback" (default): DummyJSON and Fake Store only when no
 *                            real source returned a match. "always" or "off".
 *   STORES_LIMIT             results per provider (default 4)
 *   STORES_TIMEOUT_MS        per-provider budget (default 6000)
 */
import { cached, httpsUrl, isRelevant, matchesAllTerms, StoreError } from "./core.js";
import bestbuy from "./providers/bestbuy.js";
import kroger from "./providers/kroger.js";
import etsy from "./providers/etsy.js";
import ebay from "./providers/ebay.js";
import woocommerce from "./providers/woocommerce.js";
import shopify from "./providers/shopify.js";
import upcitemdb from "./providers/upcitemdb.js";
import openfoodfacts from "./providers/openfoodfacts.js";
import icecat from "./providers/icecat.js";
import dummyjson from "./providers/dummyjson.js";
import fakestore from "./providers/fakestore.js";

export const PROVIDERS = [bestbuy, kroger, etsy, ebay, woocommerce, shopify, upcitemdb, openfoodfacts, dummyjson, fakestore];
export const ENRICHERS = [icecat];

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const health = new Map(); // id → { ok, at, error, count, coolUntil }

function settings(env) {
  return {
    disabled: new Set(String(env.STORES_DISABLED || "").split(",").map((id) => id.trim()).filter(Boolean)),
    sample: ["always", "off"].includes(env.STORES_SAMPLE_DATA) ? env.STORES_SAMPLE_DATA : "fallback",
    limit: clampInt(env.STORES_LIMIT, 4, 1, 20),
    timeoutMs: clampInt(env.STORES_TIMEOUT_MS, 6000, 500, 30000),
  };
}

function missingKeys(provider, env) {
  return provider.requires.filter((name) => !env[name]);
}

function isEnabled(provider, env, config) {
  return !config.disabled.has(provider.id) && missingKeys(provider, env).length === 0;
}

/** Status of every provider, for GET /api/stores. Never includes key values. */
export function storeStatus(env = process.env) {
  const config = settings(env);
  return [...PROVIDERS, ...ENRICHERS].map((provider) => {
    const missing = missingKeys(provider, env);
    const last = health.get(provider.id);
    return {
      id: provider.id,
      label: provider.label,
      kind: provider.kind,
      enabled: isEnabled(provider, env, config) && !(provider.kind === "sample" && config.sample === "off"),
      reason: config.disabled.has(provider.id)
        ? "Disabled by STORES_DISABLED"
        : missing.length ? `Missing ${missing.join(", ")}` : null,
      lastResult: last ? { ok: last.ok, at: last.at, count: last.count ?? null, error: last.error ?? null } : null,
    };
  });
}

/**
 * Search every enabled provider for one plan item.
 * Returns { products, sources } where sources reports per-provider outcomes.
 */
export async function searchStores(query, { env = process.env, fetchImpl = fetch } = {}) {
  const config = settings(env);
  const text = String(query || "").trim();
  if (!text) return { products: [], sources: [] };
  const enabled = PROVIDERS.filter((provider) => isEnabled(provider, env, config));
  const real = enabled.filter((provider) => provider.kind !== "sample");
  const samples = config.sample === "off" ? [] : enabled.filter((provider) => provider.kind === "sample");

  const run = (providers) => Promise.all(providers.map((provider) => runProvider(provider, text, { env, fetchImpl, config })));
  let outcomes = await run(config.sample === "always" ? [...real, ...samples] : real);
  const realMatches = outcomes.some((outcome) => outcome.products.length > 0);
  if (config.sample === "fallback" && !realMatches) outcomes = outcomes.concat(await run(samples));

  const products = dedupe(outcomes.flatMap((outcome) => outcome.products));
  await enrich(products, { env, fetchImpl, config });
  return {
    products,
    sources: outcomes.map(({ id, products: found, error }) => ({ id, count: found.length, error: error ?? null })),
  };
}

async function runProvider(provider, query, { env, fetchImpl, config }) {
  const state = health.get(provider.id);
  if (state?.coolUntil > Date.now()) return { id: provider.id, products: [], error: "rate limited, cooling down" };
  try {
    const key = `${provider.id}:${config.limit}:${query.toLowerCase()}`;
    const found = await cached(key, provider.cacheTtlMs ?? DEFAULT_TTL_MS, () =>
      withTimeout(provider.search(query, { env, limit: config.limit, fetchImpl }), config.timeoutMs),
    );
    // Keep titles with the item noun; if some name the whole item
    // ("gold wedding band"), drop partial matches ("rubber bands").
    const relevant = found.filter((product) => isRelevant(query, product));
    const exact = relevant.filter((product) => matchesAllTerms(query, product));
    const products = exact.length > 0 ? exact : relevant;
    health.set(provider.id, { ok: true, at: new Date().toISOString(), count: products.length });
    return { id: provider.id, products };
  } catch (err) {
    const message = err instanceof StoreError ? err.message : "adapter error";
    if (!(err instanceof StoreError)) console.error(`[stores] ${provider.id}:`, err);
    const coolMs = err?.status === 429 ? err.retryAfterMs ?? 15 * 60 * 1000 : err?.status === 401 || err?.status === 403 ? 5 * 60 * 1000 : 0;
    health.set(provider.id, { ok: false, at: new Date().toISOString(), error: message, coolUntil: Date.now() + coolMs });
    return { id: provider.id, products: [], error: message };
  }
}

async function enrich(products, { env, fetchImpl, config }) {
  const enrichers = ENRICHERS.filter((enricher) => isEnabled(enricher, env, config));
  const targets = products.filter((product) => product.gtin && (!product.image || !product.description)).slice(0, 8);
  for (const enricher of enrichers) {
    await Promise.all(targets.map(async (product) => {
      try {
        const extra = await cached(`${enricher.id}:${product.gtin}`, 24 * 60 * 60 * 1000, () =>
          withTimeout(enricher.enrich(product, { env, fetchImpl }), config.timeoutMs));
        if (!extra) return;
        product.image ??= httpsUrl(extra.image);
        product.description ??= extra.description || null;
      } catch {
        // Enrichment is optional; the product keeps what its source returned.
      }
    }));
  }
}

/** One listing per barcode or store URL, keeping the first one seen. */
function dedupe(products) {
  const seen = new Set();
  return products
    .filter((product) => {
      const keys = [product.gtin && `${product.source}:${product.gtin}`, product.url, product.id].filter(Boolean);
      if (keys.some((key) => seen.has(key))) return false;
      keys.forEach((key) => seen.add(key));
      return true;
    });
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new StoreError("timed out")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function clampInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function resetStoreState() {
  health.clear();
}
