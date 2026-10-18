import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../index.js";

async function start(t, options) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, body, method = "POST") => fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
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
  const health = await (await request("/api/health", undefined, "GET")).json();
  assert.equal(health.ok, true);
  assert.ok(["mock", "test"].includes(health.stripe));
});
