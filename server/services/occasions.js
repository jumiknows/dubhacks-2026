/**
 * Turn calendar events into plan suggestions. Only events whose title names
 * something we can shop for become suggestions; everything else (meetings,
 * classes, dentist) is ignored and never leaves the server.
 */

const RULES = [
  { category: "camping", words: ["camp", "camping", "campground", "backpacking", "hike", "hiking", "trailhead", "glamping"] },
  { category: "wedding", words: ["wedding", "bridal", "rehearsal dinner", "engagement party", "elopement"] },
  { category: "groceries", words: ["grocery", "groceries", "meal prep", "costco run", "trader joe"] },
  {
    category: "custom",
    words: [
      "party", "birthday", "bbq", "barbecue", "cookout", "picnic", "potluck", "housewarming", "baby shower",
      "graduation", "road trip", "beach", "ski", "vacation", "move in", "moving", "thanksgiving",
      "friendsgiving", "christmas", "halloween", "game night", "dinner party", "festival", "tailgate",
    ],
  },
];

const DAY_MS = 86_400_000;

export function classify(title) {
  const text = ` ${String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  for (const rule of RULES) {
    const hit = rule.words.find((word) => text.includes(` ${word} `) || text.includes(` ${word}s `));
    if (hit) return { category: rule.category, keyword: hit };
  }
  return null;
}

/** Events → at most `limit` suggestions, soonest first. */
export function suggestionsFromEvents(events, { now = new Date(), limit = 4 } = {}) {
  const seen = new Set();
  const suggestions = [];
  for (const event of events) {
    if (event.status === "cancelled") continue;
    if (event.attendees?.some((person) => person.self && person.responseStatus === "declined")) continue;
    const title = String(event.summary || "").trim();
    const match = classify(title);
    if (!match) continue;
    const date = event.start?.date || event.start?.dateTime?.slice(0, 10);
    if (!date) continue;
    const key = `${title.toLowerCase()}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const start = Date.parse(event.start?.dateTime || `${date}T00:00:00`);
    suggestions.push({
      id: event.id,
      title,
      date,
      daysAway: Math.max(0, Math.ceil((start - now.getTime()) / DAY_MS)),
      category: match.category,
      prompt: promptFor(match.category, title),
    });
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}

function promptFor(category, title) {
  if (category === "camping") return `I need to prepare for camping: ${title}.`;
  if (category === "wedding") return `I need to plan for ${title}.`;
  if (category === "groceries") return `Groceries for ${title}.`;
  return `I need to prepare for ${title}.`;
}
