import type { KitItem } from "@emberready/domain";

/**
 * Real products for kit items from outdoor brands' public Shopify Storefront APIs.
 *
 * Retrieval: each item has stores verified to sell it and a search query. Storefront search
 * is fuzzy ("tent" also returns stakes), so a rerank step keeps products whose title names
 * the item, drops accessories and sold-out stock, then scores spec match, deals and budget
 * fit. Every reason shown or spoken comes from these returned facts.
 */

export interface Product {
  id: string;
  title: string;
  store: string;
  storeDomain: string;
  url: string;
  image: string | null;
  price: number;
  compareAt: number | null;
  currency: "USD";
  available: boolean;
  why: string[];
  score: number;
}

interface Source { store: string; query: string }
interface CatalogEntry { sources: Source[]; must: string[]; exclude: string[]; prefer: string[] }

const STORES: Record<string, string> = {
  "www.bigagnes.com": "Big Agnes", "www.nemoequipment.com": "NEMO", "www.kelty.com": "Kelty",
  "www.blackdiamondequipment.com": "Black Diamond", "www.seatosummit.com": "Sea to Summit",
  "www.toaksoutdoor.com": "TOAKS", "lifestraw.com": "LifeStraw", "www.adventuremedicalkits.com": "Adventure Medical Kits",
  "www.cotopaxi.com": "Cotopaxi", "www.outdoorresearch.com": "Outdoor Research", "www.stio.com": "Stio",
  "zpacks.com": "Zpacks", "www.smartwool.com": "Smartwool", "www.sunbum.com": "Sun Bum",
};

const ACCESSORY = ["replacement", "repair", "pole kit", "footprint", "ground cloth", "groundsheet", "accessory", "strap", "hook", "dog", "pet", "gift card", "patch", "sticker", "storage", "scarf", "kids", "kid", "youth", "toddler", "baby"];

