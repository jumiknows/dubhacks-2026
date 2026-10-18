import { timingSafeEqual } from "node:crypto";

const windows = new Map<string, { start: number; count: number }>();
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function voiceAccess(request: Request, kind: "speech" | "session"): Response | null {
  const deny = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
  if (!process.env.XAI_API_KEY) return deny(503, "missing-credential", "XAI_API_KEY is not configured. The readable briefing remains available.");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return deny(403, "forbidden", "Use Voice from this application.");
  const privateMode = process.env.VOICE_ACCESS_MODE === "private-site";
  const privateSite = privateMode && !!request.headers.get("oai-authenticated-user-id");
  const token = process.env.VOICE_ACCESS_TOKEN;
  const authorized = privateMode ? privateSite : !!token && sameSecret(request.headers.get("authorization") ?? "", `Bearer ${token}`);
  if (!authorized) return deny(403, "forbidden", "Voice requires an authorized demo session. Enter the demo access code or use the private hosted app.");
  const now = Date.now();
  let window = windows.get(kind);
  if (!window || now - window.start >= 600_000) { window = { start: now, count: 0 }; windows.set(kind, window); }
  const limit = kind === "session" ? 5 : 20;
  if (window.count >= limit) return deny(429, "rate-limited", "The demo Voice quota is reached. Try again after ten minutes.");
  window.count += 1;
  return null;
}
