import { Router } from "express";
import {
  accountFor, currentSession, deleteAccount, endSession, ensureSession, persist, profileFor, saveProfile, signIn,
} from "../services/accounts.js";
import {
  beginSignIn, finishSignIn, googleConfig, GoogleError, hasCalendarScope, revoke, upcomingEvents,
} from "../services/google.js";
import { suggestionsFromEvents } from "../services/occasions.js";

const SIGN_IN_TTL_MS = 10 * 60 * 1000;

/** Onboarding: who is this, what do they like, and what is coming up on their calendar. */
export function accountRouter({ env = process.env, fetchImpl = fetch } = {}) {
  const router = Router();
  const config = () => googleConfig(env);

  router.get("/me", (req, res) => {
    const session = currentSession(req);
    const account = accountFor(session);
    res.json({
      user: account ? { email: account.email, name: account.name, picture: account.picture } : null,
      profile: profileFor(session),
      google: { available: config().enabled, connected: Boolean(account), calendar: hasCalendarScope(account) },
    });
  });

  router.put("/me/profile", (req, res) => {
    const session = ensureSession(req, res);
    const result = saveProfile(session, req.body);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ profile: result.profile });
  });

  router.get("/auth/google/start", (req, res) => {
    const settings = config();
    if (!settings.enabled) return res.status(503).json({ error: "Google sign-in is not set up on this server" });
    const session = ensureSession(req, res);
    const { url, pending } = beginSignIn(settings);
    session.oauth = pending;
    res.redirect(302, url);
  });

  router.get("/auth/google/callback", async (req, res) => {
    const settings = config();
    const back = (status) => res.redirect(302, `${settings.appOrigin}/?google=${status}`);
    const session = currentSession(req);
    const pending = session?.oauth;
    if (session) session.oauth = null;
    if (req.query.error) return back(req.query.error === "access_denied" ? "denied" : "error");
    if (!pending || req.query.state !== pending.state || Date.now() - pending.createdAt > SIGN_IN_TTL_MS) return back("expired");
    if (typeof req.query.code !== "string") return back("error");
    try {
      const identity = await finishSignIn(settings, { code: req.query.code, verifier: pending.verifier }, fetchImpl);
      signIn(session, identity);
      back("connected");
    } catch (err) {
      console.error("[google] sign-in failed:", err.message);
      back("error");
    }
  });

  router.get("/calendar/suggestions", async (req, res) => {
    const account = accountFor(currentSession(req));
    if (!account) return res.status(401).json({ error: "Sign in with Google to see calendar suggestions" });
    if (!hasCalendarScope(account)) return res.json({ suggestions: [], calendar: false });
    try {
      const events = await upcomingEvents(config(), account, {}, fetchImpl);
      persist(); // the access token may have been refreshed
      res.json({ suggestions: suggestionsFromEvents(events), calendar: true });
    } catch (err) {
      const status = err instanceof GoogleError && err.status === 401 ? 401 : 502;
      res.status(status).json({ error: err instanceof GoogleError ? err.message : "Calendar is unavailable" });
    }
  });

  /** Delete the account, revoke Planboard's Google access, and sign out everywhere. */
  router.delete("/me", async (req, res) => {
    const session = currentSession(req);
    const account = accountFor(session);
    if (!account) return res.status(401).json({ error: "Not signed in" });
    await revoke(account, fetchImpl);
    deleteAccount(session);
    endSession(req, res);
    res.json({ ok: true });
  });

  router.post("/auth/logout", async (req, res) => {
    const session = currentSession(req);
    const account = accountFor(session);
    if (account && req.body?.revoke === true) await revoke(account, fetchImpl);
    endSession(req, res);
    res.json({ ok: true });
  });

  return router;
}
