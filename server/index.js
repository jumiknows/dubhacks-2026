import express from "express";
import cors from "cors";
import { getPlan, savePlan } from "./store.js";
import { generatePlan } from "./services/planner.js";
import { attachOffers, quotePlan } from "./services/pipeline.js";
import { compareItems } from "./services/compareBot.js";
import { topItems } from "./services/topItemsBot.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/plans", async (req, res) => {
  try {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const category = typeof req.body?.category === "string" ? req.body.category.trim() : "";
    const marketplaces = Array.isArray(req.body?.marketplaces)
      ? req.body.marketplaces.filter((name) => typeof name === "string")
      : undefined;
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

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

    if (typeof req.body?.purchased !== "boolean") {
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
