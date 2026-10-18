import { Router } from "express";
import { searchStores, storeStatus } from "../services/stores/index.js";

export const storesRouter = Router();

/** Which store APIs are configured and how their last call went. */
storesRouter.get("/stores", (req, res) => {
  res.json({ providers: storeStatus() });
});

/** Search all enabled stores for one query, e.g. /api/products/search?q=headlamp */
storesRouter.get("/products/search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
  if (!q) return res.status(400).json({ error: "q is required" });
  res.json(await searchStores(q));
});
