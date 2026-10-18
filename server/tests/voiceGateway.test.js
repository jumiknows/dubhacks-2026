import { createHash } from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
import { test } from "node:test";
import { attachVoiceGateway } from "../voiceGateway.js";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

function connect(origin, path = "/ws-live") {
  return new Promise((resolve, reject) => {
    const req = http.request(origin + path, { headers: {
      connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", cookie: "account=private; pb_sid=demo_session", authorization: "private",
    } });
    req.on("upgrade", (response, socket) => resolve({ response, socket }));
    req.on("response", response => { response.resume(); resolve({ response }); });
    req.on("error", reject);
    req.end();
  });
}

test("built-app voice gateway relays voice and only the planner session cookie", async t => {
  const upstream = http.createServer();
  const upstreamSockets = new Set();
  let receivedHeaders;
  upstream.on("upgrade", (req, socket) => {
    receivedHeaders = req.headers;
    upstreamSockets.add(socket);
    const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on("data", data => socket.write(data));
  });
  const origin = await listen(upstream);
  const server = http.createServer();
  const detach = attachVoiceGateway(server, { baseUrl: origin });
  const publicOrigin = await listen(server);
  t.after(async () => {
    detach();
    for (const socket of upstreamSockets) socket.destroy();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  });
  const { response, socket } = await connect(publicOrigin);
  assert.equal(response.statusCode, 101);
  assert.equal(receivedHeaders.cookie, "pb_sid=demo_session");
  assert.equal(receivedHeaders.authorization, undefined);
  const echoed = once(socket, "data");
  socket.write(Buffer.from([0x81, 0x00]));
  assert.deepEqual((await echoed)[0], Buffer.from([0x81, 0x00]));
  socket.destroy();
  assert.equal((await connect(publicOrigin, "/ws-live?target=elsewhere")).response.statusCode, 404);
});

test("voice gateway reports unavailable Python without exposing upstream errors", async t => {
  const temporary = http.createServer();
  const origin = await listen(temporary);
  await new Promise(resolve => temporary.close(resolve));
  const server = http.createServer();
  const detach = attachVoiceGateway(server, { baseUrl: origin });
  const publicOrigin = await listen(server);
  t.after(async () => { detach(); await new Promise(resolve => server.close(resolve)); });
  assert.equal((await connect(publicOrigin)).response.statusCode, 503);
});
