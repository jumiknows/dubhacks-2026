/** Fixed, bounded calls to the marketplace side of the Python service. */
export async function marketPost(path, body) {
  const upstream = new URL(process.env.PYTHON_API_URL || process.env.CONJURE_API_URL || "http://127.0.0.1:8000");
  if (!["http:", "https:"].includes(upstream.protocol) || upstream.username || upstream.password ||
      upstream.pathname !== "/" || upstream.search || upstream.hash || !/^\/market\/(search|details|synthesize|compare|top)$/.test(path)) {
    throw new TypeError("Marketplace service requires a credential-free HTTP(S) origin and a fixed route");
  }
  const response = await fetch(new URL(path, upstream), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Marketplace service failed (${response.status})`);
  return response.json();
}
