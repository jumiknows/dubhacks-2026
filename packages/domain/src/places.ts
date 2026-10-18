import type { Place } from "./types";

export function validatePlaces(value: unknown): Place[] {
  if (!Array.isArray(value) || value.length < 5 || value.length > 10) throw new Error("Expected 5 to 10 communities");
  const ids = new Set<string>();
  for (const place of value as Place[]) {
    if (!place || typeof place.id !== "string" || ids.has(place.id)) throw new Error("Invalid or duplicate place ID");
    ids.add(place.id);
    if (![place.latitude, place.longitude].every(Number.isFinite) || place.latitude < 45.5 || place.latitude > 49.05 || place.longitude < -124.85 || place.longitude > -116.9) throw new Error("Place is outside the replay region");
    if (!place.name || !place.censusName || !/^53\d{5}$/.test(place.geoid) || place.id !== `wa-${place.geoid}` || !place.sourceVintage) throw new Error("Invalid Census identity");
    if (!Array.isArray(place.officialInfoLinks) || place.officialInfoLinks.length < 2) throw new Error("State and local resources are required");
    for (const url of [place.sourceUrl, ...place.officialInfoLinks.map((link) => link.url)]) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Invalid public resource URL");
    }
  }
  return value as Place[];
}
