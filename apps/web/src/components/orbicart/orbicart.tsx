"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  compareKits, parseTripRequest, planBudget, upcomingSaturday,
  type Evidence, type EvidenceId, type Kit, type KitChange, type Pick,
} from "@emberready/domain";
import { VoiceConnection, type ToolHandler } from "../voice/realtime";
import { useGestureEvents } from "conjure-gestures";
import { api, valued, type ShoppingPlan, type PlanItem } from "../esper/api";
import { AppLinks } from "../esper/gestures";
import { CheckoutControls, EvidenceTools, type OfferComparison } from "../esper/shopping";
import ShopBoard, { LISTING_DRAG_TYPE } from "../esper/board/ShopBoard";
import "../esper/board/board.css";
import { remainingTripBudget } from "../../lib/trip-budget";

interface Place { name: string; region: string | null; country: string | null; latitude: number; longitude: number }
interface ForecastDay { date: string; high: number | null; low: number | null; rainChance: number | null; summary: string }
interface Trip { destination: string; startDate: string; nights: number; people: number; budget: number | null; owned: string[]; fireWarnings: boolean }
interface TripResult { trip: Trip; place: Place; forecastDays: ForecastDay[]; evidence: Partial<Record<EvidenceId, Evidence>>; unavailable: { source: string; reason: string }[]; kit: Kit; tookMs: number }
interface Product { id: string; title: string; store: string; url: string; image: string | null; price: number; compareAt: number | null; available: boolean; why: string[] }
interface Recommendation { itemId: string; name: string; quantity: number; status: string; message: string | null; products: Product[] }

const HIGHLIGHTS: EvidenceId[] = ["typical.rainDays", "typical.siteLow", "typical.coldNight", "typical.uv", "recent.rain7d", "forecast.rainChance", "terrain.elevation", "terrain.relief", "hazard.fireKm"];