export const CATALOG: Record<string, CatalogEntry> = {
  tent: { sources: [{ store: "www.bigagnes.com", query: "tent" }, { store: "www.nemoequipment.com", query: "tent" }, { store: "www.kelty.com", query: "tent" }, { store: "www.blackdiamondequipment.com", query: "tent" }], must: ["tent"], exclude: ["pole", "fly", "rainfly", "vestibule", "gear loft", "shower", "privacy", "stake", "cloth"], prefer: ["2 person", "2p", "backpacking", "freestanding"] },
  "sleeping-bag": { sources: [{ store: "www.kelty.com", query: "sleeping bag" }, { store: "www.bigagnes.com", query: "sleeping bag" }, { store: "www.nemoequipment.com", query: "sleeping bag" }], must: ["sleeping bag", "quilt", "sleeping"], exclude: ["liner", "sack", "pumphouse", "wedgie", "compression", "duffel", "pillow", "pad", "mesh"], prefer: ["20", "15", "down"] },
  "sleeping-pad": { sources: [{ store: "www.nemoequipment.com", query: "sleeping pad" }, { store: "www.seatosummit.com", query: "sleeping mat" }, { store: "www.bigagnes.com", query: "sleeping pad" }], must: ["pad", "mat", "mattress"], exclude: ["pump", "pillow", "coupler", "sheet", "cover", "net", "shelter"], prefer: ["insulated", "r-value"] },
  headlamp: { sources: [{ store: "www.blackdiamondequipment.com", query: "headlamp" }], must: ["headlamp"], exclude: ["battery"], prefer: ["rechargeable"] },
  stove: { sources: [{ store: "www.toaksoutdoor.com", query: "stove" }], must: ["stove", "burner"], exclude: ["windscreen", "stand", "pot", "cup", "pan", "base"], prefer: ["titanium"] },
  "water-filter": { sources: [{ store: "lifestraw.com", query: "filter" }], must: ["filter", "lifestraw", "purifier"], exclude: ["replacement", "subscription", "membrane", "carbon", "community", "mission", "family", "home", "pitcher", "dispenser", "case"], prefer: ["peak", "personal", "squeeze"] },
  "first-aid": { sources: [{ store: "www.adventuremedicalkits.com", query: "ultralight" }, { store: "www.adventuremedicalkits.com", query: "mountain series" }], must: ["medical kit", "first aid"], exclude: ["refill", "booklet", "book", "trauma", "dental", "marine", "backyard", "bleed", "burn", "blister", "guide", "mountaineer"], prefer: ["hiker", "ultralight", "watertight", "backpacker"] },
  "rain-jacket": { sources: [{ store: "www.cotopaxi.com", query: "rain jacket" }, { store: "www.outdoorresearch.com", query: "rain jacket" }, { store: "www.stio.com", query: "rain jacket" }, { store: "www.blackdiamondequipment.com", query: "rain shell" }], must: ["rain", "shell", "gore-tex", "waterproof", "storm"], exclude: ["pant", "bib", "insulated", "down", "puffy", "vest", "hat", "cap", "glove", "mitt", "soft shell", "softshell"], prefer: ["waterproof", "rain"] },
  "dry-bags": { sources: [{ store: "zpacks.com", query: "dry bag" }, { store: "www.seatosummit.com", query: "dry bag" }], must: ["dry bag", "dry sack", "drybag", "dry pack"], exclude: ["daypack", "strap", "first aid"], prefer: ["lightweight"] },
  gaiters: { sources: [{ store: "www.outdoorresearch.com", query: "gaiters" }], must: ["gaiter"], exclude: [], prefer: ["waterproof", "gore-tex"] },
  "warm-layer": { sources: [{ store: "www.cotopaxi.com", query: "insulated jacket" }, { store: "www.stio.com", query: "insulated jacket" }, { store: "www.outdoorresearch.com", query: "down jacket" }], must: ["insulated", "down", "puffy", "hoody", "hoodie", "parka"], exclude: ["vest", "pant", "rain", "shell", "glove", "mitt", "hat", "boot", "skirt"], prefer: ["insulated", "down"] },
  beanie: { sources: [{ store: "www.smartwool.com", query: "beanie" }], must: ["beanie"], exclude: [], prefer: ["merino"] },
  "water-capacity": { sources: [{ store: "lifestraw.com", query: "bottle" }], must: ["bottle", "reservoir", "bladder", "container"], exclude: ["replacement", "cap", "lid", "filter only"], prefer: ["1l", "liter", "litre"] },
  "sun-kit": { sources: [{ store: "www.sunbum.com", query: "sunscreen spf" }], must: ["spf", "sunscreen"], exclude: ["after sun", "aftersun", "kids", "baby", "tan"], prefer: ["spf 50", "spf 70", "lotion"] },
  guylines: { sources: [{ store: "www.nemoequipment.com", query: "stakes" }, { store: "zpacks.com", query: "guyline" }], must: ["stake", "guyline", "guy line", "cord"], exclude: [], prefer: ["ultralight"] },
  "trekking-poles": { sources: [{ store: "www.blackdiamondequipment.com", query: "trekking poles" }], must: ["pole"], exclude: ["tip", "basket", "tent", "flex tech", "replacement", "strap"], prefer: ["trail", "trekking", "aluminum", "carbon"] },
};

const cache = new Map<string, { expires: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

const QUERY = `query Search($q: String!) {
  products(first: 15, query: $q) {
    nodes { id handle title productType tags availableForSale onlineStoreUrl description(truncateAt: 240)
      featuredImage { url } priceRange { minVariantPrice { amount currencyCode } }
      compareAtPriceRange { minVariantPrice { amount } } }
  }
}`;

interface Raw {
  id: string; handle: string; title: string; productType: string; tags: string[]; availableForSale: boolean;
  onlineStoreUrl: string | null; description: string; featuredImage: { url: string } | null;
  priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
  compareAtPriceRange: { minVariantPrice: { amount: string } } | null;
}

async function search(store: string, query: string): Promise<Raw[]> {
  return cached(`shop:${store}:${query}`, 30 * 60_000, async () => {
    const response = await fetch(`https://${store}/api/2025-07/graphql.json`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { q: query } }), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`${STORES[store] ?? store} returned ${response.status}`);
    const body = await response.json() as { data?: { products?: { nodes: Raw[] } } };
    return body.data?.products?.nodes ?? [];
  });
}

