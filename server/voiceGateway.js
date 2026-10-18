import http from "node:http";
import https from "node:https";

/** Keep voice on the same origin as the app and preserve its planner session. */
export function attachVoiceGateway(server, {
  baseUrl = process.env.CONJURE_API_URL || "http://127.0.0.1:8000",
  timeoutMs = 10000,
} = {}) {
  const origin = new URL(baseUrl);
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash) {
    throw new TypeError("CONJURE_API_URL must be a credential-free HTTP(S) origin");
  }
  const sockets = new Set();
  const transport = origin.protocol === "https:" ? https : http;
  function onUpgrade(req, client, head) {
    if (req.url.startsWith("/_next/")) return;
    if (req.url !== "/ws-live") {
      client.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const headers = { connection: "Upgrade", upgrade: "websocket" };
    for (const name of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol"]) {
      if (typeof req.headers[name] === "string") headers[name] = req.headers[name];
    }
    const session = String(req.headers.cookie || "").split(/;\s*/).find(part => /^pb_sid=[A-Za-z0-9_-]{1,128}$/.test(part));
    if (session) headers.cookie = session;
    let upstreamSocket;
    const upstream = transport.request(new URL("/ws-live", origin), { method: "GET", headers });
    sockets.add(client);
    const cleanup = () => {
      sockets.delete(client);
      upstream.destroy();
      upstreamSocket?.destroy();
    };
    client.on("error", cleanup);
    client.once("close", cleanup);
    const unavailable = () => {
      if (!client.destroyed) client.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    };
    upstream.on("error", unavailable);
    upstream.setTimeout(timeoutMs, () => { unavailable(); upstream.destroy(); });
    upstream.on("response", response => { response.resume(); unavailable(); });
    upstream.on("upgrade", (response, socket, upstreamHead) => {
      upstream.setTimeout(0);
      upstreamSocket = socket;
      if (client.destroyed) return socket.destroy();
      const lines = [];
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
      }
      client.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join("\r\n")}\r\n\r\n`);
      if (upstreamHead.length) client.write(upstreamHead);
      if (head.length) socket.write(head);
      socket.on("error", () => client.destroy());
      socket.once("close", () => client.destroy());
      client.pipe(socket).pipe(client);
    });
    upstream.end();
  }
  server.on("upgrade", onUpgrade);
  return () => {
    server.removeListener("upgrade", onUpgrade);
    for (const socket of sockets) socket.destroy();
    sockets.clear();
  };
}
