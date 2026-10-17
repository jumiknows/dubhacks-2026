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
};

const HINTS = [
  { category: "camping", words: ["camp", "camping", "hike", "backpacking"] },
  { category: "wedding", words: ["wedding", "bride", "groom", "reception"] },
  { category: "groceries", words: ["grocery", "groceries"] },
];

const TITLES = {
  camping: "Camping trip",
  wedding: "Wedding",
  groceries: "Groceries",
};

export function generatePlan({ prompt, category }) {
  const resolved = resolveCategory(prompt, category);
  const source = itemsForPrompt(prompt, resolved);

  return {
    id: randomUUID(),
    category: resolved,
    prompt,
    title: TITLES[resolved] || clip(prompt),
    createdAt: new Date().toISOString(),
    items: source.map((item) => ({
      id: randomUUID(),
      name: item.name,
      quantity: item.quantity,
      unit: item.unit ?? null,
      reason: item.reason,
      purchased: false,
      products: [],
      synthesis: null,
    })),
  };
}

function itemsForPrompt(prompt, category) {
  if (TEMPLATES[category]) return TEMPLATES[category];
  return customFromPrompt(prompt);
}

function resolveCategory(prompt, category) {
  const text = prompt.toLowerCase();
  const hinted = HINTS.find((hint) => hint.words.some((word) => text.includes(word)));
  if (hinted) return hinted.category;
  if (TEMPLATES[category]) return category;
  return "custom";
}

function customFromPrompt(prompt) {
  const name = prompt
    .replace(/^i need to (prepare for|plan|buy|get)?\s*/i, "")
    .replace(/^i need\s*/i, "")
    .replace(/[.?!]+$/, "")
    .trim();

  return [
    {
      name: name || "Custom item",
      quantity: 1,
      unit: null,
      reason: "From your prompt",
    },
  ];
}

function clip(prompt) {
  if (prompt.length <= 48) return prompt;
  return `${prompt.slice(0, 48).trim()}…`;
}
