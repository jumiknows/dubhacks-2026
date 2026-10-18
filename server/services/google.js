import { createHash, randomBytes } from "node:crypto";

/**
 * Google sign-in (OpenID Connect, authorization code + PKCE) and read-only
 * Calendar access. Tokens stay on the server; the browser only holds a
 * session cookie.
 *
 * server/.env:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   OAuth "Web application" client
 *   APP_ORIGIN                               where the app is served (default http://localhost:3001)
 *   GOOGLE_REDIRECT_URI                      default `${APP_ORIGIN}/api/auth/google/callback`
 */

export const SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.readonly"];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export class GoogleError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

export function googleConfig(env = process.env) {
  const appOrigin = (env.APP_ORIGIN || "http://localhost:3001").replace(/\/$/, "");
  return {
    enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    clientId: env.GOOGLE_CLIENT_ID || "",
    clientSecret: env.GOOGLE_CLIENT_SECRET || "",
    appOrigin,
    redirectUri: env.GOOGLE_REDIRECT_URI || `${appOrigin}/api/auth/google/callback`,
  };
}

/** Start a sign-in: the URL to send the browser to, plus what the callback must check. */
export function beginSignIn(config) {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "select_account consent",
  });
  return { url: `${AUTH_URL}?${params}`, pending: { state, verifier, createdAt: Date.now() } };
}

async function postForm(url, form, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new GoogleError("Google could not be reached");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new GoogleError(body.error_description || body.error || `Google returned ${response.status}`, response.status);
  return body;
}

function tokensFrom(body) {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
    scope: body.scope || "",
  };
}

/** Exchange the callback code. Returns the user's identity and tokens. */
export async function finishSignIn(config, { code, verifier }, fetchImpl = fetch) {
  const body = await postForm(TOKEN_URL, {
    code,
    code_verifier: verifier,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  }, fetchImpl);
  const claims = readIdToken(body.id_token, config.clientId);
  return {
    sub: claims.sub,
    email: claims.email || null,
    name: claims.given_name || claims.name || null,
    picture: claims.picture || null,
    tokens: tokensFrom(body),
  };
}

/**
 * Read the ID token's claims. It came straight from Google's token endpoint
 * over TLS, so OpenID Connect allows skipping the signature check; we still
 * check issuer, audience and expiry.
 */
export function readIdToken(idToken, clientId) {
  const payload = typeof idToken === "string" ? idToken.split(".")[1] : null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new GoogleError("Google sign-in returned no identity");
  }
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) throw new GoogleError("Unexpected token issuer");
  if (claims.aud !== clientId) throw new GoogleError("Token was issued for another app");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now() - 60_000) throw new GoogleError("Sign-in expired, try again");
  if (typeof claims.sub !== "string" || !claims.sub) throw new GoogleError("Google sign-in returned no identity");
  return claims;
}

/** A valid access token, refreshing it when it is about to expire. Mutates account.tokens. */
export async function accessToken(config, account, fetchImpl = fetch) {
  const tokens = account.tokens || {};
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  if (!tokens.refreshToken) throw new GoogleError("Calendar access expired, sign in again", 401);
  const body = await postForm(TOKEN_URL, {
    refresh_token: tokens.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  }, fetchImpl);
  account.tokens = { ...tokens, ...tokensFrom(body), refreshToken: body.refresh_token || tokens.refreshToken };
  return account.tokens.accessToken;
}

export function hasCalendarScope(account) {
  return String(account?.tokens?.scope || "").split(" ").includes("https://www.googleapis.com/auth/calendar.readonly");
}

/** Upcoming events from the primary calendar. Only the fields we use are requested. */
export async function upcomingEvents(config, account, { days = 45, now = new Date() } = {}, fetchImpl = fetch) {
  const token = await accessToken(config, account, fetchImpl);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + days * 86_400_000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
    fields: "items(id,status,summary,start,attendees(self,responseStatus))",
  });
  let response;
  try {
    response = await fetchImpl(`${EVENTS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new GoogleError("Google Calendar could not be reached");
  }
  if (!response.ok) throw new GoogleError(`Google Calendar returned ${response.status}`, response.status);
  const body = await response.json();
  return body.items ?? [];
}

export async function revoke(account, fetchImpl = fetch) {
  const token = account?.tokens?.refreshToken || account?.tokens?.accessToken;
  if (!token) return;
  await postForm(REVOKE_URL, { token }, fetchImpl).catch(() => undefined);
}
