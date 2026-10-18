import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPlan, savePlan } from "./store.js";
import { generatePlan, validatePlanRequest } from "./services/planner.js";
import { attachOffers, pickListing, quotePlan } from "./services/pipeline.js";
import { CheckoutError, confirmCheckout, createCartCheckout, handleWebhook, stripeMode } from "./services/checkout.js";
import { compareItems } from "./services/compareBot.js";
import { topItems } from "./services/topItemsBot.js";
import { createPythonGateway } from "./pythonGateway.js";
import { storesRouter } from "./routes/stores.js";
import { attachLiveTunnel } from "./liveTunnel.js";

const DEFAULT_CLIENT_DIST = fileURLToPath(new URL("../client/dist", import.meta.url));

export function createApp(gatewayOptions, { clientDist = DEFAULT_CLIENT_DIST } = {}) {
  const app = express();

  app.use(cors());
  app.use("/api/conjure", createPythonGateway(gatewayOptions));

  // Stripe signs the raw body, so this route must run before express.json().
  app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => {
    try {
      res.json(handleWebhook(req.body, req.headers["stripe-signature"]));
    } catch (err) {
      sendError(res, err, "Could not handle webhook");
    }
  });

  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, stripe: stripeMode() });
  });

  app.use("/api", storesRouter);

  app.post("/api/plans", async (req, res) => {
    try {
      const inputError = validatePlanRequest(req.body);
      if (inputError) return res.status(400).json({ error: inputError });
      const prompt = req.body.prompt.trim();
      const category = req.body.category?.trim() || "";
      const marketplaces = Array.isArray(req.body.marketplaces)
        ? req.body.marketplaces.filter((name) => typeof name === "string")
        : undefined;

      const draft = generatePlan({ prompt, category });
      const items = await attachOffers(draft.items, { marketplaces });
      const plan = savePlan({ ...draft, items, quote: quotePlan(items) });
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

  app.patch("/api/plans/:id/items/:itemId", async (req, res) => {
    try {
      const plan = getPlan(req.params.id);
      if (!plan) return res.status(404).json({ error: "plan not found" });

      const index = plan.items.findIndex((item) => item.id === req.params.itemId);
      if (index === -1) return res.status(404).json({ error: "item not found" });

      if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || typeof req.body.purchased !== "boolean") {
        return res.status(400).json({ error: "purchased must be a boolean" });
      }

      const nextItem = { ...plan.items[index], purchased: req.body.purchased };
      if (!nextItem.purchased && !nextItem.synthesis) {
        const [withOffer] = await attachOffers([nextItem]);
        plan.items[index] = withOffer;
      } else {
        plan.items[index] = nextItem;
      }

      plan.quote = quotePlan(plan.items);
      res.json(plan);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Could not update item" });
    }
  });

  // "Use this listing": the server reprices from its own copy, so checkout charges what was picked.
  app.put("/api/plans/:id/items/:itemId/listing", (req, res) => {
    const plan = getPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: "plan not found" });

    const index = plan.items.findIndex((item) => item.id === req.params.itemId);
    if (index === -1) return res.status(404).json({ error: "item not found" });
    if (plan.items[index].purchased) return res.status(409).json({ error: "item already purchased" });

    const picked = pickListing(plan.items[index], req.body?.listingId);
    if (!picked) return res.status(404).json({ error: "listing not found for this item" });

    plan.items[index] = picked;
    plan.quote = quotePlan(plan.items);
    res.json(plan);
  });

  app.post("/api/checkout", async (req, res) => {
    try {
      // { cart: [{ planId, itemIds }] } for a cart across plans, or { planId, itemIds } for one plan.
      const cart = Array.isArray(req.body?.cart) ? req.body.cart : [{ planId: req.body?.planId, itemIds: req.body?.itemIds }];
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

  app.post("/api/compare", async (req, res) => {
    try {
      const left = req.body?.left;
      const right = req.body?.right;
      if (!left || !right) return res.status(400).json({ error: "left and right items are required" });
      const trustFloor = typeof req.body?.trust_floor === "number" ? req.body.trust_floor : 0.5;
      res.json(await compareItems(left, right, trustFloor));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || "Could not compare items" });
    }
  });

  app.post("/api/top", async (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!items.length) return res.status(400).json({ error: "items[] is required" });
      const limit = typeof req.body?.limit === "number" ? req.body.limit : 10;
      const trustFloor = typeof req.body?.trust_floor === "number" ? req.body.trust_floor : 0.5;
      res.json(await topItems(items, { limit, trustFloor }));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || "Could not rank items" });
    }
  });

  // A production build (npm run build) is served from here, so one origin carries the app,
  // /api and the /ws-live voice tunnel. In development Vite serves the client instead.
  if (existsSync(join(clientDist, "index.html"))) {
    app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/|api$|ws-live).*/, (req, res) => res.sendFile(join(clientDist, "index.html")));
  }
  app.use("/api", (req, res) => res.status(404).json({ error: "Unknown API route" }));

  app.use((err, req, res, next) => {
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large" });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON request" });
    res.status(500).json({ error: "Unexpected server error" });
  });
  return app;
}

function sendError(res, err, fallback) {
  if (err instanceof CheckoutError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: fallback });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 3001;
  const server = createApp().listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  attachLiveTunnel(server);
}
