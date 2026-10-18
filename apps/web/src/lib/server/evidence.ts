import { inflateRawSync } from "node:zlib";
import { distanceKm, type Evidence, type EvidenceId, type Trip } from "@emberready/domain";
import staticSources from "../../../../../data/firms-static-sources.json";

/**
 * OrbiCart environmental evidence for a destination and dates. Every provider runs in
 * parallel with its own timeout and fails on its own, so a slow source never blocks the kit.
 *
 * typical   NASA POWER daily values for the same dates over the last 10 years
 * recent    rain in the last 7 days: GPM IMERG when the Earthdata account can read it,
 *           otherwise NASA POWER (MERRA-2 reanalysis, a few days behind)
 * forecast  US National Weather Service, or Open-Meteo outside the US (not NASA)
 * terrain   SRTM elevation and local relief (needs EARTHDATA_TOKEN)
 * hazard    FIRMS active fires near the destination, only when fire warnings are on
 */

const UA = "OrbiCart/0.1 (hackathon; github.com/jumiknows/spacex2026Hacks)";
const LAPSE_C_PER_M = 0.0065;

export interface Place {
  name: string;
  region: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
}

export interface ForecastDay { date: string; high: number | null; low: number | null; rainChance: number | null; summary: string }

export interface EvidenceReport {
  place: Place;
  /** Up to 7 forecast days from today, for the map's timeline. */
  forecastDays: ForecastDay[];
  evidence: Partial<Record<EvidenceId, Evidence>>;
  unavailable: { source: string; reason: string }[];
}

// --- small shared helpers ---------------------------------------------------------------

const cache = new Map<string, { expires: number; value: unknown }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return value;
}

async function getJson(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<unknown> {
  const response = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${new URL(url).host} returned ${response.status}`);
  return response.json();
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

function round(value: number | null, digits = 1): number | null {
  return value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;
}

// --- geocoding ---------------------------------------------------------------------------

const STATES: Record<string, string> = { WA: "Washington", OR: "Oregon", CA: "California", UT: "Utah", CO: "Colorado", AZ: "Arizona", ID: "Idaho", MT: "Montana", WY: "Wyoming", NV: "Nevada", NM: "New Mexico", TX: "Texas", NY: "New York", BC: "British Columbia", AK: "Alaska" };

export async function geocode(query: string): Promise<Place | null> {
  const coordinates = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(query);
  if (coordinates) return { name: query.trim(), region: null, country: null, latitude: Number(coordinates[1]), longitude: Number(coordinates[2]) };
  const cleaned = query.replace(/^\s*(near|around|outside|by|at)\s+/i, "").trim();
  const [name, qualifier] = cleaned.split(",").map((part) => part.trim());
  if (!name) return null;
  return cached(`geo:${cleaned.toLowerCase()}`, 86_400_000, async () => {
    const body = await getJson(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name, count: "10", language: "en", format: "json" })}`) as { results?: { name: string; admin1?: string; country?: string; country_code?: string; latitude: number; longitude: number; population?: number }[] };
    const results = body.results ?? [];
    const wanted = qualifier ? (STATES[qualifier.toUpperCase()] ?? qualifier).toLowerCase() : null;
    const match = (wanted && results.find((r) => [r.admin1, r.country, r.country_code].some((v) => v?.toLowerCase() === wanted))) || results[0];
    return match ? { name: match.name, region: match.admin1 ?? null, country: match.country ?? null, latitude: match.latitude, longitude: match.longitude } : null;
  });
}

// --- NASA POWER ----------------------------------------------------------------------------

interface PowerDaily {
  gridElevation: number | null;
  series: Record<string, Record<string, number>>;
}

async function powerDaily(place: Place, start: string, end: string, parameters: string[]): Promise<PowerDaily> {
  const lat = place.latitude.toFixed(2);
  const lon = place.longitude.toFixed(2);
  return cached(`power:${lat}:${lon}:${start}:${end}:${parameters.join(",")}`, 6 * 3_600_000, async () => {
    const params = new URLSearchParams({ parameters: parameters.join(","), community: "AG", latitude: lat, longitude: lon, start: start.replaceAll("-", ""), end: end.replaceAll("-", ""), format: "JSON" });
    const body = await getJson(`https://power.larc.nasa.gov/api/temporal/daily/point?${params}`, {}, 20_000) as { geometry?: { coordinates?: number[] }; properties: { parameter: Record<string, Record<string, number>> } };
    return { gridElevation: body.geometry?.coordinates?.[2] ?? null, series: body.properties.parameter };
  });
}

