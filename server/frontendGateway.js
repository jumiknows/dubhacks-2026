import http from "node:http";
import https from "node:https";

const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

function originFor(baseUrl) {
  const origin = new URL(baseUrl);
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash) {
    throw new TypeError("ORBICART_WEB_URL must be a credential-free HTTP(S) origin");
  }
  return origin;
}

function representationHeaders(headers) {
  const blocked = new Set([...HOP, ...String(headers.connection || "").toLowerCase().split(",").map((name) => name.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name.toLowerCase())));
}

function forwardingHeaders(req, origin, trustPrivateSiteHeaders = false) {
  const headers = representationHeaders(req.headers);
  headers.host = origin.host;
  headers["x-forwarded-host"] = req.headers.host || "localhost:3001";
  headers["x-forwarded-proto"] = req.socket.encrypted ? "https" : "http";
  delete headers["x-forwarded-for"];
  if (!trustPrivateSiteHeaders) {
    for (const name of Object.keys(headers)) if (name.startsWith("oai-authenticated-")) delete headers[name];
  }
  return headers;
}

function unavailable(res, status = 503) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error: { message: status === 400 ? "Invalid web request path." : status === 504 ? "The web application timed out." : "The web application is starting or unavailable." } }));
}

/** These namespaces stay on Express. Other paths, including source APIs, belong to Next. */
export function isBackendPath(path) {
  return /^\/static\/products(?:\/|$)/.test(path) || /^\/api\/(?:health|voice-health|plans|checkout|stripe|me|auth|calendar|stores|orbicart|compare|top|conjure)(?:\/|$)/.test(path) ||
    /^\/api\/products\/search(?:\/|$)/.test(path);
}

/** Mount before express.json so source API bodies and Next response streams remain intact. */
export function createFrontendGateway({
  baseUrl = process.env.ORBICART_WEB_URL || "http://127.0.0.1:3000",
  timeoutMs = 180000,
  trustPrivateSiteHeaders = process.env.TRUST_PRIVATE_SITE_HEADERS === "true",
} = {}) {
  const origin = originFor(baseUrl);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new TypeError("Invalid frontend timeout");
  const transport = origin.protocol === "https:" ? https : http;
  return (req, res) => {
    const path = req.originalUrl || req.url;
    if (!path.startsWith("/") || path.startsWith("//") || /[\r\n\\]/.test(path)) return unavailable(res, 400);
    let incoming;
    const forward = transport.request({
      protocol: origin.protocol, hostname: origin.hostname, port: origin.port,
      method: req.method, path, headers: forwardingHeaders(req, origin, trustPrivateSiteHeaders),
    }, (response) => {
      incoming = response;
      const headers = representationHeaders(response.headers);
      if (typeof headers.location === "string" && headers.location.startsWith(origin.origin + "/")) {
        const protocol = req.socket.encrypted ? "https" : "http";
        headers.location = `${protocol}://${req.headers.host}${headers.location.slice(origin.origin.length)}`;
      }
      res.writeHead(response.statusCode || 502, headers);
      res.flushHeaders();
      response.on("error", () => res.destroy());
      response.pipe(res);
    });
    forward.setTimeout(timeoutMs, () => { unavailable(res, 504); forward.destroy(); incoming?.destroy(); });
    forward.on("error", () => { if (!res.writableEnded) unavailable(res); });
    req.on("aborted", () => forward.destroy());
    req.on("error", () => forward.destroy());
    res.on("close", () => { if (!res.writableEnded) { forward.destroy(); incoming?.destroy(); } });
    req.pipe(forward);
  };
}

/** Next development HMR shares the public port with the independent Gemini voice relay. */
export function attachFrontendGateway(server, {
  baseUrl = process.env.ORBICART_WEB_URL || "http://127.0.0.1:3000",
  timeoutMs = 10000,
} = {}) {
  const origin = originFor(baseUrl);
  const transport = origin.protocol === "https:" ? https : http;
  const sockets = new Set();
  function upgrade(req, client, head) {
    if (!req.url.startsWith("/_next/")) return;
    const headers = forwardingHeaders(req, origin);
    headers.connection = "Upgrade";
    headers.upgrade = "websocket";
    let remote;
    const forward = transport.request({
      protocol: origin.protocol, hostname: origin.hostname, port: origin.port,
      method: "GET", path: req.url, headers,
    });
    sockets.add(client);
    const cleanup = () => { sockets.delete(client); forward.destroy(); remote?.destroy(); };
    client.on("error", cleanup);
    client.once("close", cleanup);
    const fail = () => {
      if (!client.destroyed) client.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    };
    forward.on("error", fail);
    forward.setTimeout(timeoutMs, () => { fail(); forward.destroy(); });
    forward.on("response", (response) => { response.resume(); fail(); });
    forward.on("upgrade", (response, socket, upstreamHead) => {
      forward.setTimeout(0);
      remote = socket;
      if (client.destroyed) return socket.destroy();
      const lines = [];
      for (let i = 0; i < response.rawHeaders.length; i += 2) lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
      client.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join("\r\n")}\r\n\r\n`);
      if (upstreamHead.length) client.write(upstreamHead);
      if (head.length) socket.write(head);
      socket.on("error", () => client.destroy());
      socket.once("close", () => client.destroy());
      client.pipe(socket).pipe(client);
    });
    forward.end();
  }
  server.on("upgrade", upgrade);
  return () => {
    server.removeListener("upgrade", upgrade);
    for (const socket of sockets) socket.destroy();
    sockets.clear();
  };
}
