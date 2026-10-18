import { randomUUID } from "node:crypto";

/**
 * OWNER: Plan generator
 * STATUS: Stub. Keyword templates stand in for a model.
 *
 * Replace itemsForPrompt() with a model call. It should read the prompt
 * and return { name, quantity, unit, reason }[]. Fetching and synthesis
 * run after this list exists — do that work in fetchBot.js and synthesizeBot.js.
 */

const TEMPLATES = {
  camping: [
    { name: "2-person tent", quantity: 1, unit: null, reason: "Shelter" },
    { name: "Sleeping bag", quantity: 2, unit: null, reason: "Overnight warmth" },
    { name: "Sleeping pad", quantity: 2, unit: null, reason: "Ground insulation" },
    { name: "Camp stove", quantity: 1, unit: null, reason: "Cooking" },
    { name: "Headlamp", quantity: 2, unit: null, reason: "Hands-free light" },
    { name: "Water filter", quantity: 1, unit: null, reason: "Drinking water" },
    { name: "First aid kit", quantity: 1, unit: null, reason: "Cuts and blisters" },
    { name: "Cooler", quantity: 1, unit: null, reason: "Food on ice" },
  ],
  wedding: [
    { name: "Invitations", quantity: 1, unit: null, reason: "Guest list" },
    { name: "Bouquet", quantity: 1, unit: null, reason: "Ceremony flowers" },
    { name: "Wedding cake", quantity: 1, unit: null, reason: "Dessert" },
    { name: "Wedding bands", quantity: 2, unit: null, reason: "Rings" },
    { name: "Suit", quantity: 1, unit: null, reason: "Attire" },
    { name: "Photography package", quantity: 1, unit: null, reason: "Photos" },
    { name: "String lights", quantity: 2, unit: null, reason: "Reception lighting" },
    { name: "Guest book", quantity: 1, unit: null, reason: "Messages" },
  ],
  groceries: [
    { name: "Milk", quantity: 1, unit: "gal", reason: "Dairy" },
    { name: "Eggs", quantity: 1, unit: "dozen", reason: "Breakfast" },
    { name: "Bread", quantity: 1, unit: "loaf", reason: "Staple" },
    { name: "Chicken breast", quantity: 2, unit: "lb", reason: "Protein" },
    { name: "Mixed vegetables", quantity: 1, unit: "bag", reason: "Produce" },
    { name: "Bananas", quantity: 1, unit: "lb", reason: "Fruit" },
    { name: "Coffee", quantity: 1, unit: "bag", reason: "Morning" },
    { name: "Pasta", quantity: 2, unit: "box", reason: "Pantry" },
  ],
  travel: [
    { name: "Carry-on suitcase", quantity: 1, unit: null, reason: "Fits the overhead bin" },
    { name: "Packing cubes", quantity: 1, unit: "set", reason: "Keeps the bag organized" },
    { name: "Universal travel adapter", quantity: 1, unit: null, reason: "Charge anywhere" },
    { name: "Portable charger", quantity: 1, unit: null, reason: "Phone power on the go" },
    { name: "Noise-cancelling headphones", quantity: 1, unit: null, reason: "Quiet on the flight" },
    { name: "Neck pillow", quantity: 1, unit: null, reason: "Sleep in transit" },
    { name: "Toiletry bag", quantity: 1, unit: null, reason: "Liquids through security" },
    { name: "Passport wallet", quantity: 1, unit: null, reason: "Documents in one place" },
  ],
  electronics: [
    { name: "Laptop", quantity: 1, unit: null, reason: "Daily work" },
    { name: "Phone", quantity: 1, unit: null, reason: "Primary device" },
    { name: "Headphones", quantity: 1, unit: null, reason: "Calls and focus" },
    { name: "USB-C charger", quantity: 1, unit: null, reason: "Power" },
    { name: "Laptop sleeve", quantity: 1, unit: null, reason: "Carry" },
    { name: "Screen protector", quantity: 1, unit: null, reason: "Phone face" },
  ],
};

// First match wins. Travel sits before groceries and electronics so "a week in Tokyo" or
// "headphones for the flight" plan a trip, not a grocery run.
const HINTS = [
  { category: "camping", words: ["camp", "camping", "hike", "backpacking", "trail"] },
  { category: "wedding", words: ["wedding", "bride", "groom", "reception"] },
  {
    category: "travel",
    words: ["trip", "travel", "traveling", "travelling", "vacation", "holiday", "flight", "flying", "getaway",
      "abroad", "packing", "luggage", "suitcase", "honeymoon", "itinerary", "beach", "cruise", "resort", "ski"],
    // "I'm going to Tokyo" / "a week in Lisbon" have no travel word: a capitalized place after
    // a travel verb or a length of stay.
    pattern: /\b(?:going|headed|heading|off|moving|flying|visiting)\s+(?:to\s+)?[A-Z][a-z]|\b(?:weekend|week|days|nights?|month)\s+(?:in|to|at)\s+[A-Z][a-z]/,
  },
  { category: "groceries", words: ["grocery", "groceries", "meal", "dinner", "week"] },
  { category: "electronics", words: ["laptop", "phone", "headphones", "electronics", "gadget"] },
];