const TYPICAL = ["T2M_MAX", "T2M_MIN", "PRECTOTCORR", "ALLSKY_SFC_UV_INDEX", "WS10M_MAX", "SNODP"];

async function typicalConditions(place: Place, trip: Trip) {
  const year = Number(trip.startDate.slice(0, 4));
  const first = year - 10;
  const daily = await powerDaily(place, `${first}-01-01`, `${year - 1}-12-31`, TYPICAL);
  // Same calendar days as the trip, widened by a week each side, in each of the last 10 years.
  const window = new Set<string>();
  for (let y = first; y < year; y += 1) {
    const start = `${y}${trip.startDate.slice(4)}`;
    for (let d = -7; d <= trip.nights + 7; d += 1) window.add(addDays(start, d).replaceAll("-", ""));
  }
  const pick = (name: string) => Object.entries(daily.series[name] ?? {}).filter(([day, v]) => window.has(day) && v > -900).map(([, v]) => v);
  const highs = pick("T2M_MAX"), lows = pick("T2M_MIN"), rain = pick("PRECTOTCORR"), uv = pick("ALLSKY_SFC_UV_INDEX"), wind = pick("WS10M_MAX"), snow = pick("SNODP");
  return {
    gridElevation: daily.gridElevation,
    days: highs.length,
    period: `${trip.startDate.slice(5)} ±7 days, ${first} to ${year - 1}`,
    high: round(mean(highs)),
    low: round(mean(lows)),
    coldNight: round(quantile(lows, 0.1)),
    rainDays: rain.length ? round(rain.filter((v) => v >= 1).length / rain.length, 2) : null,
    uv: round(mean(uv), 2),
    wind: round(quantile(wind, 0.9)),
    // Share of days with at least 2 cm on the ground. A mean depth is misleading: the ~50 km
    // POWER cell can include nearby mountains, and one storm dominates a 10-year average.
    snow: snow.length ? round(snow.filter((v) => v >= 2).length / snow.length, 2) : null,
  };
}

// --- recent rain -----------------------------------------------------------------------------

// When GES DISC is unreachable, skip it for a while instead of making every trip wait.
let gpmDownUntil = 0;

async function recentRainGpm(place: Place, token: string): Promise<{ total: number; through: string; days: number }> {
  if (Date.now() < gpmDownUntil) throw new Error("GES DISC was unreachable a moment ago, retrying in a few minutes");
  try {
    return await recentRainGpmUncached(place, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("approved")) gpmDownUntil = Date.now() + 5 * 60_000;
    throw error instanceof Error && error.name === "TimeoutError" ? new Error("GES DISC did not answer in time") : error;
  }
}

async function recentRainGpmUncached(place: Place, token: string): Promise<{ total: number; through: string; days: number }> {
  // IMERG Late Run daily, 0.1° grid, dimensions [time][lon][lat]. OPeNDAP returns one cell as text.
  const lonIndex = Math.floor((place.longitude + 180) * 10);
  const latIndex = Math.floor((place.latitude + 90) * 10);
  const today = isoDay(new Date());
  // Late Run files appear about a day after the fact: look back 10 days and use the 7 newest.
  // GES DISC throttles bursts, so ask at most two days at a time, stop once 7 are found,
  // cache each day, and give up after 8 seconds (the caller then falls back to NASA POWER).
  const days = Array.from({ length: 10 }, (_, i) => addDays(today, -(i + 1)));
  const deadline = Date.now() + 8000;
  const one = (day: string) => cached(`gpm:${lonIndex}:${latIndex}:${day}`, 6 * 3_600_000, async () => {
    const [y, m] = day.split("-");
    const file = `3B-DAY-L.MS.MRG.3IMERG.${day.replaceAll("-", "")}-S000000-E235959.V07C.nc4`;
    const url = `https://gpm1.gesdisc.eosdis.nasa.gov/opendap/GPM_L3/GPM_3IMERGDL.07/${y}/${m}/${file}.ascii?precipitation%5B0:0%5D%5B${lonIndex}:${lonIndex}%5D%5B${latIndex}:${latIndex}%5D`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "User-Agent": UA }, signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    if (response.status === 401 || response.status === 403) throw new Error("the Earthdata account has not approved the NASA GESDISC DATA ARCHIVE application");
    if (!response.ok) return null; // not published yet
    const value = Number((await response.text()).trim().split(/[\s,]+/).at(-1));
    return Number.isFinite(value) && value >= 0 ? { day, value } : null;
  });
  const results: ({ day: string; value: number } | null)[] = [];
  for (let i = 0; i < days.length && results.filter(Boolean).length < 7; i += 2) {
    if (Date.now() > deadline) throw new Error("GES DISC did not answer within 8 seconds");
    results.push(...await Promise.all(days.slice(i, i + 2).map(one)));
  }
  const published = results.filter((r): r is { day: string; value: number } => r !== null).slice(0, 7);
  if (published.length < 5) throw new Error("fewer than 5 recent GPM days are published");
  return { total: published.reduce((sum, r) => sum + r.value, 0), through: published[0].day, days: published.length };
}

