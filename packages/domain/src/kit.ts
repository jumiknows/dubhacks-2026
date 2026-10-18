/**
 * OrbiCart camping kit rules. Pure and deterministic: the same trip and evidence always
 * give the same kit, and every conditional item names the evidence that added it.
 */

export type EvidenceKind = "typical" | "recent" | "forecast" | "terrain" | "hazard";

export interface EvidenceSource {
  name: string;
  product: string;
  url: string;
  /** What period or moment the value describes, in plain words. */
  period: string;
}

export interface Evidence {
  id: EvidenceId;
  kind: EvidenceKind;
  label: string;
  value: number | null;
  unit: string;
  text: string;
  source: EvidenceSource;
}

export type EvidenceId =
  | "typical.high" | "typical.low" | "typical.coldNight" | "typical.rainDays" | "typical.uv" | "typical.wind" | "typical.snow"
  | "typical.siteLow"
  | "recent.rain7d"
  | "forecast.high" | "forecast.low" | "forecast.rainChance"
  | "terrain.elevation" | "terrain.relief"
  | "hazard.fireKm";

export interface Trip {
  destination: string;
  startDate: string;
  nights: number;
  people: number;
  budget: number | null;
  owned: string[];
  /** Optional camping warning layer: active fires near the destination. */
  fireWarnings: boolean;
}

export type Priority = "essential" | "conditions";

export interface KitItem {
  id: string;
  name: string;
  quantity: number;
  priority: Priority;
  /** Shopping query and spec the product search should use. */
  search: string;
  spec: string | null;
  reason: string;
  evidence: EvidenceId[];
}

export interface Kit {
  items: KitItem[];
  skipped: { id: string; name: string; because: string }[];
  notes: string[];
}

type EvidenceMap = Partial<Record<EvidenceId, Evidence>>;

interface Rule {
  id: string;
  name: string;
  search: string;
  perPerson?: boolean;
  /** Words in the "already own" list that cover this item. */
  owned: string[];
  when?: (e: Values) => { reason: string; evidence: EvidenceId[] } | null;
  spec?: (e: Values) => string | null;
}

interface Values {
  get(id: EvidenceId): number | null;
  has(id: EvidenceId): boolean;
}

export const THRESHOLDS = {
  wetRainChance: 40, // % forecast chance of rain on any trip day
  wetRainDays: 0.4, // share of typical days with at least 1 mm
  soakedRecentMm: 25, // rain in the last 7 days that leaves trails muddy
  coldNightC: 5,
  freezingC: 0,
  hotC: 30,
  sunnyUv: 0.75, // NASA POWER 24-hour average UV index: about this or more means moderate midday UV
  windyMs: 10,
  snowDays: 0.3, // share of days with at least 2 cm of snow on the ground
  highElevationM: 2000,
  steepReliefM: 300,
  fireKm: 50,
} as const;

/** The coldest night any source expects, and the evidence it came from. */
function coldestNight(e: Values): { value: number; evidence: EvidenceId[] } | null {
  let best: { value: number; evidence: EvidenceId[] } | null = null;
  // The elevation-corrected cold night replaces the raw ~50 km grid value when available.
  const typicalId: EvidenceId = e.has("typical.siteLow") ? "typical.siteLow" : "typical.coldNight";
  for (const id of ["forecast.low", typicalId] as EvidenceId[]) {
    const value = e.get(id);
    if (value === null || (best && best.value <= value)) continue;
    best = { value, evidence: id === "typical.siteLow" ? [id, "terrain.elevation"] : [id] };
  }
  return best;
}

/**
 * Snow gear needs snow to be common in the ~50 km NASA POWER cell AND the site itself to get
 * cold enough for it to lie. A cell can include mountains well above the destination.
 */
function snowLikely(e: Values): { reason: string; evidence: EvidenceId[] } | null {
  const snow = e.get("typical.snow");
  if (snow === null || snow < THRESHOLDS.snowDays) return null;
  const site = coldestNight(e);
  if (!site || site.value > THRESHOLDS.freezingC) return null;
  return { reason: `Snow covered the ground on ${Math.round(snow * 100)}% of these days over the last 10 years, and nights here reach about ${Math.round(site.value)}°C.`, evidence: ["typical.snow", ...site.evidence] };
}

function coldest(e: Values): number | null {
  return coldestNight(e)?.value ?? null;
}

