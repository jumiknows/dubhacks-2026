import http from "node:http";
import https from "node:https";
import { Transform } from "node:stream";

const ID = "[A-Za-z0-9_-]{1,128}";
const ROUTES = [
  { path: /^\/health$/, methods: ["GET"] },
  { path: /^\/session$/, methods: ["POST"] },
  { path: /^\/chat$/, methods: ["POST"] },
  { path: /^\/feedback$/, methods: ["POST"] },
  { path: /^\/compare$/, methods: ["POST"] },
  { path: /^\/market\/(?:search|details|synthesize|compare|top)$/, methods: ["POST"] },
  { path: /^\/products\/search$/, methods: ["GET"], query: ["q", "max_price", "limit", "session_id"] },
  { path: /^\/products\/recommend$/, methods: ["POST"] },
  { path: /^\/reviews\/(?:analyze|fetch|demo)$/, methods: ["POST"] },
  { path: /^\/reviews\/(?:sources|workbench)$/, methods: ["GET"] },
  { path: /^\/reviews\/products$/, methods: ["GET"], query: ["merchant", "q", "limit"] },
  { path: /^\/websites\/(?:assess|checkout-check|demo)$/, methods: ["POST"] },
  { path: /^\/websites\/(?:config|workbench)$/, methods: ["GET"] },
  { path: new RegExp(`^/products/${ID}$`), methods: ["GET"] },
  { path: new RegExp(`^/trust/${ID}$`), methods: ["GET"] },
  { path: new RegExp(`^/profile/${ID}$`), methods: ["GET", "PUT", "DELETE"] },
  { path: new RegExp(`^/audit/${ID}$`), methods: ["GET"] },
  { path: /^\/mandate\/intent$/, methods: ["POST"] },
  { path: /^\/checkout\/(?:stage|intent)$/, methods: ["POST"] },
  { path: /^\/stt\/token$/, methods: ["GET"] },
  { path: /^\/tts$/, methods: ["POST"] },
];

function sendError(res, status, message) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

/** Mounted at /api/conjure before express.json so bodies and SSE remain streams.
 * The upstream origin comes only from server configuration, never from a client.
 */
export function createPythonGateway({
  baseUrl = process.env.CONJURE_API_URL || "http://127.0.0.1:8000",
  timeoutMs = Number(process.env.CONJURE_API_TIMEOUT_MS || 125000),
  maxBodyBytes = 1024 * 1024,
} = {}) {
  const upstream = new URL(baseUrl);
  if (!["http:", "https:"].includes(upstream.protocol) || upstream.username || upstream.password ||
      upstream.pathname !== "/" || upstream.search || upstream.hash) {
    throw new TypeError("CONJURE_API_URL must be a credential-free HTTP(S) origin without a path or query");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180000) {
    throw new TypeError("CONJURE_API_TIMEOUT_MS must be an integer between 1 and 180000");
  }
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) throw new TypeError("Invalid gateway body limit");
  const transport = upstream.protocol === "https:" ? https : http;

  return function pythonGateway(req, res) {
    const path = req.url.split("?")[0];
    const route = ROUTES.find((candidate) => candidate.path.test(path));
    if (!route || req.url.includes("#")) return sendError(res, 404, "Unknown Conjure API route");
    if (!route.methods.includes(req.method)) {
      res.setHeader("Allow", route.methods.join(", "));
      return sendError(res, 405, "Method is not allowed for this Conjure API route");
    }
    const query = new URLSearchParams(req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "");
    if ([...query.keys()].some((key) => !(route.query || []).includes(key))) {
      return sendError(res, 400, "Unsupported Conjure API query parameter");
    }
    if (Number(req.headers["content-length"]) > maxBodyBytes) return sendError(res, 413, "Conjure request body is too large");

    // Forward only representation headers. Browser cookies, Authorization,
    // API keys, proxy headers and server configuration never cross the gateway.
    const headers = {};
    for (const name of ["accept", "content-type"]) {
      if (typeof req.headers[name] === "string") headers[name] = req.headers[name];
    }
    let timer;
    let response;
    const forward = transport.request(new URL(path + (query.size ? `?${query}` : ""), upstream), {
      method: req.method,
      headers,
    }, (incoming) => {
      response = incoming;
      const outgoingHeaders = {};
      for (const name of ["content-type", "cache-control", "x-accel-buffering"]) {
        if (incoming.headers[name] !== undefined) outgoingHeaders[name] = incoming.headers[name];
      }
      // Node's request client does not follow upstream redirects.
      res.writeHead(incoming.statusCode || 502, outgoingHeaders);
      res.flushHeaders();
      incoming.on("error", () => { clearTimeout(timer); res.destroy(); });
      incoming.on("end", () => clearTimeout(timer));
      incoming.pipe(res);
    });
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        this.received = (this.received || 0) + chunk.length;
        if (this.received > maxBodyBytes) {
          sendError(res, 413, "Conjure request body is too large");
          forward.destroy();
          callback(new Error("Request body limit exceeded"));
        } else callback(null, chunk);
      },
    });
    limiter.on("error", () => { req.unpipe(limiter); req.resume(); });
    timer = setTimeout(() => {
      sendError(res, 504, "Conjure API request timed out");
      forward.destroy();
      response?.destroy();
    }, timeoutMs);
    forward.on("error", () => {
      clearTimeout(timer);
      if (!res.writableEnded) sendError(res, 503, "Conjure API is unavailable");
    });
    req.on("aborted", () => { clearTimeout(timer); forward.destroy(); });
    req.on("error", () => { clearTimeout(timer); forward.destroy(); });
    res.on("close", () => {
      clearTimeout(timer);
      if (!res.writableEnded) { forward.destroy(); response?.destroy(); }
    });
    req.pipe(limiter).pipe(forward);
  };
}