async function recentRainPower(place: Place): Promise<{ total: number; through: string; days: number }> {
  const end = isoDay(new Date());
  const daily = await powerDaily(place, addDays(end, -14), end, ["PRECTOTCORR"]);
  const published = Object.entries(daily.series.PRECTOTCORR ?? {}).filter(([, v]) => v > -900).sort(([a], [b]) => a.localeCompare(b)).slice(-7);
  if (!published.length) throw new Error("no recent days published yet");
  const last = published.at(-1)![0];
  return { total: published.reduce((sum, [, v]) => sum + v, 0), through: `${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6)}`, days: published.length };
}

// --- forecast -----------------------------------------------------------------------------------

interface Forecast { high: number | null; low: number | null; rainChance: number | null; summary: string; source: string; url: string; days: ForecastDay[] }

async function forecast(place: Place, trip: Trip): Promise<Forecast> {
  const end = addDays(trip.startDate, trip.nights);
  try {
    const point = await getJson(`https://api.weather.gov/points/${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`) as { properties: { forecast: string } };
    const body = await getJson(point.properties.forecast) as { properties: { periods: { startTime: string; isDaytime: boolean; temperature: number; temperatureUnit: string; probabilityOfPrecipitation?: { value: number | null }; shortForecast: string }[] } };
    const c = (p: { temperature: number; temperatureUnit: string }) => p.temperatureUnit === "F" ? (p.temperature - 32) * 5 / 9 : p.temperature;
    const byDate = new Map<string, ForecastDay>();
    for (const p of body.properties.periods) {
      const date = p.startTime.slice(0, 10);
      const day = byDate.get(date) ?? { date, high: null, low: null, rainChance: null, summary: "" };
      if (p.isDaytime) { day.high = round(c(p)); day.summary = p.shortForecast; } else { day.low = round(c(p)); day.summary ||= p.shortForecast; }
      day.rainChance = Math.max(day.rainChance ?? 0, p.probabilityOfPrecipitation?.value ?? 0);
      byDate.set(date, day);
    }
    const allDays = [...byDate.values()].slice(0, 7);
    const periods = body.properties.periods.filter((p) => p.startTime.slice(0, 10) >= trip.startDate && p.startTime.slice(0, 10) <= end);
    if (!periods.length) throw Object.assign(new Error("trip is beyond the 7-day forecast"), { days: allDays });
    const days = periods.filter((p) => p.isDaytime), nights = periods.filter((p) => !p.isDaytime);
    return {
      high: days.length ? round(Math.max(...days.map(c))) : null,
      low: nights.length ? round(Math.min(...nights.map(c))) : null,
      rainChance: Math.max(0, ...periods.map((p) => p.probabilityOfPrecipitation?.value ?? 0)),
      summary: [...new Set(periods.map((p) => p.shortForecast))].slice(0, 3).join(", "),
      source: "US National Weather Service", url: point.properties.forecast, days: allDays,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("beyond")) throw error;
    const params = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max", timezone: "auto", forecast_days: "16" });
    const url = `https://api.open-meteo.com/v1/forecast?${params}`;
    const body = await getJson(url) as { daily?: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[]; precipitation_probability_max: (number | null)[] } };
    const d = body.daily;
    if (!d) throw new Error("no forecast available");
    const days: ForecastDay[] = d.time.map((date, i) => ({ date, high: round(d.temperature_2m_max[i]), low: round(d.temperature_2m_min[i]), rainChance: d.precipitation_probability_max[i], summary: "" }));
    const inTrip = days.filter((day) => day.date >= trip.startDate && day.date <= end);
    if (!inTrip.length) throw Object.assign(new Error("trip is beyond the forecast range"), { days: days.slice(0, 7) });
    const nums = (xs: (number | null)[]) => xs.filter((v): v is number => v !== null);
    return { high: round(Math.max(...nums(inTrip.map((x) => x.high)))), low: round(Math.min(...nums(inTrip.map((x) => x.low)))), rainChance: Math.max(0, ...nums(inTrip.map((x) => x.rainChance))), summary: "", source: "Open-Meteo forecast", url, days: days.slice(0, 7) };
  }
}