function wet(e: Values): { reason: string; evidence: EvidenceId[] } | null {
  const chance = e.get("forecast.rainChance");
  const days = e.get("typical.rainDays");
  // Recent rain means muddy trails (boot care, gaiters), not rain during the trip.
  if (chance !== null && chance >= THRESHOLDS.wetRainChance) return { reason: `The forecast gives up to a ${Math.round(chance)}% chance of rain on your trip.`, evidence: ["forecast.rainChance"] };
  if (days !== null && days >= THRESHOLDS.wetRainDays) return { reason: `Over the last 10 years it rained on ${Math.round(days * 100)}% of days around these dates.`, evidence: ["typical.rainDays"] };
  return null;
}

const RULES: Rule[] = [
  // Essentials for any camping trip
  { id: "tent", name: "Tent", search: "backpacking tent", owned: ["tent"],
    spec: (e) => (e.get("typical.wind") ?? 0) >= THRESHOLDS.windyMs ? "Freestanding with full rain fly, rated for wind" : "Freestanding with full rain fly" },
  { id: "sleeping-bag", name: "Sleeping bag", search: "sleeping bag", perPerson: true, owned: ["sleeping bag", "bag"],
    spec: (e) => { const low = coldest(e); return low === null ? null : `Comfort rating ${Math.floor(low - 3)}°C or lower`; } },
  { id: "sleeping-pad", name: "Sleeping pad", search: "sleeping pad", perPerson: true, owned: ["sleeping pad", "pad"],
    spec: (e) => { const low = coldest(e); return low !== null && low <= THRESHOLDS.freezingC ? "Insulated, R-value 4 or higher" : "R-value 2 or higher"; } },
  { id: "headlamp", name: "Headlamp", search: "headlamp", perPerson: true, owned: ["headlamp", "flashlight"] },
  { id: "stove", name: "Camp stove and fuel", search: "backpacking stove", owned: ["stove"] },
  { id: "water-filter", name: "Water filter", search: "water filter", owned: ["water filter", "filter"] },
  { id: "first-aid", name: "First aid kit", search: "first aid kit", owned: ["first aid"] },

  // Added by conditions at the destination
  { id: "rain-jacket", name: "Rain jacket", search: "waterproof rain jacket", perPerson: true, owned: ["rain jacket", "rain shell", "raincoat"], when: wet },
  { id: "dry-bags", name: "Dry bags", search: "dry bag set", owned: ["dry bag"], when: wet },
  { id: "boot-care", name: "Boot waterproofing", search: "boot waterproofing spray", owned: [],
    when: (e) => { const recent = e.get("recent.rain7d"); return recent !== null && recent >= THRESHOLDS.soakedRecentMm ? { reason: `${Math.round(recent)} mm of rain in the last 7 days means muddy trails, so protect the boots you already own.`, evidence: ["recent.rain7d"] } : null; } },
  { id: "gaiters", name: "Gaiters", search: "hiking gaiters", perPerson: true, owned: ["gaiters"],
    when: (e) => { const recent = e.get("recent.rain7d"); if (recent !== null && recent >= THRESHOLDS.soakedRecentMm) return { reason: "Recent heavy rain means mud on the trail.", evidence: ["recent.rain7d"] }; return snowLikely(e); } },
  { id: "warm-layer", name: "Insulated jacket", search: "insulated puffy jacket", perPerson: true, owned: ["puffy", "insulated jacket", "down jacket", "fleece"],
    when: (e) => { const low = coldestNight(e); return low && low.value <= THRESHOLDS.coldNightC ? { reason: `Nights can drop to about ${Math.round(low.value)}°C.`, evidence: low.evidence } : null; } },
  { id: "beanie", name: "Warm hat", search: "beanie", perPerson: true, owned: ["beanie", "hat"],
    when: (e) => { const low = coldestNight(e); return low && low.value <= THRESHOLDS.freezingC ? { reason: `Nights can fall below freezing (about ${Math.round(low.value)}°C).`, evidence: low.evidence } : null; } },
  { id: "water-capacity", name: "Extra water capacity", search: "collapsible water container", owned: ["water bladder", "water container"],
    when: (e) => { const high = Math.max(e.get("forecast.high") ?? -99, e.get("typical.high") ?? -99); return high >= THRESHOLDS.hotC ? { reason: `Days reach about ${Math.round(high)}°C: plan on 4 litres per person per day.`, evidence: e.get("forecast.high") === high ? ["forecast.high"] : ["typical.high"] } : null; } },
  { id: "sun-kit", name: "Sunscreen and sun hat", search: "sunscreen spf 50", perPerson: true, owned: ["sunscreen", "sun hat"],
    when: (e) => { const uv = e.get("typical.uv"); return uv !== null && uv >= THRESHOLDS.sunnyUv ? { reason: `NASA POWER's UV index averages ${uv.toFixed(2)} over the full day around these dates, which means moderate or stronger sun at midday.`, evidence: ["typical.uv"] } : null; } },
  { id: "guylines", name: "Extra stakes and guylines", search: "tent stakes guyline kit", owned: ["stakes", "guylines"],
    when: (e) => { const wind = e.get("typical.wind"); return wind !== null && wind >= THRESHOLDS.windyMs ? { reason: `Gusts typically reach ${Math.round(wind)} m/s around these dates.`, evidence: ["typical.wind"] } : null; } },
  { id: "microspikes", name: "Microspikes", search: "microspikes traction", perPerson: true, owned: ["microspikes", "crampons"],
    when: snowLikely },
  { id: "trekking-poles", name: "Trekking poles", search: "trekking poles", perPerson: true, owned: ["trekking poles", "poles"],
    when: (e) => { const relief = e.get("terrain.relief"); return relief !== null && relief >= THRESHOLDS.steepReliefM ? { reason: `The land within 5 km rises and falls about ${Math.round(relief)} m.`, evidence: ["terrain.relief"] } : null; } },
  { id: "smoke-mask", name: "N95 masks", search: "n95 mask", owned: ["n95", "respirator"],
    when: (e) => { const km = e.get("hazard.fireKm"); return km !== null && km <= THRESHOLDS.fireKm ? { reason: `A satellite detected an active fire about ${Math.round(km)} km away in the last day. Check closures and fire restrictions before you go.`, evidence: ["hazard.fireKm"] } : null; } },
];