function includesWord(text: string, phrase: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?([^a-z0-9]|$)`, "i").test(text);
}

/** Rerank one item's candidates. Exported for tests. */
export function rank(item: Pick<KitItem, "id" | "spec">, entry: CatalogEntry, candidates: (Raw & { store: string })[]): Product[] {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const raw of candidates) {
    const title = raw.title.toLowerCase();
    const text = `${title} ${raw.productType} ${raw.tags.join(" ")} ${raw.description}`.toLowerCase();
    const price = Number(raw.priceRange.minVariantPrice.amount);
    if (raw.priceRange.minVariantPrice.currencyCode !== "USD" || !(price > 0)) continue;
    if (!entry.must.some((word) => includesWord(title, word))) continue;
    if ([...ACCESSORY, ...entry.exclude].some((word) => includesWord(title, word))) continue;
    const key = `${raw.store}:${raw.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const why: string[] = [];
    let score = 3;
    const matched = entry.prefer.filter((word) => includesWord(text, word));
    score += Math.min(2, matched.length);
    if (item.spec) {
      const specWords = item.spec.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [];
      const hits = specWords.filter((word) => text.includes(word));
      if (hits.length) { score += 1; why.push(`Mentions ${[...new Set(hits)].slice(0, 2).join(", ")}`); }
    }
    const compareAt = raw.compareAtPriceRange ? Number(raw.compareAtPriceRange.minVariantPrice.amount) : null;
    if (compareAt && compareAt > price * 1.02) { score += 1; why.push(`On sale, ${Math.round((1 - price / compareAt) * 100)}% off`); }
    if (!raw.availableForSale) { score -= 10; why.push("Sold out"); }
    out.push({
      id: `${raw.store}:${raw.handle}`, title: raw.title, store: STORES[raw.store] ?? raw.store, storeDomain: raw.store,
      url: raw.onlineStoreUrl ?? `https://${raw.store}/products/${raw.handle}`, image: raw.featuredImage?.url ?? null,
      price, compareAt: compareAt && compareAt > price ? compareAt : null, currency: "USD", available: raw.availableForSale, why, score,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.price - b.price).slice(0, 6);
}

export interface Recommendation {
  itemId: string;
  name: string;
  quantity: number;
  status: "ok" | "no-verified-store" | "no-match" | "error";
  message: string | null;
  products: Product[];
}

/** Ranked real products for every kit item. Budget planning happens in planBudget (domain). */
export async function recommend(items: Pick<KitItem, "id" | "name" | "spec" | "quantity">[]): Promise<{ recommendations: Recommendation[]; failures: string[] }> {
  const failures: string[] = [];
  const recommendations = await Promise.all(items.map(async (item): Promise<Recommendation> => {
    const base = { itemId: item.id, name: item.name, quantity: item.quantity };
    const entry = CATALOG[item.id];
    if (!entry) return { ...base, status: "no-verified-store", message: "No connected store sells this yet.", products: [] };
    const lists = await Promise.allSettled(entry.sources.map(async (s) => (await search(s.store, s.query)).map((r) => ({ ...r, store: s.store }))));
    lists.forEach((r) => { if (r.status === "rejected") failures.push(String(r.reason?.message ?? r.reason)); });
    if (lists.every((r) => r.status === "rejected")) return { ...base, status: "error", message: "Stores did not respond.", products: [] };
    const products = rank(item, entry, lists.flatMap((r) => r.status === "fulfilled" ? r.value : []));
    return { ...base, status: products.length ? "ok" : "no-match", message: products.length ? null : "No matching product in stock at connected stores.", products };
  }));
  return { recommendations, failures: [...new Set(failures)] };
}