// --- SRTM terrain --------------------------------------------------------------------------------

async function srtmTile(lat: number, lon: number, token: string): Promise<Int16Array | null> {
  const ns = lat >= 0 ? "N" : "S", ew = lon >= 0 ? "E" : "W";
  const name = `${ns}${String(Math.abs(lat)).padStart(2, "0")}${ew}${String(Math.abs(lon)).padStart(3, "0")}`;
  return cached(`srtm:${name}`, 7 * 86_400_000, async () => {
    const url = `https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/SRTMGL3.003/${name}.SRTMGL3.hgt/${name}.SRTMGL3.hgt.zip`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
    if (response.status === 404) return null; // ocean or outside SRTM coverage
    if (!response.ok) throw new Error(`LP DAAC returned ${response.status}`);
    const zip = Buffer.from(await response.arrayBuffer());
    if (zip.readUInt32LE(0) !== 0x04034b50) throw new Error("unexpected SRTM archive");
    const size = zip.readUInt32LE(18);
    const start = 30 + zip.readUInt16LE(26) + zip.readUInt16LE(28);
    const raw = inflateRawSync(size ? zip.subarray(start, start + size) : zip.subarray(start));
    const grid = new Int16Array(1201 * 1201);
    for (let i = 0; i < grid.length; i += 1) grid[i] = raw.readInt16BE(i * 2);
    return grid;
  });
}

async function terrain(place: Place, token: string): Promise<{ elevation: number; relief: number }> {
  const lat0 = Math.floor(place.latitude), lon0 = Math.floor(place.longitude);
  const grid = await srtmTile(lat0, lon0, token);
  if (!grid) throw new Error("no SRTM coverage at this point");
  const row = Math.round((lat0 + 1 - place.latitude) * 1200), col = Math.round((place.longitude - lon0) * 1200);
  const at = (r: number, c: number) => { const v = grid[Math.min(1200, Math.max(0, r)) * 1201 + Math.min(1200, Math.max(0, c))]; return v === -32768 ? null : v; };
  const elevation = at(row, col);
  if (elevation === null) throw new Error("SRTM void at this point");
  // Relief within about 5 km (54 pixels of 3 arc-seconds), clipped to the tile.
  let low = Infinity, high = -Infinity;
  for (let r = row - 54; r <= row + 54; r += 3) for (let c = col - 54; c <= col + 54; c += 3) { const v = at(r, c); if (v !== null) { low = Math.min(low, v); high = Math.max(high, v); } }
  return { elevation, relief: high - low };
}

// --- FIRMS ------------------------------------------------------------------------------------------

// Industrial heat sources and volcanoes that FIRMS archives label as static (type 1 or 2). The
// near-real-time feed does not label them, so a steel mill would otherwise look like a fire.
const STATIC = new Set(staticSources.cells.map(([lat, lon]) => `${lat.toFixed(2)},${lon.toFixed(2)}`));
function isStaticSource(lat: number, lon: number): boolean {
  const step = staticSources.grid_degrees;
  const la = Math.round(lat / step) * step, lo = Math.round(lon / step) * step;
  for (const dl of [-step, 0, step]) for (const dn of [-step, 0, step]) if (STATIC.has(`${(la + dl).toFixed(2)},${(lo + dn).toFixed(2)}`)) return true;
  return false;
}