const TITLES = {
  camping: "Camping kit",
  wedding: "Wedding shopping",
  travel: "Travel kit",
  groceries: "Grocery run",
  electronics: "Device shopping",
};

/** "Trip to Tokyo" when the prompt names a capitalized place, otherwise the template title. */
function titleFor(prompt, category) {
  if (category === "travel") {
    const place = /\b(?:to|in|around|across)\s+((?:[A-Z][\p{L}'’.-]+)(?:\s+[A-Z][\p{L}'’.-]+){0,2})/u.exec(prompt);
    if (place) return `Trip to ${place[1]}`;
  }
  return TITLES[category] || clip(prompt);
}

export function generatePlan({ prompt, category }) {
  const error = validatePlanRequest({ prompt, category });
  if (error) throw new TypeError(error);
  prompt = prompt.trim();
  category = category?.trim() || "";
  const resolved = resolveCategory(prompt, category);
  const source = itemsForPrompt(prompt, resolved);
  if (!Array.isArray(source) || source.length === 0 || source.length > 100 || source.some((item) =>
    typeof item.name !== "string" || !item.name.trim() || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) {
    throw new TypeError("Plan items require names and positive safe integer quantities, with at most 100 items");
  }
  const planType = source.length === 1 ? "individual" : "plan";

  return {
    id: randomUUID(),
    category: resolved,
    planType,
    allowBreak: source.length > 1,
    prompt,
    title: titleFor(prompt, resolved),
    createdAt: new Date().toISOString(),
    source: "keyword_templates",
    isMock: true,
    warnings: ["Demo checklist uses fixed templates, not an AI model or live trip facts."],
    items: source.map((item) => ({
      id: randomUUID(),
      name: item.name,
      quantity: item.quantity,
      unit: item.unit ?? null,
      reason: item.reason,
      purchased: false,
      owned: false,
      products: [],
      synthesis: null,
    })),
  };
}

export function validatePlanRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Expected a JSON object";
  if (Object.keys(body).some((key) => !["prompt", "category", "marketplaces", "async"].includes(key))) return "Only prompt, category, marketplaces and async are accepted";
  if (typeof body.prompt !== "string" || !body.prompt.trim()) return "prompt is required";
  if (body.prompt.length > 2000) return "prompt must be at most 2000 characters";
  if (body.category !== undefined && typeof body.category !== "string") return "category must be a string";
  if (body.category && !["", "groceries", "wedding", "camping", "travel", "custom", "electronics"].includes(body.category.trim())) return "Unsupported category";
  if (body.async !== undefined && typeof body.async !== "boolean") return "async must be a boolean";
  if (body.marketplaces !== undefined && (!Array.isArray(body.marketplaces) || body.marketplaces.length < 1 ||
      body.marketplaces.length > 3 || body.marketplaces.some((name) => !["amazon", "ebay", "walmart"].includes(name)))) {
    return "marketplaces must contain amazon, ebay or walmart";
  }
  return null;
}

function itemsForPrompt(prompt, category) {
  if (TEMPLATES[category]) return TEMPLATES[category];
  return customFromPrompt(prompt);
}

function resolveCategory(prompt, category) {
  const text = prompt.toLowerCase();
  const hinted = HINTS.find((hint) => hint.words.some((word) => hasKeyword(text, word)) || hint.pattern?.test(prompt));
  if (hinted) return hinted.category;
  if (TEMPLATES[category]) return category;
  return "custom";
}

function hasKeyword(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function customFromPrompt(prompt) {
  const cleaned = prompt
    .replace(/^i need to (prepare for|plan|buy|get ready for|get)?\s*/i, "")
    .replace(/^i need\s*/i, "")
    .replace(/[.?!]+$/, "")
    .trim();

  const named = cleaned
    .split(/\s*(?:,|;|\band\b|\bplus\b|\bwith\b)\s*/i)
    .map((part) => part.replace(/^(some|a|an|the)\s+/i, "").trim())
    .filter((part) => part.length > 1);

  if (named.length >= 2) {
    return named.slice(0, 10).map((name) => ({
      name,
      quantity: 1,
      unit: null,
      reason: "From your prompt",
    }));
  }

  const topic = named[0] || "Custom item";
  return [{ name: topic, quantity: 1, unit: null, reason: "Individual pickup" }];
}

function clip(prompt, max = 48) {
  if (prompt.length <= max) return prompt;
  return `${prompt.slice(0, max).trim()}…`;
}