function values(evidence: EvidenceMap): Values {
  return {
    get: (id) => evidence[id]?.value ?? null,
    has: (id) => evidence[id]?.value !== null && evidence[id]?.value !== undefined,
  };
}

/** Does the owned list cover this item? Matches whole words, so "hat" does not match "chat". */
export function ownsItem(owned: string[], words: string[]): string | null {
  const normalized = owned.map((item) => ` ${item.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `);
  for (const word of words) {
    const needle = ` ${word} `;
    const hit = normalized.find((item) => item.includes(needle) || item.replace(/s /g, " ").includes(needle));
    if (hit) return hit.trim();
  }
  return null;
}

export function buildKit(trip: Trip, evidence: EvidenceMap): Kit {
  const e = values(evidence);
  const people = Math.max(1, Math.round(trip.people));
  const items: KitItem[] = [];
  const skipped: Kit["skipped"] = [];
  for (const rule of RULES) {
    const condition = rule.when ? rule.when(e) : { reason: "Every camping trip needs one.", evidence: [] as EvidenceId[] };
    if (!condition) continue;
    const owned = ownsItem(trip.owned, rule.owned);
    if (owned) {
      skipped.push({ id: rule.id, name: rule.name, because: `You already own ${owned}.` });
      continue;
    }
    items.push({
      id: rule.id,
      name: rule.name,
      quantity: rule.perPerson ? people : 1,
      priority: rule.when ? "conditions" : "essential",
      search: rule.search,
      spec: rule.spec?.(e) ?? null,
      reason: condition.reason,
      evidence: condition.evidence,
    });
  }
  const notes: string[] = [];
  const elevation = e.get("terrain.elevation");
  if (elevation !== null && elevation >= THRESHOLDS.highElevationM) notes.push(`The destination sits at about ${Math.round(elevation)} m, so expect colder nights than nearby towns.`);
  if (ownsItem(trip.owned, ["boots", "hiking boots"]) && !items.some((item) => item.id === "boot-care")) notes.push("Your own boots cover footwear.");
  return { items, skipped, notes };
}

export interface KitChange {
  id: string;
  name: string;
  change: "added" | "removed" | "spec";
  why: string;
}

/** What changed between two kits, explained with the reason from the kit that has the item. */
export function compareKits(before: Kit, after: Kit): KitChange[] {
  const old = new Map(before.items.map((item) => [item.id, item]));
  const next = new Map(after.items.map((item) => [item.id, item]));
  const changes: KitChange[] = [];
  for (const item of after.items) {
    const was = old.get(item.id);
    if (!was) changes.push({ id: item.id, name: item.name, change: "added", why: item.reason });
    else if (was.spec !== item.spec && item.spec) changes.push({ id: item.id, name: item.name, change: "spec", why: `${was.spec ?? "No spec"} → ${item.spec}` });
  }
  for (const item of before.items) {
    if (!next.has(item.id)) changes.push({ id: item.id, name: item.name, change: "removed", why: `Not needed here. It was in the previous kit because: ${item.reason}` });
  }
  return changes;
}
