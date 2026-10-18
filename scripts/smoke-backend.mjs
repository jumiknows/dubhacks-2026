// Real local HTTP integration check. Default: offline fallback. --live-ai explicitly
// exercises the configured provider using only a synthetic shopping query.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import http from "node:http";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const live = process.argv.includes("--live-ai");
const browser = process.argv.includes("--browser");
if (process.argv.slice(2).some(arg => !["--live-ai", "--browser"].includes(arg))) throw new Error("Unknown smoke-check option");
if (browser && !existsSync(join(root, "apps", "web", ".next", "BUILD_ID"))) throw new Error("Run npm run build before the browser smoke check");
// Set deterministic modes before importing services that load server/.env.
process.env.STRIPE_SECRET_KEY = "";
process.env.STORES_LIVE = "false";
process.env.MOCK_ORDER_SANDBOX = "off";
const { createApp } = await import("../server/index.js");
const { configureStripe } = await import("../server/services/checkout.js");
const { useAccountStore } = await import("../server/services/accounts.js");
configureStripe({ mockOrder: { env: { MOCK_ORDER_SANDBOX: "off" } } });
useAccountStore({ sessions: new Map(), accounts: new Map(), save() {} });
const pythonPath = join(root, "api", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(pythonPath)) throw new Error("Run npm run api:setup first");

function hashes(directory = join(root, "api", "data")) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? hashes(path) : [[relative(root, path), createHash("sha256").update(readFileSync(path)).digest("hex")]];
  }).sort((a, b) => a[0].localeCompare(b[0]));
}

for (const name of ["catalog.json", "merchants.json", "trust_reports.json"]) {
  if (!existsSync(join(root, "api", "data", name))) throw new Error("Shared fixtures missing; refusing to regenerate them");
}
const before = hashes();
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", DEMO_SERVER_SIGNING: "false",
  ELEVENLABS_API_KEY: "", STRIPE_SECRET_KEY: "", GEMINI_API_KEY: "", SELENIUM_ENABLED: "false",
  WEBSITE_WEBRISK_API_KEY: "", WEBSITE_PHISHTANK_API_KEY: "", WEBSITE_PHISHTANK_ENABLED: "false",
  WEBSITE_MERCHANTS: "{}", WEBSITE_BLOCKED_HOSTS: "[]" };
if (!live) env.LLM_API_KEY = "";
let python;
let server;
let next;
let cookie = "";