/** Active fire detections within `km` of the place (known industrial heat sources removed). */
export async function firesNear(place: { latitude: number; longitude: number }, km: number): Promise<{ latitude: number; longitude: number; km: number }[]> {
  const rows = await firmsRows();
  return rows.map(([latitude, longitude]) => ({ latitude, longitude, km: round(distanceKm(place.latitude, place.longitude, latitude, longitude))! })).filter((f) => f.km <= km);
}

async function firmsRows(): Promise<[number, number][]> {
  return cached("firms:usa24h", 15 * 60_000, async () => {
    const response = await fetch("https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`FIRMS returned ${response.status}`);
    const [header, ...lines] = (await response.text()).trim().split("\n");
    const cols = header.split(",");
    const lat = cols.indexOf("latitude"), lon = cols.indexOf("longitude"), conf = cols.indexOf("confidence");
    return lines.map((line) => line.split(",")).filter((v) => ["n", "h", "nominal", "high"].includes(v[conf]))
      .map((v) => [Number(v[lat]), Number(v[lon])] as [number, number]).filter(([a, b]) => !isStaticSource(a, b));
  });
}

async function nearestFire(place: Place): Promise<{ km: number | null; detections: number }> {
  const rows = await firmsRows();
  let km: number | null = null, near = 0;
  for (const [lat, lon] of rows) {
    const d = distanceKm(place.latitude, place.longitude, lat, lon);
    if (km === null || d < km) km = d;
    if (d <= 50) near += 1;
  }
  return { km: km === null ? null : round(km), detections: near };
}

// --- assemble -------------------------------------------------------------------------------------

function item(id: EvidenceId, kind: Evidence["kind"], label: string, value: number | null, unit: string, text: string, source: Evidence["source"]): Evidence {
  return { id, kind, label, value, unit, text, source };
}

export async function gatherEvidence(place: Place, trip: Trip): Promise<EvidenceReport> {
  const token = process.env.EARTHDATA_TOKEN || "";
  const [typical, recentGpm, forecasted, land, fire] = await Promise.allSettled([
    typicalConditions(place, trip),
    token ? recentRainGpm(place, token) : Promise.reject(new Error("EARTHDATA_TOKEN is not set")),
    forecast(place, trip),
    token ? terrain(place, token) : Promise.reject(new Error("EARTHDATA_TOKEN is not set")),
    trip.fireWarnings ? nearestFire(place) : Promise.resolve(null),
  ]);
  const evidence: EvidenceReport["evidence"] = {};
  const forecastDays: ForecastDay[] = forecasted.status === "fulfilled" ? forecasted.value.days : ((forecasted.reason as { days?: ForecastDay[] })?.days ?? []);
  const unavailable: EvidenceReport["unavailable"] = [];
  const add = (e: Evidence) => { evidence[e.id] = e; };
  const fail = (source: string, result: PromiseSettledResult<unknown>) => { if (result.status === "rejected") unavailable.push({ source, reason: (result.reason as Error)?.message ?? "unavailable" }); };

  if (land.status === "fulfilled") {
    const src = { name: "NASA SRTM", product: "SRTMGL3 v003, 90 m elevation", url: "https://lpdaac.usgs.gov/products/srtmgl3v003/", period: "Shuttle Radar Topography Mission, February 2000" };
    add(item("terrain.elevation", "terrain", "Elevation", land.value.elevation, "m", `About ${land.value.elevation} m above sea level.`, src));
    add(item("terrain.relief", "terrain", "Relief within 5 km", land.value.relief, "m", `The land within 5 km spans ${land.value.relief} m from lowest to highest.`, src));
  } else fail("NASA SRTM elevation", land);

  if (typical.status === "fulfilled" && typical.value.days > 0) {
    const t = typical.value;
    const src = { name: "NASA POWER", product: "Daily MERRA-2 meteorology", url: "https://power.larc.nasa.gov/", period: t.period };
    add(item("typical.high", "typical", "Typical daytime high", t.high, "°C", `Daytime highs average ${t.high}°C around these dates.`, src));
    add(item("typical.low", "typical", "Typical overnight low", t.low, "°C", `Nights average ${t.low}°C.`, src));
    add(item("typical.coldNight", "typical", "Cold night (1 in 10)", t.coldNight, "°C", `One night in ten drops to ${t.coldNight}°C or colder.`, src));
    add(item("typical.rainDays", "typical", "Rainy days", t.rainDays, "share", `It rained on ${Math.round((t.rainDays ?? 0) * 100)}% of these days.`, src));
    add(item("typical.uv", "typical", "UV index (24-hour average)", t.uv, "index", `The 24-hour average UV index is ${t.uv}.`, src));
    add(item("typical.wind", "typical", "Strong gusts (1 in 10 days)", t.wind, "m/s", `One day in ten has gusts of ${t.wind} m/s or more.`, src));
    add(item("typical.snow", "typical", "Days with snow on the ground", t.snow, "share", `At least 2 cm of snow lay on ${Math.round((t.snow ?? 0) * 100)}% of these days across the ~50 km NASA POWER cell.`, src));
    // POWER cells are about 50 km wide; correct the cold night to the actual site elevation from SRTM.
    if (land.status === "fulfilled" && t.gridElevation !== null && t.coldNight !== null) {
      const siteLow = round(t.coldNight - (land.value.elevation - t.gridElevation) * LAPSE_C_PER_M);
      add(item("typical.siteLow", "typical", "Cold night at the site", siteLow, "°C", `Adjusted for the site's ${land.value.elevation} m elevation against the ${Math.round(t.gridElevation)} m average of the NASA POWER cell: about ${siteLow}°C.`, { ...src, product: "NASA POWER with SRTM elevation adjustment" }));
    }
  } else fail("NASA POWER typical conditions", typical);

  if (recentGpm.status === "fulfilled") {
    add(item("recent.rain7d", "recent", "Rain in the last 7 days", round(recentGpm.value.total), "mm", `${round(recentGpm.value.total)} mm of satellite-measured rain in the ${recentGpm.value.days} days through ${recentGpm.value.through}.`, { name: "NASA GPM IMERG", product: "IMERG Late Run daily V07, 0.1° satellite precipitation", url: "https://gpm.nasa.gov/data/imerg", period: `${recentGpm.value.days} days through ${recentGpm.value.through}` }));
  } else {
    fail("NASA GPM IMERG", recentGpm);
    try {
      const r = await recentRainPower(place);
      add(item("recent.rain7d", "recent", "Rain in the last 7 days", round(r.total), "mm", `${round(r.total)} mm in the ${r.days} published days through ${r.through}.`, { name: "NASA POWER", product: "Daily MERRA-2 precipitation (reanalysis, published a few days late)", url: "https://power.larc.nasa.gov/", period: `${r.days} days through ${r.through}` }));
    } catch (error) {
      unavailable.push({ source: "NASA POWER recent rain", reason: (error as Error).message });
    }
  }

  if (forecasted.status === "fulfilled") {
    const f = forecasted.value;
    const src = { name: f.source, product: "Forecast (not NASA)", url: f.url, period: `${trip.startDate} to ${addDays(trip.startDate, trip.nights)}` };
    add(item("forecast.high", "forecast", "Forecast high", f.high, "°C", `Forecast highs up to ${f.high}°C${f.summary ? ` (${f.summary})` : ""}.`, src));
    add(item("forecast.low", "forecast", "Forecast low", f.low, "°C", `Forecast lows down to ${f.low}°C.`, src));
    add(item("forecast.rainChance", "forecast", "Chance of rain", f.rainChance, "%", `Up to ${f.rainChance}% chance of rain.`, src));
  } else fail("Weather forecast", forecasted);

  if (trip.fireWarnings) {
    if (fire.status === "fulfilled" && fire.value) {
      const src = { name: "NASA FIRMS", product: "VIIRS NOAA-20 active fire, last 24 hours, known industrial heat sources removed", url: "https://firms.modaps.eosdis.nasa.gov/", period: "Last 24 hours" };
      add(item("hazard.fireKm", "hazard", "Nearest active fire", fire.value.km, "km", fire.value.km === null ? "No active fires detected in the US feed." : `Nearest satellite fire detection is ${fire.value.km} km away (${fire.value.detections} within 50 km).`, src));
    } else fail("NASA FIRMS", fire);
  }
  return { place, forecastDays, evidence, unavailable };
}
