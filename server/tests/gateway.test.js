import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createPythonGateway } from "../pythonGateway.js";

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function gateway(t, baseUrl, options = {}) {
  return listen(t, createPythonGateway({ baseUrl, ...options }));
}

test("gateway preserves JSON bodies and Python 4xx status without forwarding credentials", async (t) => {
  const upstream = await listen(t, async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(req.url, "/products/recommend");
    assert.equal(req.method, "POST");
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers["x-api-key"], undefined);
    assert.equal(req.headers["content-type"], "application/json");
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: JSON.parse(body).products }));
  });
  const url = await gateway(t, upstream);
  const response = await fetch(`${url}/products/recommend`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test", Cookie: "test=1", "X-Api-Key": "test" }, body: '{"products":[]}' });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { detail: [] });
});

test("gateway streams each SSE chunk before the upstream finishes", async (t) => {
  let release;
  const complete = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  const upstream = await listen(t, async (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write('event: action\ndata: {"action":"say","text":"first"}\n\n');
    await complete;
    res.end('event: done\ndata: {"source":"fallback"}\n\n');
  });
  const url = await gateway(t, upstream);
  const response = await fetch(`${url}/chat`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /first/);
  assert.doesNotMatch(first, /event: done/);
  release();
  let rest = "";
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    rest += new TextDecoder().decode(next.value);
  }
  assert.match(rest, /event: done/);
});

test("review routes forward only their fixed methods and query fields", async (t) => {
  const upstream = await listen(t, (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ path: req.url, method: req.method }));
  });
  const url = await gateway(t, upstream);
  assert.equal((await fetch(`${url}/reviews/sources`)).status, 200);
  const search = await fetch(`${url}/reviews/products?merchant=shop&q=headphones&limit=5`);
  assert.equal(search.status, 200);
  assert.equal((await search.json()).path, "/reviews/products?merchant=shop&q=headphones&limit=5");
  for (const name of ["analyze", "fetch", "demo"]) {
    assert.equal((await fetch(`${url}/reviews/${name}`, { method: "POST", body: "{}" })).status, 200);
    assert.equal((await fetch(`${url}/reviews/${name}`)).status, 405);
  }
  assert.equal((await fetch(`${url}/reviews/workbench`)).status, 200);
  assert.equal((await fetch(`${url}/reviews/products?url=http://127.0.0.1`)).status, 400);
});

test("website safety routes use fixed methods without accepting proxy query targets", async (t) => {
  const upstream = await listen(t, (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ path: req.url, method: req.method }));
  });
  const url = await gateway(t, upstream);
  for (const name of ["assess", "checkout-check", "demo"]) {
    const response = await fetch(`${url}/websites/${name}`, { method: "POST", body: "{}" });
    assert.deepEqual(await response.json(), { path: `/websites/${name}`, method: "POST" });
    assert.equal((await fetch(`${url}/websites/${name}`)).status, 405);
  }
  for (const name of ["config", "workbench"]) {
    assert.equal((await fetch(`${url}/websites/${name}`)).status, 200);
    assert.equal((await fetch(`${url}/websites/${name}`, { method: "POST" })).status, 405);
  }
  assert.equal((await fetch(`${url}/websites/assess?url=https://example.com`, { method: "POST" })).status, 400);
});

test("fixed target and route/method/query restrictions block proxy abuse", async (t) => {
  let calls = 0;
  const upstream = await listen(t, (_req, res) => { calls++; res.end("ok"); });
  const url = await gateway(t, upstream);
  for (const path of ["/unknown", "/http://example.com", "/%2e%2e/health", "/products/p%2Fother"]) {
    // fetch normalizes dot segments before sending; use a literal HTTP request
    // to exercise rejection of the actual malicious request target.
    const status = await new Promise((resolve, reject) => {
      http.get(url, { path }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
    });
    assert.equal(status, 404);
  }
  assert.equal((await fetch(`${url}/health`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${url}/health?url=http://example.com`)).status, 400);
  assert.equal(calls, 0);
  const response = await fetch(`${url}/products/search?q=tent&limit=3`);
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test("gateway bounds request size and upstream wait", async (t) => {
  const upstream = await listen(t, () => {});
  const url = await gateway(t, upstream, { timeoutMs: 50, maxBodyBytes: 10 });
  assert.equal((await fetch(`${url}/chat`, { method: "POST", body: "too long body" })).status, 413);
  const timeout = await fetch(`${url}/health`);
  assert.equal(timeout.status, 504);
  assert.match((await timeout.json()).error, /timed out/);
});

test("gateway also enforces its body limit on chunked input", async (t) => {
  const upstream = await listen(t, (req) => req.resume());
  const url = await gateway(t, upstream, { maxBodyBytes: 10 });
  const status = await new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST", path: "/chat" }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.write("123456");
    req.end("123456");
  });
  assert.equal(status, 413);
});

test("disconnecting an SSE client closes the upstream response", { timeout: 2000 }, async (t) => {
  let closed;
  const upstreamClosed = new Promise((resolve) => { closed = resolve; });
  const upstream = await listen(t, (_req, res) => {
    res.on("close", closed);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: first\n\n");
  });
  const url = await gateway(t, upstream);
  await new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST", path: "/chat" }, (res) => {
      res.once("data", () => { res.destroy(); resolve(); });
    });
    req.on("error", reject);
    req.end("{}");
  });
  await upstreamClosed;
});

test("missing Python service returns a useful 503", async (t) => {
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${closed.address().port}`;
  await new Promise((resolve) => closed.close(resolve));
  const url = await gateway(t, baseUrl);
  const response = await fetch(`${url}/health`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Conjure API is unavailable" });
});

test("gateway configuration rejects credentials, redirect paths and unbounded timeouts", () => {
  for (const baseUrl of ["file:///tmp", "http://user:pass@localhost", "http://localhost/api", "http://localhost/?token=x", "http://localhost/#x"]) {
    assert.throws(() => createPythonGateway({ baseUrl }));
  }
  assert.throws(() => createPythonGateway({ timeoutMs: Infinity }));
  assert.throws(() => createPythonGateway({ timeoutMs: 180001 }));
});