function placeName(place: Place) { return [place.name, place.region].filter(Boolean).join(", "); }
function dayLabel(day: string) { return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" }); }
function money(n: number) { return `$${n % 1 ? n.toFixed(2) : n}`; }
function display(e: Evidence) {
  if (e.value === null) return "–";
  if (e.unit === "share") return `${Math.round(e.value * 100)}%`;
  if (e.unit === "index") return e.value.toFixed(2);
  return `${e.value}${e.unit === "%" ? "%" : ` ${e.unit}`}`;
}

export function OrbiCart({ today }: { today: string }) {
  const [backendPlan, setBackendPlan] = useState<ShoppingPlan | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{ item_id: string; left_id: string; right_id: string; result: OfferComparison | null; loading: boolean } | null>(null);
  const [lastInteraction, setLastInteraction] = useState<Record<string, unknown> | null>(null);
  const [reviewRequest, setReviewRequest] = useState(0);
  const [dragging, setDragging] = useState(false);
  const compareGeneration = useRef(0);
  const [showEvidence, setShowEvidence] = useState(false);
  const restored = useRef(false);
  const generation = useRef(0);
  const productGeneration = useRef(0);
  const tripGenerations = useRef(new WeakMap<TripResult, number>());
  const [result, setResult] = useState<TripResult | null>(null);
  const [changes, setChanges] = useState<{ from: string; list: KitChange[] } | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [choice, setChoice] = useState<Record<string, number>>({});
  const [inCart, setInCart] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [log, setLog] = useState<{ who: "you" | "grok" | "system"; text: string }[]>([
    { who: "grok", text: "Hi! Where are you camping, and when? Tell me your budget and what gear you already own." },
  ]);
  const [voice, setVoice] = useState<{ status: "off" | "connecting" | "on"; message: string }>({ status: "off", message: "" });
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const connection = useRef<VoiceConnection | null>(null);
  const interactionSource = useRef("pointer");
  const [contextSynced, setContextSynced] = useState(true);
  const state = useRef({ result, recs, choice, inCart, backendPlan, inspect, comparison, lastInteraction });
  state.current = { result, recs, choice, inCart, backendPlan, inspect, comparison, lastInteraction };

  useEffect(() => {
    try { const saved = JSON.parse(sessionStorage.getItem("orbicart.trip") || "null"); if (saved?.result?.trip && Array.isArray(saved.recs)) { tripGenerations.current.set(saved.result, generation.current); setResult(saved.result); setRecs(saved.recs); setChoice(saved.choice || {}); setInCart(saved.inCart || {}); if (saved.backendPlan?.id) { setBackendPlan(saved.backendPlan); const token = generation.current; void api<ShoppingPlan>(`/api/plans/${encodeURIComponent(saved.backendPlan.id)}`).then((next) => { if (generation.current === token && (!state.current.backendPlan || state.current.backendPlan.id === saved.backendPlan.id)) setBackendPlan(next); }).catch(() => undefined); } } } catch { /* Start a new trip if storage is unavailable. */ }
    restored.current = true;
  }, []);
  useEffect(() => { if (!restored.current || !result) return; try { sessionStorage.setItem("orbicart.trip", JSON.stringify({ result, recs, choice, inCart, backendPlan, inspect, comparison, lastInteraction })); } catch { /* The trip remains usable without storage. */ } }, [result, recs, choice, inCart, backendPlan]);
  function noteInteraction(event: Record<string, unknown>) {
    const next = { source: interactionSource.current, ...event, at: new Date().toISOString() };
    state.current.lastInteraction = next; setLastInteraction(next);
  }
  function focusItem(itemId: string | null) {
    state.current.inspect = itemId; setInspect(itemId);
    if (itemId) noteInteraction({ type: "open_item", item_id: itemId });
  }
  useGestureEvents("*", (event) => {
    if (["hover", "drag_move", "bimanual_progress", "pointer_up", "release"].includes(event.type)) return;
    if (!event.target_id && !event.group_id && !event.target_ids?.length) return;
    interactionSource.current = event.source;
    noteInteraction({ type: event.type, gesture: event.gesture_id, action: event.action, target_id: event.target_id, target_ids: event.target_ids, source: event.source });
  });
  useGestureEvents("drag_start", (event) => { if (event.target_id?.startsWith("product:")) setDragging(true); });
  useGestureEvents("cancel", () => setDragging(false));
  useGestureEvents("drop", (event) => {
    setDragging(false); if (event.drop_target_id !== "cart") return;
    const match = /^product:([^:]+):(.+)$/.exec(event.target_id || "");
    if (match) void chooseOffer(match[1], match[2]).catch((err) => setError(err.message));
  });

  const selectProduct = async (itemId: string, index: number) => {
    const current = state.current; const token = generation.current; const source = interactionSource.current;
    if (current.result && (tripGenerations.current.get(current.result) ?? token) !== token) throw new DOMException("A newer trip replaced this selection.", "AbortError");
    const product = current.recs?.find((rec) => rec.itemId === itemId)?.products[index];
    if (!current.backendPlan || !product) throw new Error("Refresh product offers before choosing a listing.");
    const next = await api<ShoppingPlan>(`/api/plans/${encodeURIComponent(current.backendPlan.id)}/items/${encodeURIComponent(itemId)}/listing`, "PUT", { listingId: product.id });
    if (generation.current !== token || state.current.backendPlan?.id !== current.backendPlan.id) throw new DOMException("A newer trip replaced this selection.", "AbortError");
    const choices = { ...state.current.choice, [itemId]: index }; const cart = { ...state.current.inCart, [itemId]: true };
    state.current = { ...state.current, backendPlan: next, choice: choices, inCart: cart };
    setBackendPlan(next); setChoice(choices); setInCart(cart);
    noteInteraction({ type: "select_product", item_id: itemId, product_id: product.id, source });
  };

  useEffect(() => { try { setCode(sessionStorage.getItem("orbicart.voiceCode") ?? ""); } catch { /* storage blocked */ } }, []);
  useEffect(() => () => connection.current?.stop(), []);

  // --- actions shared by the page and Grok's tools ------------------------------------------

  const planTrip = useCallback(async (input: Partial<Trip> & { destination: string }) => {
    const token = ++generation.current;
    const previous = state.current.result;
    const base = previous?.trip;
    const body: Trip = {
      destination: input.destination,
      startDate: input.startDate ?? base?.startDate ?? upcomingSaturday(today),
      nights: input.nights ?? base?.nights ?? 1,
      people: input.people ?? base?.people ?? 1,
      budget: input.budget !== undefined ? input.budget : base?.budget ?? null,
      owned: input.owned ?? base?.owned ?? [],
      fireWarnings: true,
    };
    setBusy(`Reading NASA data for ${body.destination}…`); setError("");
    try {
      const response = await fetch("/api/trip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not plan that trip.");
      if (generation.current !== token) throw new DOMException("A newer trip replaced this request.", "AbortError");
      const next = data as TripResult; tripGenerations.current.set(next, token);
      setChanges(previous && placeName(previous.place) !== placeName(next.place) ? { from: placeName(previous.place), list: compareKits(previous.kit, next.kit) } : null);
      setResult(next); setRecs(null); setChoice({}); setInCart({}); setBackendPlan(null); setInspect(null); setComparison(null);
      state.current = { ...state.current, result: next, recs: null, choice: {}, inCart: {}, backendPlan: null, inspect: null, comparison: null };
      return next;
    } catch (error) { if (generation.current !== token) throw new DOMException("A newer trip replaced this request.", "AbortError"); throw error; } finally { if (generation.current === token) setBusy(null); }
  }, [today]);

  const findProducts = useCallback(async (kit: Kit, tripContext = state.current.result) => {
    const token = tripContext ? tripGenerations.current.get(tripContext) ?? generation.current : generation.current;
    if (token !== generation.current) throw new DOMException("A newer trip replaced these offers.", "AbortError");
    const requestId = ++productGeneration.current;
    // Reusing the same trip preserves settled purchases, reservations and its cumulative budget.
    const existing = state.current;
    if (tripContext && existing.result === tripContext && existing.backendPlan && existing.recs) {
      const next = await api<ShoppingPlan>(`/api/plans/${encodeURIComponent(existing.backendPlan.id)}`);
      if (generation.current !== token || productGeneration.current !== requestId || state.current.backendPlan?.id !== existing.backendPlan.id) throw new DOMException("A newer trip replaced these offers.", "AbortError");
      state.current.backendPlan = next; setBackendPlan(next);
      noteInteraction({ type: "products_refreshed", plan_id: next.id });
      return existing.recs;
    }
    setBusy("Finding real products at outdoor stores…");
    try {
      const response = await fetch("/api/orbicart/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: kit.items.map(({ id, name, spec, quantity }) => ({ id, name, spec, quantity })), title: tripContext ? `Kit for ${placeName(tripContext.place)}` : "Camping kit", budget: tripContext?.trip.budget ?? null }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message ?? "Stores did not respond.");
      if (generation.current !== token || productGeneration.current !== requestId) throw new DOMException("A newer request replaced these offers.", "AbortError");
      const list = data.recommendations as Recommendation[];
      setRecs(list); setBackendPlan(data.plan as ShoppingPlan);
      state.current = { ...state.current, recs: list, backendPlan: data.plan as ShoppingPlan };
      const first: Record<string, number> = {}, cart: Record<string, boolean> = {};
      for (const rec of list) if (rec.products.length) { first[rec.itemId] = 0; cart[rec.itemId] = true; }
      setChoice(first); setInCart(cart);
      state.current = { ...state.current, choice: first, inCart: cart };
      noteInteraction({ type: "products_loaded", plan_id: data.plan.id });
      return list;
    } catch (error) { if (generation.current !== token || productGeneration.current !== requestId) throw new DOMException("A newer request replaced these offers.", "AbortError"); throw error; } finally { if (generation.current === token && productGeneration.current === requestId) setBusy(null); }
  }, []);

  const picks = useMemo<Pick[]>(() => {
    if (!result || !backendPlan) return [];
    return backendPlan.items.flatMap((item) => {
      const total = item.synthesis?.totalPrice; const best = item.synthesis?.best;
      const kitItem = result.kit.items.find((row) => row.id === item.id);
      return typeof total === "number" && Number.isFinite(total) && total > 0 && item.quantity > 0 && best && (best.inStock ?? best.in_stock) === true && item.synthesis?.currency === "USD" && !item.owned && !item.purchased && inCart[item.id] !== false
        ? [{ itemId: item.id, name: item.name, unitPrice: total / item.quantity, quantity: item.quantity, priority: kitItem?.priority || "essential" }] : [];
    });
  }, [result, backendPlan, inCart]);
  const budget = useMemo(() => remainingTripBudget(result?.trip.budget ?? null, (backendPlan?.items || []).flatMap((item) => item.order ? [item.order] : [])), [backendPlan, result]);
  const plan = useMemo(() => planBudget(picks, budget.available), [picks, budget.available]);
  async function chooseOffer(itemId: string, productId: string) {
    const rec = state.current.recs?.find((row) => row.itemId === itemId);
    const index = rec?.products.findIndex((row) => row.id === productId) ?? -1;
    if (index < 0) throw new Error("That listing is not in the current shopping plan.");
    await selectProduct(itemId, index);
  }
  function setCartItem(itemId: string, inCart: boolean) {
    const item = state.current.backendPlan?.items.find((row) => row.id === itemId);
    if (!item) throw new Error("Unknown shopping item.");
    if (item.owned || item.purchased) throw new Error("Owned and purchased items cannot be added to the cart.");
    const product = item.synthesis?.best;
    if (inCart && (!product || (product.inStock ?? product.in_stock) !== true || !product.currency || !(typeof product.price === "number" && product.price > 0))) throw new Error("Choose an available offer with a known price and currency first.");
    const next = { ...state.current.inCart, [itemId]: inCart }; state.current.inCart = next; setInCart(next);
    noteInteraction({ type: "set_cart_item", item_id: itemId, in_cart: inCart });
  }
  async function markOwned(itemId: string, owned: boolean) {
    const current = state.current; const token = generation.current;
    if (!current.backendPlan) throw new Error("No shopping plan yet.");
    const next = await api<ShoppingPlan>(`/api/plans/${encodeURIComponent(current.backendPlan.id)}/items/${encodeURIComponent(itemId)}`, "PATCH", { owned });
    if (generation.current !== token || state.current.backendPlan?.id !== current.backendPlan.id) throw new DOMException("A newer trip replaced this request.", "AbortError");
    state.current.backendPlan = next; setBackendPlan(next);
    const item = next.items.find((row) => row.id === itemId);
    if (item && state.current.result) {
      const previous = state.current.result;
      const updated = { ...previous, trip: { ...previous.trip, owned: owned ? [...new Set([...previous.trip.owned, item.name.toLowerCase()])] : previous.trip.owned.filter((name) => name.toLowerCase() !== item.name.toLowerCase()) } };
      tripGenerations.current.set(updated, generation.current); state.current.result = updated; setResult(updated);
    }
    const cart = { ...state.current.inCart, [itemId]: false }; state.current.inCart = cart; setInCart(cart);
    noteInteraction({ type: "mark_owned", item_id: itemId, owned });
  }
  async function compareOffers(itemId: string, leftId?: string, rightId?: string) {
    const current = state.current; const source = interactionSource.current; const item = current.backendPlan?.items.find((row) => row.id === itemId);
    if (!item) throw new Error("Unknown shopping item.");
    const left = item.products.find((row) => row.id === leftId) || (!leftId ? item.products[0] : undefined);
    const right = item.products.find((row) => row.id === rightId) || (!rightId ? item.products.find((row) => row.id !== left?.id) : undefined);
    if (!left || !right || left.id === right.id) throw new Error("Choose two different available offers to compare.");
    if (!left.currency || left.currency !== right.currency) throw new Error("Compare offers in the same known currency.");
    const run = ++compareGeneration.current; const token = generation.current;
    const next = { item_id: itemId, left_id: left.id, right_id: right.id, result: null, loading: true };
    state.current.comparison = next; setComparison(next); focusItem(itemId);
    try { const result = await api<OfferComparison>("/api/compare", "POST", { left: valued(left), right: valued(right), trust_floor: .5 });
      if (run !== compareGeneration.current || token !== generation.current) throw new DOMException("A newer comparison replaced this request.", "AbortError");
      const value = { ...next, result, loading: false }; state.current.comparison = value; setComparison(value);
      noteInteraction({ type: "compare_offers", item_id: itemId, left_id: left.id, right_id: right.id, source }); return result;
    } catch (err) { if (run === compareGeneration.current) { setComparison(null); state.current.comparison = null; } throw err; }
  }
  function shoppingState(compact = false): Record<string, unknown> {
    const s = state.current;
    const funds = remainingTripBudget(s.result?.trip.budget ?? null, (s.backendPlan?.items || []).flatMap((item) => item.order ? [item.order] : []));
    const selected: Pick[] = (s.backendPlan?.items || []).flatMap((item) => {
      const best = item.synthesis?.best; const kitItem = s.result?.kit.items.find((row) => row.id === item.id);
      const total = item.synthesis?.totalPrice;
      return best && typeof total === "number" && Number.isFinite(total) && total > 0 && item.quantity > 0 && item.synthesis?.currency === "USD" && (best.inStock ?? best.in_stock) === true && !item.owned && !item.purchased && s.inCart[item.id] !== false ? [{ itemId: item.id, name: item.name, quantity: item.quantity, unitPrice: total / item.quantity, priority: kitItem?.priority || "essential" }] : [];
    });
    const allocation = planBudget(selected, funds.available);
    const items = (s.backendPlan?.items || []).filter((item) => !compact || item.id === s.inspect || item.id === s.comparison?.item_id);
    return { plan_id: s.backendPlan?.id ?? null, title: s.backendPlan?.title ?? null, focus_item_id: s.inspect,
      items: items.slice(0, compact ? 1 : 60).map((item) => ({ item_id: item.id, name: item.name, quantity: item.quantity, owned: !!item.owned, purchased: !!item.purchased, selected_product_id: item.synthesis?.best?.id ?? null, offers: item.products.slice(0, compact ? 3 : 8).map((offer) => ({ product_id: offer.id, title: offer.title.slice(0, 160), store: offer.store, price: offer.price, currency: offer.currency, in_stock: offer.inStock ?? offer.in_stock ?? null, source: offer.source, is_demo: !!offer.isMock })) })),
      comparison: s.comparison ? { item_id: s.comparison.item_id, left_id: s.comparison.left_id, right_id: s.comparison.right_id, loading: s.comparison.loading, winner_id: s.comparison.result?.pick ? s.comparison.result[s.comparison.result.pick].id : null, reasons: s.comparison.result?.reasons.slice(0, 4) } : null,
      cart: { item_ids: allocation.buy.map((item) => item.itemId), count: allocation.buy.length, total: allocation.total, currency: "USD", rent_or_borrow: allocation.later.map((item) => item.itemId) },
      budget: funds, last_interaction: s.lastInteraction, checkout: "Review only; the user must explicitly confirm payment." };
  }
  const shoppingSnapshot = JSON.stringify(shoppingState(true));
  useEffect(() => { if (connection.current) setContextSynced(connection.current.updateShoppingContext(JSON.parse(shoppingSnapshot))); }, [shoppingSnapshot]);
  const marks = Object.fromEntries((backendPlan?.items || []).map((item) => [item.id, item.purchased ? "purchased" : item.owned ? "owned" : plan.buy.some((row) => row.itemId === item.id) ? "cart" : "needed"]));

  // --- Grok tools ---------------------------------------------------------------------------

  const summarizeTrip = (t: TripResult, list: KitChange[] | null) => ({
    place: placeName(t.place), dates: `${t.trip.startDate}, ${t.trip.nights} night(s)`, people: t.trip.people, budget: t.trip.budget,
    kit: t.kit.items.map((i) => ({ item_id: i.id, name: i.name, quantity: i.quantity, spec: i.spec, reason: i.reason, evidence: i.evidence.map((id) => t.evidence[id] ? `${t.evidence[id]!.source.name}: ${t.evidence[id]!.text}` : id) })),
    skipped_because_owned: t.kit.skipped.map((s) => s.name), changes_from_previous_destination: list ?? undefined,
    forecast: t.forecastDays.filter((d) => d.date >= t.trip.startDate).slice(0, t.trip.nights + 1),
    unavailable_sources: t.unavailable.map((u) => u.source),
  });

  const summarizeProducts = (list: Recommendation[], selected: Record<string, number>) => list.map((rec) => ({
    item_id: rec.itemId, name: rec.name, quantity: rec.quantity, status: rec.status, message: rec.message ?? undefined,
    options: rec.products.slice(0, 3).map((p) => ({ product_id: p.id, title: p.title, store: p.store, price: p.price, on_sale_from: p.compareAt ?? undefined, notes: p.why })),
    selected: rec.products[selected[rec.itemId] ?? 0]?.id,
  }));

  const toolHandler: ToolHandler = async (name, args) => {
    interactionSource.current = "grok";
    const s = state.current;
    if (name === "plan_trip") {
      const t = await planTrip({
        destination: String(args.destination ?? ""), startDate: typeof args.start_date === "string" ? args.start_date : undefined,
        nights: typeof args.nights === "number" ? args.nights : undefined, people: typeof args.people === "number" ? args.people : undefined,
        budget: typeof args.budget === "number" ? args.budget : undefined, owned: Array.isArray(args.owned) ? args.owned.map(String) : undefined,
      });
      const list = s.result && placeName(s.result.place) !== placeName(t.place) ? compareKits(s.result.kit, t.kit) : null;
      return summarizeTrip(t, list);
    }
    if (name === "find_products") {
      if (!s.result) return { error: "Call plan_trip first." };
      const list = await findProducts(s.result.kit, s.result);
      const selected = Object.fromEntries(list.map((rec) => [rec.itemId, Math.max(0, rec.products.findIndex((offer) => offer.id === state.current.backendPlan?.items.find((item) => item.id === rec.itemId)?.synthesis?.best?.id))]));
      const current = shoppingState();
      return { items: summarizeProducts(list, selected), budget_plan: current.budget, cart: current.cart, shopping_state: current };
    }
    if (name === "select_product") {
      const rec = s.recs?.find((r) => r.itemId === args.item_id);
      const index = rec?.products.findIndex((p) => p.id === args.product_id) ?? -1;
      if (!rec || index < 0) return { error: "That product is not in the current options." };
      await selectProduct(rec.itemId, index);
      return { ok: true, selected: rec.products[index].title, price: rec.products[index].price };
    }
    if (name === "mark_owned") { await markOwned(String(args.item_id), true); return shoppingState(); }
    if (name === "get_shopping_state") return shoppingState();
    if (name === "open_item") {
      const id = String(args.item_id); if (!s.backendPlan?.items.some((item) => item.id === id)) return { error: "Unknown shopping item." };
      focusItem(id); return shoppingState();
    }
    if (name === "compare_offers") {
      await compareOffers(String(args.item_id), typeof args.left_id === "string" ? args.left_id : undefined, typeof args.right_id === "string" ? args.right_id : undefined);
      return shoppingState();
    }
    if (name === "set_cart_item") { setCartItem(String(args.item_id), args.in_cart === true); return shoppingState(); }
    if (name === "review_checkout") { setReviewRequest((value) => value + 1); noteInteraction({ type: "review_checkout", source: "grok" }); return { ...shoppingState(), review_open: true, payment_authorized: false }; }
    return { error: `Unknown tool ${name}.` };
  };

  // --- conversation ---------------------------------------------------------------------------

  async function startVoice() {
    if (voice.status !== "off") { connection.current?.stop(); connection.current = null; setVoice({ status: "off", message: "Voice off. You can keep typing." }); return; }
    try { sessionStorage.setItem("orbicart.voiceCode", code); } catch { /* storage blocked */ }
    setVoice({ status: "connecting", message: "Connecting to Grok…" });
    let listening = false;
    const conn = new VoiceConnection((message, ready) => {
      if (connection.current !== conn) return;
      setVoice({ status: ready ? "on" : "off", message });
      if (ready && !listening) { listening = true; void conn.microphone(); }
    }, (text) => {
      if (connection.current !== conn) return;
      setLog((l) => {
      const next = [...l];
      for (const part of text.split(/(\nYou: |\nGrok: )/)) {
        if (part === "\nYou: ") next.push({ who: "you", text: "" });
        else if (part === "\nGrok: ") next.push({ who: "grok", text: "" });
        else if (part) { const last = next.at(-1); if (last && last.who !== "system") next[next.length - 1] = { ...last, text: last.text + part }; else next.push({ who: "grok", text: part }); }
      }
      return next.slice(-40);
      });
    });
    connection.current = conn;
    setContextSynced(conn.updateShoppingContext(shoppingState(true)));
    try {
      await conn.startSession("/api/voice/shop-session", {}, code, { toolHandler, readyMessage: "Grok is listening.", maxSeconds: 300 });
    } catch (err) {
      conn.stop();
      if (connection.current !== conn) return;
      connection.current = null;
      setVoice({ status: "off", message: err instanceof Error ? err.message : "Grok is unavailable." });
      if (/access code|authorized/i.test(String(err))) setShowCode(true);
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (busy) return;
    if (!trimmed) return;
    setInput("");
    if (voice.status === "on" && connection.current) { connection.current.ask(trimmed); return; }
    // Without a Grok session: read the request locally and run the same tools.
    setLog((l) => [...l, { who: "you", text: trimmed }]);
    const parsed = parseTripRequest(trimmed, today);
    const destination = parsed.destination ?? (/^[A-Z][\w .,'-]+$/.test(trimmed) ? trimmed : state.current.result?.trip.destination);
    if (!destination) { setLog((l) => [...l, { who: "system", text: "Tell me where you are camping, for example “Moab, UT this weekend, $200, I own boots”. Or start Grok voice." }]); return; }
    try {
      const t = await planTrip({ destination, startDate: parsed.startDate ?? undefined, nights: parsed.nights ?? undefined, people: parsed.people ?? undefined, budget: parsed.budget ?? undefined, owned: parsed.owned.length ? parsed.owned : undefined });
      setLog((l) => [...l, { who: "system", text: `Kit ready for ${placeName(t.place)}: ${t.kit.items.length} items from NASA evidence. Finding products…` }]);
      await findProducts(t.kit, t);
    } catch (err) { if (!(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof Error ? err.message : "Something went wrong."); }
  }

  const transcript = useRef<HTMLDivElement | null>(null);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "smooth" }); }, [log]);

  return <div className="oc oc-shopping" id="main-content" data-ready={!!result}>
    <header className="oc-top">
      <div className="brand"><span className="oc-mark" aria-hidden="true" />OrbiCart</div>
      <div className="sat mono"><span className="sat-dot" aria-hidden="true" />NASA POWER · GPM IMERG · SRTM · FIRMS · Grok Voice</div>
      <AppLinks />
    </header>

    <section className="oc-stage orbicart-board" aria-label="Gesture shopping board" onPointerDownCapture={() => { interactionSource.current = "pointer"; }}>
      <header className="oc-board-intro"><p className="shop-kicker">ESPER gesture shopping · NASA grounded trips</p><h1>{result ? `Your kit for ${placeName(result.place)}` : "Where are you headed?"}</h1><p>Build a trip with Grok, then pull the group apart, inspect offers, compare and drag your choices into the cart. Grok sees what you are working with.</p></header>
      {busy ? <p className="oc-board-status" role="status">{busy}</p> : null}
      <div className="oc-board-workspace">
      {backendPlan ? <ShopBoard plans={[backendPlan]} marks={marks} focusId={inspect} onInspect={focusItem}
        onMark={(itemId) => { const item = state.current.backendPlan?.items.find((row) => row.id === itemId); void markOwned(itemId, !item?.owned).catch((err) => setError(err.message)); }}
        onToggle={(item: PlanItem) => { const current = state.current.backendPlan; if (current) void api<ShoppingPlan>(`/api/plans/${encodeURIComponent(current.id)}/items/${encodeURIComponent(item.id)}`, "PATCH", { purchased: !item.purchased }).then((next) => { if (state.current.backendPlan?.id === current.id) { state.current.backendPlan = next; setBackendPlan(next); } }).catch((err) => setError(err.message)); }}
        onAddListing={(item, product) => { void chooseOffer(item.id, product.id).catch((err) => setError(err.message)); }}
        onCompare={(item, left, right) => { void compareOffers(item.id, left, right).catch((err) => setError(err.message)); }} onInteraction={noteInteraction} />
        : <div className="oc-board-empty"><span aria-hidden="true">↔</span><h2>Your trip becomes a shopping board</h2><p>Tell Grok your destination, dates, budget and what you already own. Every offer you choose is saved by the shopping backend.</p><button type="button" className="btn primary" disabled={!!busy} onClick={() => void send("Camping in Seattle this weekend with $200")}>Plan a Seattle weekend</button></div>}
      {comparison ? <section className="oc-board-comparison" role="region" aria-label="Offer comparison"><header><h2>{comparison.loading ? "Comparing offers…" : comparison.result?.pick ? `${comparison.result[comparison.result.pick].title} recommended` : "Offer tradeoffs"}</h2><button type="button" className="btn" onClick={() => { ++compareGeneration.current; setComparison(null); state.current.comparison = null; }}>Close comparison</button></header>{comparison.result ? <><p>{comparison.result.reasons.join(" ")}</p><table><thead><tr><th>Factor</th><th>{comparison.result.left.title}</th><th>{comparison.result.right.title}</th></tr></thead><tbody>{comparison.result.axes.map((axis) => <tr key={axis.name}><th>{axis.name}</th><td>{axis.left}</td><td>{axis.right}</td></tr>)}</tbody></table><div className="esper-row esper-wrap">{[comparison.result.left, comparison.result.right].map((offer) => <button type="button" className="btn" key={offer.id} disabled={(offer.inStock ?? offer.in_stock) !== true || !offer.currency} onClick={() => void chooseOffer(comparison.item_id, offer.id).catch((err) => setError(err.message))}>Choose {offer.title}</button>)}</div><p className="oc-grok-context">Ask Grok about these offers. The comparison, your chosen offer and cart are shared.</p></> : null}</section> : null}
      </div>
      <footer className={`oc-board-cart${dragging ? " is-dragging" : ""}`} data-drop-zone="cart" aria-label="Shopping cart" onDragOver={(event) => { if (event.dataTransfer.types.includes(LISTING_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragging(true); } }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); try { const row = JSON.parse(event.dataTransfer.getData(LISTING_DRAG_TYPE)); if (typeof row.itemId === "string" && typeof row.productId === "string") void chooseOffer(row.itemId, row.productId).catch((err) => setError(err.message)); } catch { setError("Drop an offer from this shopping board."); } }}>
        <strong>Cart · {plan.buy.length} item{plan.buy.length === 1 ? "" : "s"} · {money(plan.total)}</strong><button type="button" className="btn" onClick={() => setReviewRequest((value) => value + 1)}>Review cart</button>
        {plan.budget !== null ? <div className="oc-meter"><span>{budget.known ? `${money(budget.spent ?? 0)} spent · ${money(plan.total)} selected · ${money(plan.budget)} available from ${money(budget.original ?? 0)} total` : "Budget evidence unavailable"}</span>{plan.later.length ? <p>Rent or borrow: {plan.later.map((item) => item.name).join(", ")}</p> : plan.buy.length ? <p>Whole kit fits</p> : null}</div> : null}
        {backendPlan?.items.filter((item) => !item.purchased && !item.owned && inCart[item.id] !== false).map((item) => <button type="button" key={item.id} className="oc-cart-remove" onClick={() => { try { setCartItem(item.id, false); } catch (err) { setError((err as Error).message); } }}>Remove {item.name}</button>)}
        <p className="shop-meta">Hold or drag selects an offer for your cart. Payment always needs your confirmation.</p>
      </footer>
    </section>

    <aside className="oc-panel" aria-label="Grok shopping assistant">
      <div className="oc-grok">
        {!contextSynced ? <p role="status" className="oc-voice-note">The shopping context is too large to share. Ask Grok to refresh the current shopping state.</p> : null}
        <p className="oc-grok-context" role="status">{inspect ? `Shared with Grok: ${backendPlan?.items.find((item) => item.id === inspect)?.name || inspect}${comparison ? " · comparing offers" : ""} · ${plan.buy.length} in cart` : `Shopping board shared · ${plan.buy.length} in cart`}</p>
        <div className="oc-grok-head">
          <h2>Grok</h2>
          <button type="button" className="oc-talk" data-status={voice.status} onClick={() => void startVoice()}>
            <span className="oc-talk-dot" aria-hidden="true" />{voice.status === "on" ? "Listening · stop" : voice.status === "connecting" ? "Connecting…" : "Talk to Grok"}
          </button>
          <button type="button" className="btn icon" aria-label="Voice access code" title="Voice access code" aria-expanded={showCode} onClick={() => setShowCode((v) => !v)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 2a5.5 5.5 0 0 0-5.2 7.3L2 14.6V18h3.4v-1.8h1.8v-1.8H9l1.7-1.7A5.5 5.5 0 1 0 12.5 2zm1.5 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" /></svg>
          </button>
        </div>
        {showCode ? <label className="oc-code">Voice access code<input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></label> : null}
        {voice.message ? <p className="oc-voice-note">{voice.message}</p> : null}
        <div className="oc-log" ref={transcript} aria-live="polite">
          {log.map((line, i) => line.text ? <p key={i} data-who={line.who}>{line.text}</p> : null)}
        </div>
        <form className="oc-ask" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <label className="sr-only" htmlFor="oc-input">Message Grok</label>
          <input id="oc-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={result ? "What if I go to Moab instead?" : "I'm camping near Seattle this weekend with $200, I own boots"} />
          <button type="submit" className="btn primary" disabled={!input.trim() || Boolean(busy)}>Send</button>
        </form>
        {error ? <p className="oc-error" role="alert">{error}</p> : null}
      </div>

      {result ? <div className="oc-profile">
        <h3>Trip profile</h3>
        <dl>
          <div><dt>Where</dt><dd>{placeName(result.place)}</dd></div>
          <div><dt>When</dt><dd>{dayLabel(result.trip.startDate)} · {result.trip.nights} night{result.trip.nights === 1 ? "" : "s"}</dd></div>
          <div><dt>People</dt><dd>{result.trip.people}</dd></div>
          <div><dt>Budget</dt><dd>{result.trip.budget ? money(result.trip.budget) : "Not set"}</dd></div>
          <div className="wide"><dt>Already own</dt><dd>{result.trip.owned.length ? result.trip.owned.join(", ") : "Nothing yet"}</dd></div>
        </dl>
        {changes?.list.length ? <div className="oc-changes"><h4>Changed from {changes.from}</h4><ul>{changes.list.slice(0, 6).map((c) => <li key={c.id + c.change} data-change={c.change}><b>{c.change === "added" ? "+" : c.change === "removed" ? "−" : "~"} {c.name}</b> {c.why}</li>)}</ul></div> : null}
        <details className="oc-forecast"><summary>Weather forecast · {result.forecastDays.length ? "NWS" : "unavailable"}</summary>{result.forecastDays.map((day) => <p key={day.date}>{dayLabel(day.date)} · {day.high ?? "–"}° / {day.low ?? "–"}° · {day.rainChance ?? "–"}% rain · {day.summary}</p>)}</details>
        <h3>NASA evidence</h3>
        <ul className="oc-evidence">{HIGHLIGHTS.map((id) => result.evidence[id]).filter((e): e is Evidence => !!e).map((e) => <li key={e.id} data-kind={e.kind} title={`${e.source.name} · ${e.source.product} · ${e.source.period}`}><span>{e.label}</span><b className="mono">{display(e)}</b><em>{e.source.name}</em></li>)}</ul>
        {result.unavailable.length ? <p className="oc-missing">Not used: {result.unavailable.map((u) => u.source).join(", ")}.</p> : null}
      </div> : null}
    </aside>

    <div className="esper-trip-checkout"><CheckoutControls plan={backendPlan} itemIds={plan.buy.map((item) => item.itemId)} reviewRequest={reviewRequest} onPlan={(next) => { if (state.current.backendPlan?.id !== next.id) return; state.current.backendPlan = next; setBackendPlan(next); noteInteraction({ type: "checkout_updated", plan_id: next.id }); }} /><button type="button" className="btn" onClick={() => setShowEvidence((value) => !value)} aria-expanded={showEvidence}>Review and website evidence</button>{showEvidence ? <EvidenceTools /> : null}</div>
  </div>;
}
