import { randomUUID } from "node:crypto";
import { quotePlan } from "./pipeline.js";
import { normalizeCurrency, parseCents, synthesize } from "./synthesizeBot.js";

export class OrbiCartError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

function validInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !["items", "title", "budget"].includes(key))) {
    throw new OrbiCartError("Send kit items, an optional title and budget. Product prices are fetched on the server.");
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) throw new OrbiCartError("Send 1-30 kit items.");
  const items = body.items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).some((key) => !["id", "name", "spec", "quantity"].includes(key)) ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 200 ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100 ||
        (item.spec !== undefined && item.spec !== null && (typeof item.spec !== "string" || item.spec.length > 500))) {
      throw new OrbiCartError("Each kit item requires an id, name, quantity 1-100 and optional specification.");
    }
    return { id: item.id, name: item.name.trim(), spec: item.spec ?? null, quantity: item.quantity };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new OrbiCartError("Kit item ids must be unique.");
  if (body.title !== undefined && (typeof body.title !== "string" || body.title.length > 200)) throw new OrbiCartError("title must be at most 200 characters.");
  const budget = body.budget ?? null;
  if (budget !== null && (typeof budget !== "number" || parseCents(budget, "USD") === null || budget <= 0)) {
    throw new OrbiCartError("budget must be a positive USD amount with at most two decimal places.");
  }
  return { items, budget, title: body.title?.trim() || "Camping kit" };
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function checkedProduct(product) {
  if (!product || typeof product.id !== "string" || product.id.length > 300 || typeof product.title !== "string" ||
      typeof product.store !== "string" || normalizeCurrency(product.currency) !== "USD" || product.available !== true) return null;
  const cents = parseCents(product.price, product.currency);
  const url = safeUrl(product.url);
  if (!url || cents === null || cents <= 0) return null;
  const previous = parseCents(product.compareAt, product.currency);
  return {
    ...product, price: cents / 100, currency: "USD", available: true, url, image: safeUrl(product.image),
    compareAt: previous !== null && previous > cents ? previous / 100 : null,
    why: Array.isArray(product.why) ? product.why.filter((reason) => typeof reason === "string").slice(0, 10) : [],
    source: "orbicart_shopify", isMock: false,
    warnings: ["Store listing price excludes shipping and tax. Availability can change before merchant checkout."],
  };
}

/** Server-side retrieval is the only route from source catalog prices into checkout. */
export async function createOrbiCartPlan(body, { recommend, catalog } = {}) {
  const input = validInput(body);
  if (!recommend) {
    // Node 24 strips this module's erasable TypeScript. The source repository stays untouched.
    const source = await import("../../apps/web/src/lib/server/shop.ts");
    recommend = source.recommend;
    catalog = source.CATALOG;
  }
  const supported = input.items.filter((item) => !catalog || Object.hasOwn(catalog, item.id));
  const fetched = await recommend(supported);
  const byId = new Map((fetched.recommendations || []).map((entry) => [entry.itemId, entry]));
  const recommendations = input.items.map((item) => {
    const result = byId.get(item.id);
    const products = (result?.products || []).map(checkedProduct).filter(Boolean);
    return {
      itemId: item.id, name: item.name, quantity: item.quantity,
      status: products.length ? "ok" : result?.status === "error" ? "error" : "no-match",
      message: products.length ? null : result?.message || "No explicitly in-stock, comparable product is available at a connected store.",
      products,
    };
  });
  const items = await Promise.all(recommendations.map(async (entry) => {
    const item = { id: entry.itemId, name: entry.name, quantity: entry.quantity, unit: null, reason: "From your camping kit", purchased: false, owned: false };
    const products = entry.products.map((product) => ({ ...product, inStock: product.available }));
    // Keep source ranking and the page's first selected product aligned. All financial
    // fields still use the same checked synthesis as the existing backend.
    const synthesis = await synthesize(item, products.slice(0, 1));
    synthesis.alternatives = products.slice(1);
    return { ...item, products, synthesis, selectedListingId: synthesis.best?.id ?? null };
  }));
  const preferences = { priority: "source_ranking", budgetMax: input.budget };
  return {
    recommendations,
    failures: Array.isArray(fetched.failures) ? fetched.failures.filter((failure) => typeof failure === "string") : [],
    plan: {
      id: randomUUID(), category: "camping", prompt: input.title, title: input.title, createdAt: new Date().toISOString(),
      source: "orbicart_catalog", isMock: false, status: "ready", preferences, items,
      quote: quotePlan(items, preferences),
      warnings: ["Merchandise prices are source store listings. Shipping, tax and fulfillment are not provided by this application."],
    },
  };
}
