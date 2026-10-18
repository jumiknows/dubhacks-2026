import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachLiveTunnel } from "../liveTunnel.js";
import { createApp } from "../index.js";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(t, ...servers) {
  t.after(() => Promise.all(servers.map((server) => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  }))));
}

/** Raw upgrade request; resolves with everything the socket receives within a moment. */
function upgrade(port, path, extra = "") {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nCookie: secret=1\r\n\r\n${extra}`);
    });
    let data = "";
    socket.on("data", (chunk) => { data += chunk; });
    socket.on("error", reject);
    setTimeout(() => { socket.destroy(); resolve(data); }, 300);
  });
}

test("the voice socket is tunnelled to the Python API with handshake headers only", async (t) => {
  let seen = null;
  const upstream = http.createServer();
  upstream.on("upgrade", (req, socket) => {
    seen = req.headers;
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (chunk) => socket.write(`echo:${chunk}`));
    socket.on("end", () => socket.end());
    socket.on("error", () => socket.destroy());
  });
  const upstreamPort = await listen(upstream);
  const front = attachLiveTunnel(http.createServer(), { baseUrl: `http://127.0.0.1:${upstreamPort}` });
  const port = await listen(front);
  close(t, upstream, front);

  const reply = await upgrade(port, "/ws-live", "ping");
  assert.match(reply, /^HTTP\/1\.1 101 Switching Protocols/);
  assert.match(reply, /echo:ping/);
  assert.equal(seen["sec-websocket-key"], "dGhlIHNhbXBsZSBub25jZQ==");
  assert.equal(seen.cookie, undefined);
});

test("other upgrade paths are refused and a dead upstream closes the socket", async (t) => {
  const front = attachLiveTunnel(http.createServer(), { baseUrl: "http://127.0.0.1:9" });
  const port = await listen(front);
  close(t, front);
  assert.match(await upgrade(port, "/elsewhere"), /^HTTP\/1\.1 404/);
  assert.equal(await upgrade(port, "/ws-live"), "");
  assert.throws(() => attachLiveTunnel(http.createServer(), { baseUrl: "http://user:pw@127.0.0.1:1" }), TypeError);
});

test("a built client is served for app routes while /api stays JSON", async (t) => {
  const dist = mkdtempSync(join(tmpdir(), "esper-dist-"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>ESPER</title>");
  const server = http.createServer(createApp(undefined, { clientDist: dist }));
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  close(t, server);
  const page = await fetch(`${base}/gesture-lab`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /ESPER/);
  const missing = await fetch(`${base}/api/nope`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Unknown API route" });
});
