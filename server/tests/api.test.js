process.env.PYTHON_API_URL = "http://127.0.0.1:1";
process.env.STORES_LIVE = "false";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../index.js";
import { useAccountStore } from "../services/accounts.js";
import { pickListing } from "../services/pipeline.js";
useAccountStore({ sessions: new Map(), accounts: new Map(), save() {} });

async function start(t, options, services) {
  const server = createApp(options, services).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  return async (path, body, method = "POST") => {
    const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return response;
  };
}

test("existing plan POST/GET/PATCH contract remains intact with honest demo quote metadata", async (t) => {
  const request = await start(t);
  const created = await request("/api/plans", { prompt: "camping", category: "camping" });
  assert.equal(created.status, 201);
  const plan = await created.json();
  assert.ok(plan.id);
  assert.equal(plan.items.length, 8);
  assert.equal(plan.isMock, true);
  assert.equal(plan.quote.readyBy, null);
  assert.equal(plan.quote.priceScope, "items_only");
  assert.equal(plan.quote.costComplete, false);
  const fetched = await request(`/api/plans/${plan.id}`, undefined, "GET");
  assert.equal((await fetched.json()).id, plan.id);
  const update = await request(`/api/plans/${plan.id}/items/${plan.items[0].id}`, { purchased: true }, "PATCH");
  assert.equal(update.status, 200);
  const updated = await update.json();
  assert.equal(updated.items[0].purchased, true);
  assert.equal(updated.quote.toBuyCount, 7);
  assert.ok(updated.quote.totalPrice < plan.quote.totalPrice);
});

test("invalid JSON shapes and purchased values return explicit 4xx responses", async (t) => {
  const request = await start(t);
  for (const body of [[], {}, { prompt: 3 }, { prompt: "hello", category: "invalid" }, { prompt: "x".repeat(2001) }]) {
    assert.equal((await request("/api/plans", body)).status, 400);
  }
  const plan = await (await request("/api/plans", { prompt: "buy unlisted item" })).json();
  const path = `/api/plans/${plan.id}/items/${plan.items[0].id}`;
  for (const body of [{ purchased: "false" }, { purchased: 0 }, { purchased: true, price: 0 }, []]) {
    assert.equal((await request(path, body, "PATCH")).status, 400);
  }
  assert.equal((await request(`/api/plans/unknown`, undefined, "GET")).status, 404);
  assert.equal(plan.quote.totalPrice, null);
});

test("Express exposes Python under its own namespace while retaining planner health", async (t) => {
  const peer = http.createServer((req, res) => {
    assert.equal(req.url, "/health");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"service":"test-python"}');
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => peer.once("listening", resolve));
  t.after(async () => { peer.closeAllConnections(); await new Promise((resolve) => peer.close(resolve)); });
  const request = await start(t, { baseUrl: `http://127.0.0.1:${peer.address().port}` });
  assert.deepEqual(await (await request("/api/conjure/health", undefined, "GET")).json(), { service: "test-python" });
  assert.deepEqual(await (await request("/api/health", undefined, "GET")).json(), { ok: true, stripe: "mock" });
});

