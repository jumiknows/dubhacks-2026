/**
 * Read a typed trip request such as "I'm hiking near Seattle this weekend. I have $200,
 * already own hiking boots, and need everything else." Deterministic and offline: Grok Voice
 * fills the same fields through tools, and the form lets the user correct anything.
 */

export interface TripRequest {
  destination: string | null;
  startDate: string | null;
  nights: number | null;
  people: number | null;
  budget: number | null;
  owned: string[];
}

const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, a: 1 };

function count(word: string): number | null {
  const n = Number(word);
  return Number.isFinite(n) ? n : NUMBERS[word.toLowerCase()] ?? null;
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The coming Saturday (today if today is Saturday). */
export function upcomingSaturday(today: string): string {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, (6 - weekday + 7) % 7);
}

export function parseTripRequest(text: string, today: string): TripRequest {
  const out: TripRequest = { destination: null, startDate: null, nights: null, people: null, budget: null, owned: [] };

  const budget = /\$\s?(\d[\d,]*)/.exec(text) ?? /(\d[\d,]*)\s*(?:dollars|bucks)/i.exec(text);
  if (budget) out.budget = Number(budget[1].replace(/,/g, ""));

  // A capitalised place after near/in/at/to/around: "near Seattle", "to Moab, UT", "at Mount Rainier".
  const place = /\b(?:near|in|at|to|around|visiting)\s+((?:[A-Z][\w'.-]*)(?:\s+(?:[A-Z][\w'.-]*|of|de|la))*(?:,\s*[A-Z][A-Za-z.]+)?)/.exec(text);
  if (place) out.destination = place[1].replace(/\s+(?:This|Next)$/, "").trim();
  else {
    // Or a place at the very start: "Moab, UT this weekend", "Mount Rainier, 2 nights".
    const leading = /^\s*((?:[A-Z][\w'.-]*)(?:\s+(?:[A-Z][\w'.-]*|of|de|la))*(?:,\s*[A-Z]{2}\b)?)/.exec(text);
    if (leading && !/^(I|I'm|Im|We|We're|My|Our|The|A|Can|Help|Please|What|How)$/i.test(leading[1].split(/\s|,/)[0])) out.destination = leading[1].trim();
  }

  const lower = text.toLowerCase();
  if (/\bnext weekend\b/.test(lower)) { out.startDate = addDays(upcomingSaturday(today), 7); out.nights = 1; }
  else if (/\b(this )?weekend\b/.test(lower)) { out.startDate = upcomingSaturday(today); out.nights = 1; }
  else if (/\btomorrow\b/.test(lower)) out.startDate = addDays(today, 1);
  else if (/\btoday|tonight\b/.test(lower)) out.startDate = today;
  const nights = /(\w+)\s+nights?\b/.exec(lower);
  if (nights && count(nights[1]) !== null) out.nights = count(nights[1]);
  if (/\bday hike\b/.test(lower)) out.nights = 0;

  const people = /\b(\w+)\s+(?:people|persons|campers|of us)\b/.exec(lower);
  const friends = /\bwith\s+(\w+)\s+(?:friends?|others|kids)\b/.exec(lower);
  if (people && count(people[1]) !== null) out.people = count(people[1]);
  else if (friends && count(friends[1]) !== null) out.people = count(friends[1])! + 1;
  else if (/\b(?:with|taking|bringing) (?:my|a) (?:partner|friend|wife|husband|girlfriend|boyfriend|spouse)\b/.test(lower)) out.people = 2;

  // "already own hiking boots and a tent", "I already have a stove"
  const owned = /\b(?:already\s+(?:own|have)|i\s+own|i've\s+got|i\s+have\s+got)\s+(.+?)(?:[,;]?\s+(?:and\s+)?(?:need|want|but|so)\b|[.!?]|$)/i.exec(text);
  if (owned) {
    out.owned = owned[1]
      .split(/,|\band\b/)
      .map((item) => item.replace(/^\s*(?:a|an|my|some|the)\s+/i, "").trim().toLowerCase())
      .filter((item) => item && !item.startsWith("$"));
  }
  return out;
}
