import http from "node:http";
import https from "node:https";

// Request headers a WebSocket handshake needs. Nothing else (cookies, auth) is forwarded.
const HANDSHAKE = [
  "upgrade",
  "connection",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
];

/**
 * Tunnels the browser's /ws-live voice socket to the Python API, so a production build served by
 * Express gets voice on the same origin (Vite does this in development). The upstream comes only
 * from server configuration, never from the client.
 */
export function attachLiveTunnel(server, { baseUrl = process.env.CONJURE_API_URL || "http://127.0.0.1:8000" } = {}) {
  const upstream = new URL(baseUrl);
  if (!["http:", "https:"].includes(upstream.protocol) || upstream.username || upstream.password) {
    throw new TypeError("CONJURE_API_URL must be a credential-free HTTP(S) origin");
  }
  const transport = upstream.protocol === "https:" ? https : http;

  server.on("upgrade", (req, socket, head) => {
    if (req.url.split("?")[0] !== "/ws-live") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    const headers = { host: upstream.host };
    for (const name of HANDSHAKE) if (req.headers[name]) headers[name] = req.headers[name];

    const proxy = transport.request({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      path: "/ws-live",
      method: "GET",
      headers,
      timeout: 10000,
    });
    const fail = () => socket.destroy();
    socket.on("error", () => proxy.destroy());
    proxy.on("error", fail);
    proxy.on("timeout", () => proxy.destroy());
    proxy.on("response", (res) => {
      socket.end(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\nConnection: close\r\n\r\n`);
      res.resume();
    });
    proxy.on("upgrade", (res, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${res.statusCode} ${res.statusMessage}`];
      for (let i = 0; i < res.rawHeaders.length; i += 2) lines.push(`${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}`);
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (upstreamHead?.length) socket.write(upstreamHead);
      if (head?.length) upstreamSocket.write(head);
      upstreamSocket.on("error", fail);
      socket.on("close", () => upstreamSocket.destroy());
      upstreamSocket.on("close", () => socket.destroy());
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
    });
    proxy.end();
  });
  return server;
}
