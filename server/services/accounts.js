import { randomBytes } from "node:crypto";
import { hashSessionId, openAccountStore } from "./accountStore.js";

/**
 * User accounts (one per Google account) and browser sessions.
 *
 * Signing in with Google creates the account the first time and signs the
 * person back in after that. Someone who skips Google still gets an
 * anonymous session so their setup answers are kept on that browser.
 * Everything is saved by accountStore.js.
 *
 * Profile:
 *   { focus, priority, budget, completedAt }
 *   focus: "groceries" | "outdoors" | "events" | "tech" | null
 *   priority: "price" | "speed" | "trusted" | null
 *   budget: "under-100" | "100-300" | "300-plus" | null
 */

const COOKIE = "pb_sid";
const MAX_AGE_S = 30 * 24 * 60 * 60;

export const FOCUS = ["groceries", "outdoors", "events", "tech"];
export const PRIORITY = ["price", "speed", "trusted"];
export const BUDGET = ["under-100", "100-300", "300-plus"];
const BUDGET_MAX = { "under-100": 100, "100-300": 300, "300-plus": null };

let store = null;
function db() {
  store ??= openAccountStore();
  return store;
}

/** Point accounts at a different store (tests use a temp file). */
export function useAccountStore(next) {
  store = next;
}

export function persist() {
  db().save();
}

export function emptyProfile() {
  return { focus: null, priority: null, budget: null, completedAt: null };
}

function readCookie(req) {
  const header = req.headers.cookie || "";
  const match = header.split(/;\s*/).find((part) => part.startsWith(`${COOKIE}=`));
  return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : null;
}

function cookie(value, maxAge) {
  const secure = String(process.env.APP_ORIGIN || "").startsWith("https://") ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** The request's session, or null. Never creates one. */
export function currentSession(req) {
  const sid = readCookie(req);
  if (!sid) return null;
  const session = db().sessions.get(hashSessionId(sid));
  return session && session.expiresAt > Date.now() ? session : null;
}

/** The request's session, creating it (and its cookie) when missing. */
export function ensureSession(req, res) {
  const existing = currentSession(req);
  if (existing) return existing;
  const sid = randomBytes(24).toString("base64url");
  const session = { id: hashSessionId(sid), accountId: null, profile: emptyProfile(), expiresAt: Date.now() + MAX_AGE_S * 1000 };
  db().sessions.set(session.id, session);
  persist();
  res.append("Set-Cookie", cookie(sid, MAX_AGE_S));
  return session;
}

export function endSession(req, res) {
  const session = currentSession(req);
  if (session) {
    db().sessions.delete(session.id);
    persist();
  }
  res.append("Set-Cookie", cookie("", 0));
}

export function accountFor(session) {
  return session?.accountId ? db().accounts.get(session.accountId) || null : null;
}

/**
 * Create or update the account for a Google identity and attach it to the
 * session. Setup answers given before signing in carry over unless the
 * account already finished setup.
 */
export function signIn(session, { sub, email, name, picture, tokens }) {
  const previous = db().accounts.get(sub);
  const profile = previous?.profile?.completedAt ? previous.profile : session.profile;
  const account = {
    id: sub,
    email,
    name,
    picture,
    tokens: { ...previous?.tokens, ...tokens, refreshToken: tokens.refreshToken || previous?.tokens?.refreshToken || null },
    profile,
    createdAt: previous?.createdAt || new Date().toISOString(),
    lastSignInAt: new Date().toISOString(),
  };
  db().accounts.set(sub, account);
  session.accountId = sub;
  persist();
  return account;
}

/** Delete the account and every session signed in to it. */
export function deleteAccount(session) {
  const account = accountFor(session);
  if (!account) return false;
  db().accounts.delete(account.id);
  for (const [id, other] of db().sessions) {
    if (other.accountId === account.id) db().sessions.delete(id);
  }
  persist();
  return true;
}

export function profileFor(session) {
  return accountFor(session)?.profile || session?.profile || emptyProfile();
}

/** Validate and save setup answers. Returns { profile } or { error }. */
export function saveProfile(session, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Expected a profile object" };
  const pick = (value, allowed, name) => {
    if (value === null || value === undefined) return { value: null };
    return allowed.includes(value) ? { value } : { error: `${name} must be one of ${allowed.join(", ")}` };
  };
  const focus = pick(input.focus, FOCUS, "focus");
  const priority = pick(input.priority, PRIORITY, "priority");
  const budget = pick(input.budget, BUDGET, "budget");
  const error = focus.error || priority.error || budget.error;
  if (error) return { error };
  const profile = { focus: focus.value, priority: priority.value, budget: budget.value, completedAt: new Date().toISOString() };
  const account = accountFor(session);
  if (account) account.profile = profile;
  else session.profile = profile;
  persist();
  return { profile };
}

export function budgetMax(profile) {
  return profile?.budget ? BUDGET_MAX[profile.budget] ?? null : null;
}

export function resetAccounts() {
  if (!store) return;
  store.sessions.clear();
  store.accounts.clear();
}
