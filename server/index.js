import "./env.js";
import express from "express";
import cors from "cors";
import { pathToFileURL } from "node:url";
import { getPlan, listPlans, savePlan } from "./store.js";
import { generatePlan, validatePlanRequest } from "./services/planner.js";
import { attachOffers, pickListing, quotePlan } from "./services/pipeline.js";
import { createPythonGateway } from "./pythonGateway.js";
import { attachVoiceGateway } from "./voiceGateway.js";
import { attachFrontendGateway, createFrontendGateway, isBackendPath } from "./frontendGateway.js";
import { compareItems } from "./services/compareBot.js";
import { topItems } from "./services/topItemsBot.js";
import { assertItemUnlocked, cancelCheckout, CheckoutError, confirmCheckout, createCartCheckout, handleWebhook, stripeMode } from "./services/checkout.js";
import { storesRouter } from "./routes/stores.js";
import { accountRouter } from "./routes/account.js";
import { budgetMax, currentSession, ensureSession, profileFor } from "./services/accounts.js";
import { createOrbiCartPlan, OrbiCartError } from "./services/orbicart.js";

export function createApp(gatewayOptions, { selectListing = pickListing, frontendOptions, orbicartOptions } = {}) {
  const app = express();

  app.use(cors());
  const frontend = createFrontendGateway(frontendOptions);
  app.use((req, res, next) => isBackendPath(req.path) ? next() : frontend(req, res));
  app.use("/api/conjure", (req, res, next) => {
    if (req.path === "/planner/chat") {
      ensureSession(req, res);
      const cookies = res.getHeader("set-cookie");
      const issued = (Array.isArray(cookies) ? cookies : cookies ? [cookies] : []).find((cookie) => cookie.startsWith("pb_sid="));
      if (issued) req.headers.cookie = issued.split(";")[0];
    }
    next();
  }, createPythonGateway(gatewayOptions));
  app.get(/^\/static\/products\/([A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:png|jpe?g|webp|gif|svg))$/i, (req, res) => {
    res.redirect(307, `/api/conjure/static/products/${encodeURIComponent(req.params[0])}`);
  });
  app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => {
    try { res.json(handleWebhook(req.body, req.headers["stripe-signature"])); }
    catch (err) { sendError(res, err, "Could not handle webhook"); }
  });
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", storesRouter);
  app.use("/api", accountRouter());

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, stripe: stripeMode() });
  });

  app.get("/api/voice-health", async (req, res) => {
    try {
      const origin = gatewayOptions?.baseUrl || process.env.CONJURE_API_URL || "http://127.0.0.1:8000";
      const response = await fetch(new URL("/health", origin), { signal: AbortSignal.timeout(3000), redirect: "error" });
      if (!response.ok) throw new Error("Unavailable");
      res.json(await response.json());
    } catch {
      res.status(503).json({ ok: false, error: "Voice service is unavailable" });
    }
  });

  app.get("/api/plans", (req, res) => {
    res.json({ plans: listPlans(currentSession(req)) });
  });

  app.post("/api/orbicart/plans", async (req, res) => {
    const started = Date.now();
    try {
      const result = await createOrbiCartPlan(req.body, orbicartOptions);
      const session = ensureSession(req, res);
      savePlan(result.plan, session);
      res.status(201).json({ ...result, tookMs: Date.now() - started });
    } catch (err) {
      if (err instanceof OrbiCartError) return res.status(400).json({ error: err.message });
      sendError(res, err, "Could not retrieve camping products");
    }
  });

  app.post("/api/plans", async (req, res) => {
    try {
      const inputError = validatePlanRequest(req.body);
      if (inputError) return res.status(400).json({ error: inputError });
      const prompt = req.body.prompt.trim();
      const category = req.body.category?.trim() || "";
      const marketplaces = req.body.marketplaces;
      const prefs = prefsFor(req);
      const session = ensureSession(req, res);

      const draft = generatePlan({ prompt, category });
      const options = { ...prefs, marketplaces };
      if (req.body.async === true) {
        const plan = savePlan({ ...draft, status: "pricing", preferences: prefs, quote: quotePlan(draft.items, prefs) }, session);
        // Serverless instances may stop as soon as the response completes.
        // Finish pricing within the request there so the saved plan is usable.
        if (process.env.VERCEL) {
          await priceInBackground(plan, options);
          return res.status(201).json(plan);
        }
        res.status(201).json(plan);
        void priceInBackground(plan, options);
        return;
      }
      const items = await attachOffers(draft.items, options);
      const plan = savePlan({ ...draft, status: "ready", preferences: prefs, items, quote: quotePlan(items, prefs) }, session);
      res.status(201).json(plan);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Could not build plan" });
    }
  });

  app.get("/api/plans/:id", (req, res) => {
    const plan = getPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: "plan not found" });
    res.json(plan);
  });

  app.post("/api/compare", async (req, res) => {
    const { left, right, trust_floor: trustFloor = 0.5 } = req.body || {};
    if (!validListing(left) || !validListing(right) || !validTrustFloor(trustFloor)) {
      return res.status(400).json({ error: "left and right listings and a trust_floor between 0 and 1 are required" });
    }
    try { res.json(await compareItems(left, right, trustFloor)); }
    catch { res.status(502).json({ error: "Could not compare items" }); }
  });

  app.post("/api/top", async (req, res) => {
    const { items, limit = 10, trust_floor: trustFloor = 0.5 } = req.body || {};
    if (!Array.isArray(items) || items.length < 1 || items.length > 100 || !items.every(validListing) ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !validTrustFloor(trustFloor)) {
      return res.status(400).json({ error: "Expected 1-100 listings, limit 1-50 and trust_floor between 0 and 1" });
    }
    try { res.json(await topItems(items, { limit, trustFloor })); }
    catch { res.status(502).json({ error: "Could not rank items" }); }
  });

  app.patch("/api/plans/:id/items/:itemId", async (req, res) => {
    try {
      const plan = getPlan(req.params.id);
      if (!plan) return res.status(404).json({ error: "plan not found" });

      const index = plan.items.findIndex((item) => item.id === req.params.itemId);
      if (index === -1) return res.status(404).json({ error: "item not found" });

      const fields = req.body && !Array.isArray(req.body) ? Object.keys(req.body) : [];
      if (fields.length !== 1 || !["purchased", "owned"].includes(fields[0]) || typeof req.body[fields[0]] !== "boolean") {
        return res.status(400).json({ error: "Send exactly one purchased or owned boolean" });
      }
      assertItemUnlocked(plan.id, req.params.itemId);
      if (plan.items[index].order && fields[0] === "purchased" && req.body.purchased === false) {
        return res.status(409).json({ error: "A paid order cannot be marked unpaid" });
      }

      const nextItem = { ...plan.items[index], [fields[0]]: req.body[fields[0]] };
      plan.items[index] = nextItem;
      if (!nextItem.purchased && !nextItem.owned && !nextItem.synthesis && plan.status !== "pricing") {
        const [withOffer] = await attachOffers([nextItem], plan.preferences || prefsFor(req));
        const current = plan.items[index];
        if (!current.synthesis && !current.order) {
          plan.items[index] = { ...withOffer, purchased: current.purchased, owned: current.owned };
        }
      }

      plan.quote = quotePlan(plan.items, plan.preferences || prefsFor(req));
      res.json(plan);
    } catch (err) {
      sendError(res, err, "Could not update item");
    }
  });

  app.put("/api/plans/:id/items/:itemId/listing", async (req, res) => {
    const plan = getPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: "plan not found" });

    const index = plan.items.findIndex((item) => item.id === req.params.itemId);
    if (index === -1) return res.status(404).json({ error: "item not found" });
    if (plan.items[index].purchased || plan.items[index].owned || plan.items[index].order) {
      return res.status(409).json({ error: "item already purchased or owned" });
    }

    let picked;
    try {
      assertItemUnlocked(plan.id, req.params.itemId);
      picked = await selectListing(plan.items[index], req.body?.listingId);
      // A checkout or ownership update can arrive while ranking is awaited.
      assertItemUnlocked(plan.id, req.params.itemId);
    } catch (err) { return sendError(res, err, "Could not select listing"); }
    if (!picked) return res.status(404).json({ error: "listing not found for this item" });

    const currentIndex = plan.items.findIndex((item) => item.id === req.params.itemId);
    const current = plan.items[currentIndex];
    if (!current) return res.status(404).json({ error: "item not found" });
    if (current.purchased || current.owned || current.order) {
      return res.status(409).json({ error: "item was purchased or marked owned while selecting" });
    }
    plan.items[currentIndex] = { ...current, synthesis: picked.synthesis, selectedListingId: picked.selectedListingId };
    plan.quote = quotePlan(plan.items, plan.preferences || prefsFor(req));
    res.json(plan);
  });

  app.post("/api/checkout", async (req, res) => {
    try {
      const cart = req.body?.cart === undefined ? [{ planId: req.body?.planId, itemIds: req.body?.itemIds }] : req.body.cart;
      res.status(201).json(await createCartCheckout(cart));
    } catch (err) {
      sendError(res, err, "Could not start checkout");
    }
  });

  app.get("/api/checkout/:sessionId", async (req, res) => {
    try {
      res.json(await confirmCheckout(req.params.sessionId));
    } catch (err) {
      sendError(res, err, "Could not confirm checkout");
    }
  });

  app.post("/api/checkout/:sessionId/cancel", async (req, res) => {
    try { res.json(await cancelCheckout(req.params.sessionId)); }
    catch (err) { sendError(res, err, "Could not cancel checkout"); }
  });

  app.use((err, req, res, next) => {
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large" });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON request" });
    res.status(500).json({ error: "Unexpected server error" });
  });
  return app;
}

async function priceInBackground(plan, options) {
  await Promise.all(plan.items.map(async (draft) => {
    let priced;
    try { [priced] = await attachOffers([draft], options); }
    catch { priced = { ...draft, pricingFailed: true }; }
    plan.items = plan.items.map((current) => {
      if (current.id !== draft.id) return current;
      // Keep ownership, purchase and explicit selection edits made while pricing.
      if (current.selectedListingId) return current;
      return { ...priced, purchased: current.purchased, owned: current.owned };
    });
    plan.quote = quotePlan(plan.items, plan.preferences);
  }));
  plan.status = "ready";
}

function prefsFor(req) {
  const profile = profileFor(currentSession(req));
  return { priority: profile.priority, budgetMax: budgetMax(profile) };
}

function sendError(res, err, fallback) {
  if (err instanceof CheckoutError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: fallback });
}


function validListing(value) {
  return value && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string";
}

function validTrustFloor(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

const app = createApp();
export default app;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 3001;
  const server = app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  attachVoiceGateway(server);
  attachFrontendGateway(server);
}
