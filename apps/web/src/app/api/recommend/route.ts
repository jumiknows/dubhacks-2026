import { recommend } from "../../../lib/server/shop";

/**
 * POST /api/recommend
 *   { items: [{ id, name, spec, quantity }] }
 * → { recommendations: [{ itemId, status, products }], failures, tookMs }
 */
export async function POST(request: Request) {
  let body: { items?: unknown; budget?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: { message: "Send JSON." } }, { status: 400 }); }
  const items = Array.isArray(body.items) ? body.items.slice(0, 30).flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    return typeof item?.id === "string" && typeof item.name === "string"
      ? [{ id: item.id, name: item.name, spec: typeof item.spec === "string" ? item.spec : null, quantity: Number.isInteger(item.quantity) && (item.quantity as number) > 0 ? item.quantity as number : 1 }]
      : [];
  }) : [];
  if (!items.length) return Response.json({ error: { message: "items is required." } }, { status: 400 });
  const started = Date.now();
  const result = await recommend(items);
  return Response.json({ ...result, tookMs: Date.now() - started });
}
