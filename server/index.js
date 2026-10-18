import express from "express";
import cors from "cors";
import { pathToFileURL } from "node:url";
import { getPlan, savePlan } from "./store.js";
import { generatePlan, validatePlanRequest } from "./services/planner.js";
import { attachOffers, quotePlan } from "./services/pipeline.js";
import { createPythonGateway } from "./pythonGateway.js";
import { compareItems } from "./services/compareBot.js";
import { topItems } from "./services/topItemsBot.js";

export function createApp(gatewayOptions) {
  const app = express();

  app.use(cors());
  app.use("/api/conjure", createPythonGateway(gatewayOptions));
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/plans", async (req, res) => {
    try {
      const inputError = validatePlanRequest(req.body);
      if (inputError) return res.status(400).json({ error: inputError });
      const prompt = req.body.prompt.trim();
      const category = req.body.category?.trim() || "";
      const marketplaces = req.body.marketplaces;

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

  app.use((err, req, res, next) => {
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large" });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON request" });
    res.status(500).json({ error: "Unexpected server error" });
  });
  return app;
}

function validListing(value) {
  return value && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string";
}

function validTrustFloor(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 3001;
  createApp().listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