test("async plans retain owned edits during pricing and history stays in its browser session", async (t) => {
  let released = false;
  const waiting = new Set();
  const reply = (response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ source: "fixture", products: [] }));
  };
  const market = http.createServer((req, res) => {
    req.resume();
    if (released) reply(res);
    else waiting.add(res);
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => market.once("listening", resolve));
  process.env.PYTHON_API_URL = `http://127.0.0.1:${market.address().port}`;
  t.after(async () => {
    process.env.PYTHON_API_URL = "http://127.0.0.1:1";
    market.closeAllConnections();
    await new Promise((resolve) => market.close(resolve));
  });
  const request = await start(t);
  const created = await request("/api/plans", { prompt: "camping", async: true });
  assert.equal(created.status, 201);
  const draft = await created.json();
  assert.equal(draft.status, "pricing");
  assert.equal(draft.quote.totalPrice, null);
  const path = `/api/plans/${draft.id}/items/${draft.items[0].id}`;
  assert.equal((await request(path, { owned: true }, "PATCH")).status, 200);
  released = true;
  for (const response of waiting) reply(response);
  let plan;
  for (let i = 0; i < 100; i++) {
    plan = await (await request(`/api/plans/${draft.id}`, undefined, "GET")).json();
    if (plan.status === "ready") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(plan.status, "ready");
  assert.equal(plan.items[0].owned, true);
  assert.equal(plan.quote.ownedCount, 1);
  assert.equal(plan.quote.toBuyCount, 7);
  assert.ok(plan.items[1].synthesis.best);
  assert.deepEqual((await (await request("/api/plans", undefined, "GET")).json()).plans.map((entry) => entry.id), [draft.id]);
  const otherBrowser = await start(t);
  assert.deepEqual(await (await otherBrowser("/api/plans", undefined, "GET")).json(), { plans: [] });
});

test("selected offers are repriced safely and owned items cannot enter checkout", async (t) => {
  const request = await start(t);
  const plan = await (await request("/api/plans", { prompt: "camping" })).json();
  const tent = plan.items[0];
  const chosen = tent.products.find((product) => product.id !== tent.synthesis.best.id);
  const selected = await request(`/api/plans/${plan.id}/items/${tent.id}/listing`, { listingId: chosen.id }, "PUT");
  assert.equal(selected.status, 200);
  const updated = await selected.json();
  assert.equal(updated.items[0].synthesis.best.id, chosen.id);
  assert.equal(updated.items[0].synthesis.totalPrice, chosen.price);
  assert.equal(updated.items[0].synthesis.isMock, true);
  assert.equal(updated.items[0].synthesis.shippingDate, null);
  await request(`/api/plans/${plan.id}/items/${tent.id}`, { owned: true }, "PATCH");
  assert.equal((await request("/api/checkout", { planId: plan.id, itemIds: [tent.id] })).status, 409);
  assert.equal((await request("/api/plans", { prompt: "camping", async: "true" })).status, 400);
});

test("an awaited listing choice cannot undo a newer owned or paid state", async (t) => {
  for (const nextState of ["owned", "paid"]) {
    let enter;
    let release;
    const entered = new Promise((resolve) => { enter = resolve; });
    const blocked = new Promise((resolve) => { release = resolve; });
    const request = await start(t, undefined, {
      selectListing: async (item, id) => {
        enter();
        await blocked;
        return pickListing(item, id);
      },
    });
    const plan = await (await request("/api/plans", { prompt: "camping" })).json();
    const tent = plan.items[0];
    const alt = tent.products.find((product) => product.id !== tent.synthesis.best.id);
    const path = `/api/plans/${plan.id}/items/${tent.id}`;
    const selection = request(`${path}/listing`, { listingId: alt.id }, "PUT");
    await entered;
    if (nextState === "owned") {
      assert.equal((await request(path, { owned: true }, "PATCH")).status, 200);
    } else {
      const checkout = await (await request("/api/checkout", { planId: plan.id, itemIds: [tent.id] })).json();
      assert.equal((await request(`${path}/listing`, { listingId: alt.id }, "PUT")).status, 409);
      assert.equal((await request(path, { owned: true }, "PATCH")).status, 409);
      assert.equal((await request(`/api/checkout/${checkout.id}`, undefined, "GET")).status, 200);
    }
    release();
    assert.equal((await selection).status, 409);
    const latest = await (await request(`/api/plans/${plan.id}`, undefined, "GET")).json();
    assert.equal(latest.items[0].synthesis.best.id, tent.synthesis.best.id);
    if (nextState === "owned") assert.equal(latest.items[0].owned, true);
    else {
      assert.equal(latest.items[0].purchased, true);
      assert.equal(latest.items[0].order.listing.id, tent.synthesis.best.id);
      assert.equal((await request(path, { purchased: false }, "PATCH")).status, 409);
    }
  }
});
