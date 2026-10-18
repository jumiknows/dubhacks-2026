function errorMessage(body, status) {
  if (typeof body?.error === "string") return body.error;
  if (typeof body?.detail === "string") return body.detail;
  if (Array.isArray(body?.detail)) return body.detail.map((entry) => entry.msg).filter(Boolean).join("; ") || `Request failed (${status})`;
  return `Request failed (${status})`;
}

export async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  if (body == null) throw new Error("The server returned an unreadable response. Try again.");
  return body;
}

export function post(path, body = {}, options = {}) {
  return request(path, { ...options, method: "POST", body: JSON.stringify(body) });
}

/** Consume POST SSE incrementally, including split UTF-8, CRLF and comment heartbeats. */
export async function streamEvents(path, body, onEvent, { signal } = {}) {
  const response = await fetch(path, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new Error(errorMessage(failure, response.status));
  }
  if (!response.body) throw new Error("Streaming is unavailable in this browser.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let data = [];
  function line(value) {
    if (value === "") {
      if (data.length) {
        let parsed;
        try { parsed = JSON.parse(data.join("\n")); }
        catch { throw new Error("The assistant returned an unreadable event. Please retry."); }
        onEvent(event, parsed);
      }
      event = "message";
      data = [];
      return;
    }
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":");
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? "" : value.slice(colon + 1);
    if (content.startsWith(" ")) content = content.slice(1);
    if (field === "event") event = content;
    if (field === "data") data.push(content);
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, end).replace(/\r$/, ""));
        buffer = buffer.slice(end + 1);
      }
      if (done) break;
    }
    if (buffer) line(buffer.replace(/\r$/, ""));
    line("");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function toValued(product) {
  return {
    ...product,
    in_stock: product.in_stock ?? product.inStock ?? false,
    bang_per_buck: product.bang_per_buck ?? 0,
    relevancy: product.relevancy ?? 1,
    trust: product.trust ?? 0,
    flags: product.flags || [], specs: Object.fromEntries(Object.entries(product.specs || {}).map(([key, value]) => [key, String(value)])),
    condition: product.condition || "new",
    review_count: product.review_count ?? product.reviewCount ?? 0,
    prime: product.prime || false,
    shipping_days: product.shipping_days ?? product.shippingDays,
    currency: product.currency ?? null,
  };
}
