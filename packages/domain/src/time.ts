const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^([01]\d|2[0-3])([0-5]\d)$/;

export function parseFirmsAcquisition(date: string, hhmm: string): string | null {
  const day = DAY.exec(date.trim());
  const clock = HHMM.exec(hhmm.trim());
  if (!day || !clock) return null;
  const year = Number(day[1]);
  const month = Number(day[2]);
  const dateNum = Number(day[3]);
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  const utc = new Date(Date.UTC(year, month - 1, dateNum, hour, minute, 0, 0));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== dateNum
  ) {
    return null;
  }
  return utc.toISOString().replace(".000Z", "Z");
}

export function parseUtc(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const canonical = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== canonical) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function inAttentionWindow(observedAt: string, asOf: string, hours = 24): boolean {
  const observed = parseUtc(observedAt);
  const end = parseUtc(asOf);
  if (observed === null || end === null) return false;
  const start = end - hours * 60 * 60 * 1000;
  return observed > start && observed <= end;
}

export function atOrBefore(observedAt: string, asOf: string): boolean {
  const observed = parseUtc(observedAt);
  const end = parseUtc(asOf);
  if (observed === null || end === null) return false;
  return observed <= end;
}

export function formatUtc(iso: string): string {
  const ms = parseUtc(iso);
  if (ms === null) return iso;
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min} UTC`;
}

export function formatPacific(iso: string): string {
  const ms = parseUtc(iso);
  if (ms === null) return iso;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(new Date(ms));
  return formatted;
}
