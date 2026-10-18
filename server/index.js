import "./env.js";
import express from "express";
import cors from "cors";
import { getPlan, savePlan } from "./store.js";
import { generatePlan } from "./services/planner.js";
import { attachOffers, quotePlan } from "./services/pipeline.js";
import { accountRouter } from "./routes/account.js";
import { budgetMax, currentSession, profileFor } from "./services/accounts.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/api", accountRouter());

/** Onboarding answers that shape offers: which listing wins, and the plan budget. */
function prefsFor(req) {
  const profile = profileFor(currentSession(req));
  return { priority: profile.priority, budgetMax: budgetMax(profile) };
}

app.post("/api/plans", async (req, res) => {
  try {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const category = typeof req.body?.category === "string" ? req.body.category.trim() : "";
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    const prefs = prefsFor(req);
    const draft = generatePlan({ prompt, category });
    const items = await attachOffers(draft.items, prefs);
    const plan = savePlan({ ...draft, items, quote: quotePlan(items, prefs) });
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

    const prefs = prefsFor(req);
    const nextItem = { ...plan.items[index], purchased: req.body.purchased };
    if (!nextItem.purchased && !nextItem.synthesis) {
      const [withOffer] = await attachOffers([nextItem], prefs);
      plan.items[index] = withOffer;
    } else {
      plan.items[index] = nextItem;
    }

    plan.quote = quotePlan(plan.items, prefs);
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update item" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