async function json(base, path, method = "GET", body) {
  const response = await fetch(base + path, { method,
    headers: { cookie, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  assert(response.ok, `${path} returned HTTP ${response.status}`);
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return response.json();
}

try {
  let frontendOptions;
  if (browser) {
    const temporary = http.createServer().listen(0, "127.0.0.1");
    await once(temporary, "listening");
    const port = temporary.address().port;
    await new Promise(resolve => temporary.close(resolve));
    const webOrigin = `http://127.0.0.1:${port}`;
    const require = createRequire(join(root, "apps", "web", "package.json"));
    next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: join(root, "apps", "web"),
      env: { ...env, XAI_API_KEY: "", NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "ignore", "ignore"],
    });
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      if (next.exitCode !== null) throw new Error("Next exited during the browser smoke check; details withheld");
      try { ready = (await fetch(webOrigin + "/api/places", { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Wait for startup. */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("Next startup timed out");
    frontendOptions = { baseUrl: webOrigin };
  }
  python = spawn(pythonPath, ["-B", "-m", "uvicorn", "api.main:app", "--host", "127.0.0.1", "--port", "0", "--no-access-log", "--no-use-colors"],
    { cwd: root, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const pythonOrigin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Python startup timed out; provider details withheld")), 30000);
    let buffer = "";
    python.stderr.on("data", chunk => {
      // Do not print subprocess logs: provider errors/settings must stay private.
      buffer = (buffer + chunk.toString()).slice(-4096);
      const match = buffer.match(/Uvicorn running on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    python.once("error", () => { clearTimeout(timer); reject(new Error("Could not start the local Python backend")); });
    python.once("exit", () => { clearTimeout(timer); reject(new Error("Python exited during the smoke check; details withheld")); });
  });
  process.env.PYTHON_API_URL = pythonOrigin;
  server = createApp({ baseUrl: pythonOrigin }, { frontendOptions }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  assert((await json(base, "/api/health")).ok);
  const health = await json(base, "/api/conjure/health");
  assert(health.ok && health.products === 20);
  console.log("PASS: Express and real Python health through the gateway");

  const plan = await json(base, "/api/plans", "POST", { prompt: "Weekly groceries", category: "groceries" });
  assert(plan.isMock && plan.items.length > 0 && plan.quote.fullTotal === null);
  const updated = await json(base, `/api/plans/${plan.id}/items/${plan.items[0].id}`, "PATCH", { purchased: true });
  assert(updated.items[0].purchased);
  console.log("PASS: frontend plan creation and purchased-item update");

  await json(base, "/api/me/profile", "PUT", { focus: "outdoors", priority: "price", budget: "100-300" });
  let pending = await json(base, "/api/plans", "POST", { prompt: "camping", async: true });
  assert(pending.status === "pricing" && pending.items.length === 8);
  for (let attempt = 0; attempt < 100 && pending.status === "pricing"; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    pending = await json(base, `/api/plans/${pending.id}`);
  }
  assert.equal(pending.status, "ready");
  const item = pending.items.find(row => row.products.length >= 2);
  assert(item, "Expected fixture offers after background pricing");
  const compared = await json(base, "/api/compare", "POST", {
    left: item.products[0], right: item.products[1], trust_floor: 0.65,
  });
  assert(compared.left && compared.right && compared.trust_floor === 0.65);
  const selected = await json(base, `/api/plans/${pending.id}/items/${item.id}/listing`, "PUT", { listingId: item.products[1].id });
  assert.equal(selected.items.find(row => row.id === item.id).synthesis.best.id, item.products[1].id);
  const startedCheckout = await json(base, "/api/checkout", "POST", { planId: pending.id, itemIds: [item.id] });
  assert(startedCheckout.mock && startedCheckout.amount > 0);
  const paid = await json(base, `/api/checkout/${startedCheckout.id}`);
  assert(paid.mock && paid.status === "paid" && paid.plan.items.find(row => row.id === item.id).purchased);
  const history = await json(base, "/api/plans");
  assert(history.plans.some(row => row.id === pending.id));
  console.log("PASS: profile preferences, async pricing, comparison, persisted offer selection, offline checkout and list history");

  const products = await json(base, "/api/conjure/products/search?q=moisturizer&max_price=40");
  assert(products.length > 0 && products.every(product => product.price <= 40));
  const recommendations = await json(base, "/api/conjure/products/recommend", "POST", {
    products: [{ id: "smoke-example", title: "Synthetic offer", merchant_id: "m_dermadirect", price: "19.99", currency: "USD" }],
    max_price: "20.00",
  });
  assert(recommendations.results[0].product.price === "19.99" && recommendations.results[0].total_price === null);
  console.log("PASS: catalog search and raw-product normalization/recommendation");

  const reviewSources = await json(base, "/api/conjure/reviews/sources");
  assert(Array.isArray(reviewSources.sources));
  const reviewDemo = await json(base, "/api/conjure/reviews/demo", "POST", { use_llm: false });
  assert(reviewDemo.source.is_mock && reviewDemo.analysis.provenance === "demo");
  assert(reviewDemo.analysis.duplicates.length && reviewDemo.analysis.security_flags.length);
  assert(reviewDemo.analysis.sentiment.classified_count > 0 && reviewDemo.analysis.classification_method === "deterministic");
  const reviewProduct = { source: "smoke_upload", external_id: "headphones" };
  const reviewUpload = await json(base, "/api/conjure/reviews/analyze", "POST", {
    product: reviewProduct,
    reviews: [{ review_id: "sample-1", product: reviewProduct, text: "Great sound but terrible battery life.", rating: 3 }],
  });
  assert(reviewUpload.analysis.provenance === "uploaded" && reviewUpload.analysis.sentiment.counts.mixed === 1);
  const noAmazonReviews = await json(base, "/api/conjure/reviews/fetch", "POST", { product: { source: "amazon", external_id: "example" } });
  assert(noAmazonReviews.source.status === "unsupported_source" && noAmazonReviews.analysis === null);
  const workbench = await fetch(base + "/api/conjure/reviews/workbench");
  assert(workbench.ok && workbench.headers.get("content-type").includes("text/html"));
  console.log("PASS: review gateway, synthetic demo, supplied-review analysis, honest unavailable source and workbench");

  const websiteConfig = await json(base, "/api/conjure/websites/config");
  assert(websiteConfig.unknown_policy === "hold" && websiteConfig.safety_guaranteed === false);
  assert(websiteConfig.reputation_providers.every(provider => !provider.configured));
  const unknownWebsite = await json(base, "/api/conjure/websites/assess", "POST", { url: "https://example.com/" });
  assert(unknownWebsite.decision === "hold" && !unknownWebsite.allowed && !unknownWebsite.safety_guaranteed);
  const deceptiveWebsite = await json(base, "/api/conjure/websites/assess", "POST", { url: "https://merchant.example.com@attacker.example.org/" });
  assert(deceptiveWebsite.decision === "blocked" && deceptiveWebsite.origin === null);
  const websiteDemo = await json(base, "/api/conjure/websites/demo", "POST", {});
  assert(websiteDemo.is_mock && websiteDemo.provenance === "synthetic_demo");
  assert.deepEqual([...new Set(websiteDemo.cases.map(item => item.assessment.decision))].sort(), ["allowed", "blocked", "hold"]);
  const noCheckout = await json(base, "/api/conjure/websites/checkout-check", "POST", { merchant_id: "shop" });
  assert(noCheckout.decision === "hold", "Synthetic checks must not authorize real checkout");
  const websiteWorkbench = await fetch(base + "/api/conjure/websites/workbench");
  assert(websiteWorkbench.ok && websiteWorkbench.headers.get("content-type").includes("text/html"));
  console.log("PASS: website gate, unknown holds, credential rejection, isolated synthetic demo and workbench");

  const { session_id } = await json(base, "/api/conjure/session", "POST", {});
  console.log(live ? "Checking one live Gemini tool-planning turn; key and provider messages withheld..." : "Checking offline fallback SSE...");
  const started = Date.now();
  const chat = await fetch(base + "/api/conjure/chat", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id, text: "Find a fragrance-free moisturizer for dry skin under $40.", ui_context: { visible_ids: [], focused_id: null } }),
    signal: AbortSignal.timeout(130000) });
  assert(chat.ok && chat.headers.get("content-type").includes("text/event-stream"));
  const events = [];
  for (const block of (await chat.text()).split(/\r?\n\r?\n/)) {
    const name = block.match(/^event: (.+)$/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    if (name && data) events.push([name, JSON.parse(data)]);
  }
  const done = events.findLast(([name]) => name === "done")?.[1];
  const results = events.find(([name, data]) => name === "action" && data.action === "show_results")?.[1];
  assert(done?.grounded && results?.product_ids.length > 0);
  for (const id of results.product_ids) {
    const product = await json(base, `/api/conjure/products/${id}`);
    assert(product.price <= 40 && product.attributes.fragrance_free === true && product.subcategory === "moisturizer");
  }
  const audit = await json(base, `/api/conjure/audit/${session_id}`);
  assert(audit.valid);
  const source = audit.entries.findLast(entry => entry.kind === "turn")?.data?.source;
  assert(done.source === (live ? "llm" : "fallback"), "Unexpected agent source; provider details withheld");
  assert(source === (live ? "llm" : "fallback"), "Agent only completed a partial turn; provider details withheld");
  console.log(`PASS: ${done.source} SSE actions, factual response, constraints and valid audit (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (browser) {
    const { smokeBrowser } = await import("./smoke-next-browser.mjs");
    await smokeBrowser(base, cookie);
  }
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (python && python.exitCode === null && python.signalCode === null) {
    const exited = once(python, "exit").catch(() => {});
    python.kill("SIGTERM");
    await Promise.race([exited, new Promise(resolve => { const timer = setTimeout(resolve, 5000); timer.unref(); })]);
    if (python.exitCode === null && python.signalCode === null) python.kill("SIGKILL");
  }
  if (next && next.exitCode === null && next.signalCode === null) {
    const exited = once(next, "exit").catch(() => {});
    next.kill("SIGTERM");
    await Promise.race([exited, new Promise(resolve => { const timer = setTimeout(resolve, 5000); timer.unref(); })]);
    if (next.exitCode === null && next.signalCode === null) next.kill("SIGKILL");
  }
  assert.deepEqual(hashes(), before, "Shared demo fixtures changed");
  console.log("Shared demo fixtures unchanged; temporary local servers stopped.");
}
