import { afterEach, before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { accountRouter } from "../routes/account.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetAccounts, useAccountStore } from "../services/accounts.js";
import { openAccountStore } from "../services/accountStore.js";
import { readIdToken } from "../services/google.js";
import { classify, suggestionsFromEvents } from "../services/occasions.js";
import { synthesize } from "../services/synthesizeBot.js";
import { quotePlan } from "../services/pipeline.js";

const ENV = { GOOGLE_CLIENT_ID: "client-1", GOOGLE_CLIENT_SECRET: "secret", APP_ORIGIN: "http://app.test" };

function idToken(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.sig`;
}

/** Stand-in for Google's token and Calendar endpoints. */
function fakeGoogle(log = []) {
  return async (url, init = {}) => {
    log.push({ url: String(url), init });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      const form = new URLSearchParams(init.body);
      if (form.get("grant_type") === "refresh_token") {
        return Response.json({ access_token: "access-2", expires_in: 3600, scope: "openid https://www.googleapis.com/auth/calendar.readonly" });
      }
      assert.equal(form.get("code"), "good-code");
      assert.ok(form.get("code_verifier"));
      return Response.json({
        access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600,
        scope: "openid email profile https://www.googleapis.com/auth/calendar.readonly",
        id_token: idToken({ iss: "https://accounts.google.com", aud: "client-1", sub: "user-1", email: "sam@example.com", given_name: "Sam", exp: Date.now() / 1000 + 600 }),
      });
    }
    if (String(url).startsWith("https://www.googleapis.com/calendar/v3")) {
      return Response.json({ items: [
        { id: "a", summary: "Standup", start: { dateTime: "2026-10-20T16:00:00Z" } },
        { id: "b", summary: "Camping at Rainier", start: { date: "2026-10-24" } },
        { id: "c", summary: "Mia's birthday party", start: { dateTime: "2026-10-30T01:00:00Z" }, attendees: [{ self: true, responseStatus: "declined" }] },
        { id: "d", summary: "Sarah & Ben Wedding", start: { date: "2026-11-08" } },
      ] });
    }
    return new Response("{}", { status: 404 });
  };
}

let server;
let base;
let log;
let dir;
let storeFile;

before(async () => {
  log = [];
  dir = mkdtempSync(join(tmpdir(), "planboard-accounts-"));
  storeFile = join(dir, "accounts.json");
  useAccountStore(openAccountStore({ ACCOUNTS_FILE: storeFile, SESSION_SECRET: "test-secret" }));
  const app = express();
  app.use(express.json());
  app.use("/api", accountRouter({ env: ENV, fetchImpl: fakeGoogle(log) }));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});
afterEach(() => { resetAccounts(); log.length = 0; });

/** A tiny cookie-keeping client. */
function browser() {
  let cookie = "";
  return async (path, init = {}) => {
    const response = await fetch(base + path, { redirect: "manual", ...init, headers: { ...(init.headers || {}), cookie } });
    const set = response.headers.getSetCookie?.() ?? [];
    for (const line of set) cookie = line.split(";")[0];
    return response;
  };
}

describe("onboarding API", () => {
  it("starts anonymous with an empty profile", async () => {
    const body = await (await browser()("/api/me")).json();
    assert.equal(body.user, null);
    assert.equal(body.profile.completedAt, null);
    assert.deepEqual(body.google, { available: true, connected: false, calendar: false });
  });

  it("saves quiz answers without signing in, and rejects unknown values", async () => {
    const go = browser();
    const bad = await go("/api/me/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: "vibes" }) });
    assert.equal(bad.status, 400);
    const ok = await go("/api/me/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ focus: "outdoors", priority: "speed", budget: "100-300" }) });
    assert.equal(ok.status, 200);
    const me = await (await go("/api/me")).json();
    assert.equal(me.profile.priority, "speed");
    assert.ok(me.profile.completedAt);
  });

  it("signs in with Google using state and PKCE, then suggests calendar events", async () => {
    const go = browser();
    const start = await go("/api/auth/google/start");
    assert.equal(start.status, 302);
    const auth = new URL(start.headers.get("location"));
    assert.equal(auth.origin, "https://accounts.google.com");
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    assert.equal(auth.searchParams.get("redirect_uri"), "http://app.test/api/auth/google/callback");
    assert.match(auth.searchParams.get("scope"), /calendar\.readonly/);
    assert.doesNotMatch(auth.searchParams.get("scope"), /gmail/);

    const forged = await go(`/api/auth/google/callback?code=good-code&state=wrong`);
    assert.equal(forged.headers.get("location"), "http://app.test/?google=expired");

    await go("/api/auth/google/start").then((response) => auth.search = new URL(response.headers.get("location")).search);
    const done = await go(`/api/auth/google/callback?code=good-code&state=${auth.searchParams.get("state")}`);
    assert.equal(done.headers.get("location"), "http://app.test/?google=connected");

    const me = await (await go("/api/me")).json();
    assert.deepEqual(me.user, { email: "sam@example.com", name: "Sam", picture: null });
    assert.equal(me.google.calendar, true);

    const { suggestions } = await (await go("/api/calendar/suggestions")).json();
    assert.deepEqual(suggestions.map((item) => [item.title, item.category]), [
      ["Camping at Rainier", "camping"],
      ["Sarah & Ben Wedding", "wedding"],
    ]);
    const calendarCall = log.find((call) => call.url.includes("calendar/v3"));
    assert.equal(calendarCall.init.headers.Authorization, "Bearer access-1");
  });

  it("keeps quiz answers given before signing in", async () => {
    const go = browser();
    await go("/api/me/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ focus: "events", priority: "trusted", budget: null }) });
    const start = await go("/api/auth/google/start");
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    await go(`/api/auth/google/callback?code=good-code&state=${state}`);
    const me = await (await go("/api/me")).json();
    assert.equal(me.profile.priority, "trusted");
  });

  it("reports a denied consent screen back to the app", async () => {
    const go = browser();
    await go("/api/auth/google/start");
    const denied = await go("/api/auth/google/callback?error=access_denied");
    assert.equal(denied.headers.get("location"), "http://app.test/?google=denied");
  });

  it("needs sign-in for calendar suggestions", async () => {
    const response = await browser()("/api/calendar/suggestions");
    assert.equal(response.status, 401);
  });
});

describe("saved accounts", () => {
  async function signInBrowser() {
    const go = browser();
    const start = await go("/api/auth/google/start");
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    await go(`/api/auth/google/callback?code=good-code&state=${state}`);
    await go("/api/me/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ focus: "tech", priority: "price", budget: "300-plus" }) });
    return go;
  }

  it("keeps accounts and sign-ins across a server restart", async () => {
    const go = await signInBrowser();
    useAccountStore(openAccountStore({ ACCOUNTS_FILE: storeFile, SESSION_SECRET: "test-secret" }));
    const me = await (await go("/api/me")).json();
    assert.equal(me.user.email, "sam@example.com");
    assert.equal(me.profile.focus, "tech");
    const { suggestions } = await (await go("/api/calendar/suggestions")).json();
    assert.equal(suggestions.length, 2, "decrypted tokens still reach Google Calendar");
  });

  it("stores no raw session ids, tokens or sign-in verifiers", async () => {
    const go = browser();
    await go("/api/auth/google/start");
    const signedIn = await signInBrowser();
    const text = readFileSync(storeFile, "utf8");
    for (const secret of ["access-1", "refresh-1", "code_verifier", "verifier"]) assert.doesNotMatch(text, new RegExp(secret));
    const saved = JSON.parse(text);
    assert.equal(saved.accounts[0].email, "sam@example.com");
    assert.equal(typeof saved.accounts[0].tokens, "string");
    assert.ok(saved.sessions.every((session) => !("oauth" in session)));
    assert.ok(signedIn);
  });

  it("signs in again, without crashing, when the secret changes", async () => {
    const go = await signInBrowser();
    useAccountStore(openAccountStore({ ACCOUNTS_FILE: storeFile, SESSION_SECRET: "rotated" }));
    const me = await (await go("/api/me")).json();
    assert.equal(me.user.email, "sam@example.com");
    assert.equal(me.google.calendar, false, "unreadable tokens mean reconnect the calendar");
    const body = await (await go("/api/calendar/suggestions")).json();
    assert.deepEqual(body, { suggestions: [], calendar: false });
    useAccountStore(openAccountStore({ ACCOUNTS_FILE: storeFile, SESSION_SECRET: "test-secret" }));
  });

  it("deletes the account, revokes Google access and signs out", async () => {
    const go = await signInBrowser();
    const response = await go("/api/me", { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.ok(log.some((call) => call.url.startsWith("https://oauth2.googleapis.com/revoke")));
    const me = await (await go("/api/me")).json();
    assert.equal(me.user, null);
    assert.equal(JSON.parse(readFileSync(storeFile, "utf8")).accounts.length, 0);
  });
});

describe("Google ID token", () => {
  it("rejects tokens for another app or issuer", () => {
    const claims = { iss: "https://accounts.google.com", aud: "client-1", sub: "u", exp: Date.now() / 1000 + 60 };
    assert.equal(readIdToken(idToken(claims), "client-1").sub, "u");
    assert.throws(() => readIdToken(idToken({ ...claims, aud: "other" }), "client-1"), /another app/);
    assert.throws(() => readIdToken(idToken({ ...claims, iss: "https://evil.example" }), "client-1"), /issuer/);
    assert.throws(() => readIdToken(idToken({ ...claims, exp: 1 }), "client-1"), /expired/);
  });
});

describe("occasions", () => {
  it("classifies plannable events and ignores the rest", () => {
    assert.equal(classify("Backpacking Enchantments")?.category, "camping");
    assert.equal(classify("Friendsgiving potluck")?.category, "custom");
    assert.equal(classify("1:1 with manager"), null);
    assert.equal(classify("Campus tour"), null);
  });

  it("counts days away and drops duplicates", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    const events = [
      { id: "1", summary: "BBQ", start: { date: "2026-10-25" } },
      { id: "2", summary: "BBQ", start: { date: "2026-10-25" } },
      { id: "3", summary: "Ski trip", start: { date: "2026-12-01" }, status: "cancelled" },
    ];
    const suggestions = suggestionsFromEvents(events, { now });
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].daysAway, 7);
    assert.equal(suggestions[0].prompt, "I need to prepare for BBQ.");
  });
});

describe("preferences shape offers", () => {
  const products = [
    { id: "a", store: "Cheap", title: "Tent", price: 40, currency: "USD", trust: 0.9, inStock: true, shippingDays: 9 },
    { id: "b", store: "Fast", title: "Tent", price: 70, currency: "USD", trust: 0.6, inStock: true, shippingDays: 1 },
    { id: "c", store: "eBay seller", title: "Tent", price: 30, currency: "USD", trust: 0.4, inStock: true, shippingDays: 5, source: "ebay" },
  ];
  const item = { name: "Tent", quantity: 1 };

  it("picks by price, reported speed or explicit trust evidence", async () => {
    assert.equal((await synthesize(item, products)).best.id, "c");
    assert.equal((await synthesize(item, products, { priority: "speed" })).best.id, "b");
    const trusted = await synthesize(item, products, { priority: "trusted" });
    assert.equal(trusted.best.id, "a");
    assert.equal(trusted.choice, "Highest available trust score; missing evidence remains unknown");
  });

  it("flags a plan over the onboarding budget", () => {
    const items = [{ purchased: false, quantity: 1, synthesis: { totalPrice: 120, currency: "USD", shippingDate: null } }];
    assert.equal(quotePlan(items, { budgetMax: 100 }).overBudget, true);
    assert.equal(quotePlan(items).overBudget, null);
  });
});
