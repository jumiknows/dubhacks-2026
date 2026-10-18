import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createApp } from "../index.js";
import { attachFrontendGateway, createFrontendGateway } from "../frontendGateway.js";
import { attachVoiceGateway } from "../voiceGateway.js";

async function listen(t, server) {
  const sockets = new Set();
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { for (const socket of sockets) socket.destroy(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("source API bodies, cookies, statuses and public origin survive the same-origin proxy", async (t) => {
  let captured;
  const upstream = await listen(t, http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    captured = { method: req.method, path: req.url, body: Buffer.concat(chunks).toString(), headers: req.headers };
    res.writeHead(422, { "Content-Type": "application/json", "Set-Cookie": "source=ok; HttpOnly", "Cache-Control": "no-store" });
    res.end('{"error":{"message":"source validation"}}');
  }));
  const app = createApp(undefined, { frontendOptions: { baseUrl: upstream } });
  const origin = await listen(t, http.createServer(app));
  const body = '{\n"destination":"Rainier", "people":2\n}';
  const response = await fetch(origin + "/api/trip?mode=live", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: "pb_sid=example", authorization: "Bearer demo-code", "x-forwarded-host": "untrusted.example", "oai-authenticated-user-id": "forged" }, body,
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.message, "source validation");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("set-cookie"), /source=ok/);
  assert.equal(captured.body, body);
  assert.equal(captured.path, "/api/trip?mode=live");
  assert.equal(captured.headers.cookie, "pb_sid=example");
  assert.equal(captured.headers.authorization, "Bearer demo-code");
  assert.equal(captured.headers["x-forwarded-host"], new URL(origin).host);
  assert.equal(captured.headers["oai-authenticated-user-id"], undefined);
  assert.deepEqual(await (await fetch(origin + "/api/health")).json(), { ok: true, stripe: "mock" });
});

test("SSR and SSE chunks stream before the source finishes", async (t) => {
  let finish;
  const end = new Promise((resolve) => { finish = resolve; });
  const upstream = await listen(t, http.createServer(async (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: first\n\n");
    await end;
    res.end("data: last\n\n");
  }));
  const origin = await listen(t, http.createServer(createFrontendGateway({ baseUrl: upstream })));
  const response = await fetch(origin + "/api/source-stream");
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /first/);
  finish();
  let rest = "";
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value); }
  assert.match(rest, /last/);
});

test("disconnecting a frontend client closes its source stream", { timeout: 2000 }, async (t) => {
  let closed;
  const ended = new Promise((resolve) => { closed = resolve; });
  const upstream = await listen(t, http.createServer((_req, res) => {
    res.once("close", closed);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: first\n\n");
  }));
  const origin = await listen(t, http.createServer(createFrontendGateway({ baseUrl: upstream })));
  await new Promise((resolve, reject) => {
    http.get(origin + "/fires", (res) => { res.once("data", () => { res.destroy(); resolve(); }); }).on("error", reject);
  });
  await ended;
});

test("frontend origin is fixed and unavailable source errors are bounded", async (t) => {
  for (const baseUrl of ["file:///tmp", "http://user:secret@localhost", "http://localhost/path", "http://localhost/?target=x"]) {
    assert.throws(() => createFrontendGateway({ baseUrl }));
  }
  const slow = await listen(t, http.createServer(() => {}));
  const origin = await listen(t, http.createServer(createFrontendGateway({ baseUrl: slow, timeoutMs: 20 })));
  assert.equal((await fetch(origin + "/")).status, 504);
  const response = await new Promise((resolve, reject) => {
    http.get(origin, { path: "//other.example/api" }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
  });
  assert.equal(response, 400);
});

function connect(origin, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(origin + path, { headers: {
      connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
    } });
    req.on("upgrade", (response, socket) => resolve({ response, socket }));
    req.on("response", (response) => { response.resume(); resolve({ response }); });
    req.on("error", reject);
    req.end();
  });
}

test("Next HMR and voice upgrades coexist on the public server", async (t) => {
  const calls = [];
  const remoteSockets = new Set();
  const peer = (label) => {
    const server = http.createServer();
    server.on("upgrade", (req, socket) => {
      calls.push([label, req.url]); remoteSockets.add(socket);
      const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.on("data", (data) => socket.write(data));
    });
    return server;
  };
  const next = await listen(t, peer("next"));
  const voice = await listen(t, peer("voice"));
  const server = http.createServer();
  const detachVoice = attachVoiceGateway(server, { baseUrl: voice });
  const detachNext = attachFrontendGateway(server, { baseUrl: next });
  const origin = await listen(t, server);
  t.after(() => { detachVoice(); detachNext(); for (const socket of remoteSockets) socket.destroy(); });
  for (const path of ["/_next/webpack-hmr?client=1", "/ws-live"]) {
    const { response, socket } = await connect(origin, path);
    assert.equal(response.statusCode, 101);
    const data = once(socket, "data"); socket.write(Buffer.from([0x81, 0x00]));
    assert.deepEqual((await data)[0], Buffer.from([0x81, 0x00])); socket.destroy();
  }
  assert.deepEqual(calls, [["next", "/_next/webpack-hmr?client=1"], ["voice", "/ws-live"]]);
});
