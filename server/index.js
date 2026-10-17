import express from "express";
import cors from "cors";
import { getPlan, savePlan } from "./store.js";
import { generatePlan } from "./services/planner.js";
import { attachOffers, quotePlan } from "./services/pipeline.js";

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
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    const draft = generatePlan({ prompt, category });
    const items = await attachOffers(draft.items);
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
