"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import {
  compareKits, parseTripRequest, upcomingSaturday,
  type Evidence, type EvidenceId, type Kit, type KitChange,
} from "@emberready/domain";
import { useGestureEvents } from "conjure-gestures";
import { VoiceConnection, type ToolHandler } from "../voice/realtime";
import { TripMap, type LayerId, type Layers } from "./trip-map";
import { AppLinks } from "../esper/gestures";
import { CheckoutControls, EvidenceTools, type OfferComparison } from "../esper/shopping";
import type { Listing, PlanItem, ShoppingPlan } from "../esper/api";
import { Latest, cartState, chosenIndex, comparePair, inStock, isSuperseded, shopApi, sliderOrder, Superseded } from "./trip-shop";

const Onboarding = dynamic(() => import("../esper/onboarding/Onboarding"), { ssr: false });
const AccountChip = dynamic(() => import("../esper/onboarding/AccountChip"), { ssr: false });

interface Place { name: string; region: string | null; country: string | null; latitude: number; longitude: number }
interface ForecastDay { date: string; high: number | null; low: number | null; rainChance: number | null; summary: string }
interface Trip { destination: string; startDate: string; nights: number; people: number; budget: number | null; owned: string[]; fireWarnings: boolean }
interface TripResult { trip: Trip; place: Place; forecastDays: ForecastDay[]; evidence: Partial<Record<EvidenceId, Evidence>>; unavailable: { source: string; reason: string }[]; kit: Kit; tookMs: number }
interface Comparison { itemId: string; result: OfferComparison | null }
interface Account { profile?: { completedAt?: string } }

const HIGHLIGHTS: EvidenceId[] = ["typical.rainDays", "typical.siteLow", "typical.coldNight", "typical.uv", "recent.rain7d", "forecast.rainChance", "terrain.elevation", "terrain.relief", "hazard.fireKm"];
const LAYER_LABEL: Record<LayerId, string> = { precipitation: "Rain (GPM)", snow: "Snow", true_color: "Satellite", fires: "Fires" };
const STORAGE = "esper.trip";

function placeName(place: Place) { return [place.name, place.region].filter(Boolean).join(", "); }
function addDays(day: string, n: number) { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dayLabel(day: string) { return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" }); }
function money(n: number) { return `$${n % 1 ? n.toFixed(2) : n}`; }
function display(e: Evidence) {
  if (e.value === null) return "–";
  if (e.unit === "share") return `${Math.round(e.value * 100)}%`;
  if (e.unit === "index") return e.value.toFixed(2);
  return `${e.value}${e.unit === "%" ? "%" : ` ${e.unit}`}`;
}
const message = (error: unknown) => error instanceof Error ? error.message : "Something went wrong.";
/** What the store listings themselves say, side by side. */
function factRows(left: Listing, right: Listing): [string, string, string][] {
  const price = (l: Listing) => l.price !== null ? money(l.price) : "Unknown";
  const sale = (l: Listing) => typeof l.compareAt === "number" ? `Was ${money(l.compareAt)}` : "No";
  const notes = (l: Listing) => Array.isArray(l.why) && l.why.length ? l.why.slice(0, 3).join(", ") : "None listed";
  return [["Price", price(left), price(right)], ["On sale", sale(left), sale(right)], ["Store", left.store, right.store],
    ["In stock", inStock(left) ? "Yes" : "No", inStock(right) ? "Yes" : "No"], ["Fit notes", notes(left), notes(right)]];
}

export function Esper({ today }: { today: string }) {
  const [result, setResult] = useState<TripResult | null>(null);
  const [changes, setChanges] = useState<{ from: string; list: KitChange[] } | null>(null);
  const [plan, setPlan] = useState<ShoppingPlan | null>(null);
  const [notes, setNotes] = useState<Record<string, string | null>>({});
  const [inCart, setInCart] = useState<Record<string, boolean>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, number>>({});
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [reviewRequest, setReviewRequest] = useState(0);
  const [layers, setLayers] = useState<Layers>({ precipitation: true, snow: false, true_color: false, fires: false });
  const [imageryDate, setImageryDate] = useState(addDays(today, -2));
  const [fires, setFires] = useState<{ latitude: number; longitude: number }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [log, setLog] = useState<{ who: "you" | "grok" | "system"; text: string }[]>([
    { who: "grok", text: "Hi! Where are you camping, and when? Tell me your budget and what gear you already own." },
  ]);
  const [voice, setVoice] = useState<{ status: "off" | "connecting" | "on"; message: string }>({ status: "off", message: "" });
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [contextSynced, setContextSynced] = useState(true);
  const [showEvidence, setShowEvidence] = useState(false);
  const [me, setMe] = useState<Account | null>(null);
  const [setup, setSetup] = useState<{ google: string | null } | null>(null);
  const connection = useRef<VoiceConnection | null>(null);
  const trips = useRef(new Latest());
  const products = useRef(new Latest());
  const compares = useRef(new Latest());
  const lastInteraction = useRef<Record<string, unknown> | null>(null);
  const state = useRef({ result, plan, inCart, focus, comparison, preview });
  state.current = { result, plan, inCart, focus, comparison, preview };

  const cart = useMemo(() => cartState(plan, result?.kit ?? null, inCart, result?.trip.budget ?? null), [plan, result, inCart]);
  const slider = useMemo(() => plan ? sliderOrder(plan.items, cart.allocation) : [], [plan, cart.allocation]);
  const sliderRef = useRef(slider); sliderRef.current = slider;

  // --- session ---------------------------------------------------------------------------------

  useEffect(() => {
    try { setCode(sessionStorage.getItem("orbicart.voiceCode") ?? ""); } catch { /* storage blocked */ }
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE) || "null");
      if (saved?.result?.trip) {
        setResult(saved.result); setInCart(saved.inCart || {}); setNotes(saved.notes || {});
        if (saved.plan?.id) { setPlan(saved.plan); const check = products.current.next(); void shopApi.refresh(saved.plan.id).then((next) => { check(); setPlan(next); }).catch(() => undefined); }
      }
    } catch { /* Start fresh when storage is unavailable. */ }
    const params = new URLSearchParams(location.search);
    const replay = params.has("onboarding") || params.has("google");
    void fetch("/api/me", { signal: AbortSignal.timeout(3000) }).then((res) => res.ok ? res.json() : null).then((body) => {
      if (!body) return; setMe(body);
      if (replay || !body.profile?.completedAt) setSetup({ google: params.get("google") });
    }).catch(() => undefined);
    return () => connection.current?.stop();
  }, []);
  useEffect(() => {
    if (!result) return;
    try { sessionStorage.setItem(STORAGE, JSON.stringify({ result, plan, inCart, notes })); } catch { /* The trip still works without storage. */ }
  }, [result, plan, inCart, notes]);
  useEffect(() => { if (focus && !slider.some((item) => item.id === focus)) setFocus(slider[0]?.id ?? null); else if (!focus && slider.length) setFocus(slider[0].id); }, [slider, focus]);
  useEffect(() => { if (focus) document.querySelector(`[data-card="${CSS.escape(focus)}"]`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); }, [focus]);
  useEffect(() => {
    if (!result) { setFires([]); return; }
    const controller = new AbortController();
    fetch(`/api/fires?lat=${result.place.latitude}&lon=${result.place.longitude}&km=250`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : { fires: [] }).then((f) => setFires(f.fires ?? [])).catch(() => undefined);
    return () => controller.abort();
  }, [result?.place.latitude, result?.place.longitude]);

  function note(event: Record<string, unknown>) { lastInteraction.current = { ...event, at: new Date().toISOString() }; }

  // --- actions shared by the screen, gestures and Grok ---------------------------------------

  const planTrip = useCallback(async (input: Partial<Trip> & { destination: string }) => {
    const check = trips.current.next(); products.current.cancel(); compares.current.cancel();
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
      check();
      const next = data as TripResult;
      setChanges(previous && placeName(previous.place) !== placeName(next.place) ? { from: placeName(previous.place), list: compareKits(previous.kit, next.kit) } : null);
      setResult(next); setPlan(null); setNotes({}); setInCart({}); setFocus(null); setPreview({}); setComparison(null);
      state.current = { ...state.current, result: next, plan: null, inCart: {}, focus: null, comparison: null };
      return next;
    } finally { setBusy((value) => value?.startsWith("Reading NASA") ? null : value); }
  }, [today]);

  const findProducts = useCallback(async (trip: TripResult) => {
    const check = products.current.next();
    const landed = () => { check(); if (state.current.result !== trip) throw new Superseded("A newer trip replaced these offers."); };
    setBusy("Finding real products at outdoor stores…");
    try {
      // The same trip keeps its saved plan, so purchases and the spent budget carry over.
      const current = state.current.plan;
      if (current) { const next = await shopApi.refresh(current.id); landed(); setPlan(next); state.current.plan = next; return next; }
      const created = await shopApi.create(trip.kit, `Kit for ${placeName(trip.place)}`, trip.trip.budget);
      landed();
      setPlan(created.plan); state.current.plan = created.plan;
      setNotes(Object.fromEntries(created.recommendations.map((row) => [row.itemId, row.message])));
      note({ type: "products_loaded", plan_id: created.plan.id });
      return created.plan;
    } finally { setBusy((value) => value?.startsWith("Finding") ? null : value); }
  }, []);

  /** Every backend write returns the whole plan. Drop it if the trip moved on meanwhile. */
  async function write(run: (planId: string) => Promise<ShoppingPlan>) {
    const current = state.current.plan;
    if (!current) throw new Error("Find products for your kit first.");
    const next = await run(current.id);
    if (state.current.plan?.id !== current.id) throw new Superseded("A newer trip replaced this change.");
    state.current.plan = next; setPlan(next);
    return next;
  }
  const itemOf = (itemId: string) => {
    const item = state.current.plan?.items.find((row) => row.id === itemId);
    if (!item) throw new Error("Unknown shopping item.");
    return item;
  };

  async function chooseOffer(itemId: string, listingId: string) {
    const item = itemOf(itemId);
    const index = item.products.findIndex((row) => row.id === listingId);
    if (index < 0) throw new Error("That listing is not in the current shopping plan.");
    setPreview((value) => ({ ...value, [itemId]: index }));
    try {
      await write((planId) => shopApi.choose(planId, itemId, listingId));
      setCart(itemId, true, false);
      note({ type: "select_product", item_id: itemId, product_id: listingId });
    } finally { setPreview((value) => { const rest = { ...value }; delete rest[itemId]; return rest; }); }
  }
  function browse(itemId: string, step: number) {
    const item = itemOf(itemId);
    const target = item.products[(state.current.preview[itemId] ?? chosenIndex(item)) + step];
    if (target) void chooseOffer(itemId, target.id).catch(report);
  }
  function setCart(itemId: string, on: boolean, check = true) {
    const item = itemOf(itemId);
    if (check && on && (item.owned || item.purchased)) throw new Error("Owned and purchased items cannot be added to the cart.");
    if (check && on && !inStock(item.synthesis?.best)) throw new Error("Choose an available offer with a known price first.");
    const next = { ...state.current.inCart, [itemId]: on }; state.current.inCart = next; setInCart(next);
    note({ type: "set_cart_item", item_id: itemId, in_cart: on });
  }
  async function markOwned(itemId: string, owned: boolean) {
    const next = await write((planId) => shopApi.setOwned(planId, itemId, owned));
    const name = next.items.find((row) => row.id === itemId)?.name.toLowerCase();
    const trip = state.current.result;
    if (name && trip) {
      const updated = { ...trip, trip: { ...trip.trip, owned: owned ? [...new Set([...trip.trip.owned, name])] : trip.trip.owned.filter((row) => row.toLowerCase() !== name) } };
      state.current.result = updated; setResult(updated);
    }
    setCart(itemId, false, false);
    note({ type: "mark_owned", item_id: itemId, owned });
  }
  async function compareOffers(itemId: string, leftId?: string, rightId?: string) {
    const [left, right] = comparePair(itemOf(itemId), leftId, rightId);
    const check = compares.current.next();
    setComparison({ itemId, result: null }); setFocus(itemId);
    try {
      const value = await shopApi.compare(left, right);
      check(); setComparison({ itemId, result: value });
      note({ type: "compare_offers", item_id: itemId, left_id: left.id, right_id: right.id });
      return value;
    } catch (err) { if (!isSuperseded(err)) setComparison(null); throw err; }
  }
  function moveFocus(step: number) {
    const list = sliderRef.current; if (!list.length) return;
    const index = list.findIndex((item) => item.id === state.current.focus);
    const next = list[Math.min(list.length - 1, Math.max(0, index + step))];
    if (next) { setFocus(next.id); note({ type: "open_item", item_id: next.id }); }
  }
  function report(err: unknown) { if (!isSuperseded(err)) setError(message(err)); }

  // --- gestures: swipe left/right browses offers, up/down moves between items, fist adds to cart, two hands compare

  const scrollRun = useRef({ total: 0, at: 0, stepped: false });
  const overShelf = (x: number, y: number) => !!document.elementFromPoint(x * innerWidth, y * innerHeight)?.closest(".oc-shelf");
  // The gesture keyboard adapter also emits reveal and dismiss for arrow keys. The shelf handles keys itself.
  const fromHand = (event: { source: string }) => event.source === "hand" || event.source === "replay";
  useGestureEvents("reveal", (event) => { const id = state.current.focus; if (id && fromHand(event)) browse(id, 1); });
  useGestureEvents("dismiss", (event) => { const id = state.current.focus; if (id && fromHand(event)) browse(id, -1); });
  useGestureEvents("scroll", (event) => {
    if (!state.current.plan || !overShelf(event.start_x ?? event.x, event.start_y ?? event.y)) return;
    // One swipe arrives as several small scroll events. Step one item per swipe, not per event.
    const run = scrollRun.current; const now = performance.now();
    if (now - run.at > 400) { run.total = 0; run.stepped = false; }
    run.at = now; run.total += event.delta_y ?? 0;
    if (!run.stepped && Math.abs(run.total) >= 0.12) { run.stepped = true; moveFocus(run.total > 0 ? 1 : -1); }
  });
  useGestureEvents("grab", (event) => { const id = state.current.focus; if (id && fromHand(event)) { try { setCart(id, true); } catch (err) { report(err); } } });
  useGestureEvents("compare", (event) => {
    const ids = (event.target_ids || []).map((id) => /^product:([^:]+):(.+)$/.exec(id)).filter((m): m is RegExpExecArray => !!m);
    const itemId = ids[0]?.[1] ?? state.current.focus;
    if (itemId) void compareOffers(itemId, ids[0]?.[2], ids[1]?.[1] === itemId ? ids[1][2] : undefined).catch(report);
  });
  function onShelfKey(event: KeyboardEvent) {
    const id = state.current.focus; if (!id || (event.target as HTMLElement).closest("input, a")) return;
    const keys: Record<string, () => void> = { ArrowRight: () => browse(id, 1), ArrowLeft: () => browse(id, -1), ArrowDown: () => moveFocus(1), ArrowUp: () => moveFocus(-1) };
    if (keys[event.key]) { event.preventDefault(); keys[event.key](); }
  }

  // --- Grok tools -----------------------------------------------------------------------------

  function shoppingState(compact = false): Record<string, unknown> {
    const s = state.current;
    const { funds, allocation } = cartState(s.plan, s.result?.kit ?? null, s.inCart, s.result?.trip.budget ?? null);
    const items = (s.plan?.items || []).filter((item) => !compact || item.id === s.focus || item.id === s.comparison?.itemId);
    const winner = s.comparison?.result?.pick ? s.comparison.result[s.comparison.result.pick] : null;
    return {
      plan_id: s.plan?.id ?? null, focus_item_id: s.focus, map_layers: layers,
      items: items.slice(0, 60).map((item) => ({ item_id: item.id, name: item.name, quantity: item.quantity, owned: !!item.owned, purchased: !!item.purchased,
        selected_product_id: item.synthesis?.best?.id ?? null,
        offers: item.products.slice(0, compact ? 3 : 8).map((offer) => ({ product_id: offer.id, title: offer.title.slice(0, 160), store: offer.store, price: offer.price, currency: offer.currency, in_stock: offer.inStock ?? offer.in_stock ?? null, notes: offer.why })) })),
      comparison: s.comparison ? { item_id: s.comparison.itemId, loading: !s.comparison.result, winner_id: winner?.id ?? null, reasons: s.comparison.result?.reasons.slice(0, 4) } : null,
      cart: { item_ids: allocation.buy.map((row) => row.itemId), total: allocation.total, currency: "USD", rent_or_borrow: allocation.later.map((row) => row.name) },
      budget: funds, last_interaction: lastInteraction.current, checkout: "Review only. The user must confirm payment on screen.",
    };
  }
  const snapshot = JSON.stringify(shoppingState(true));
  useEffect(() => { if (connection.current) setContextSynced(connection.current.updateShoppingContext(JSON.parse(snapshot))); }, [snapshot]);

  const summarizeTrip = (t: TripResult, list: KitChange[] | null) => ({
    place: placeName(t.place), dates: `${t.trip.startDate}, ${t.trip.nights} night(s)`, people: t.trip.people, budget: t.trip.budget,
    kit: t.kit.items.map((i) => ({ item_id: i.id, name: i.name, quantity: i.quantity, spec: i.spec, reason: i.reason, evidence: i.evidence.map((id) => t.evidence[id] ? `${t.evidence[id]!.source.name}: ${t.evidence[id]!.text}` : id) })),
    skipped_because_owned: t.kit.skipped.map((s) => s.name), changes_from_previous_destination: list ?? undefined,
    forecast: t.forecastDays.filter((d) => d.date >= t.trip.startDate).slice(0, t.trip.nights + 1),
    unavailable_sources: t.unavailable.map((u) => u.source),
  });

  const toolHandler: ToolHandler = async (name, args) => {
    const s = state.current;
    const id = String(args.item_id ?? "");
    switch (name) {
      case "plan_trip": {
        const t = await planTrip({
          destination: String(args.destination ?? ""), startDate: typeof args.start_date === "string" ? args.start_date : undefined,
          nights: typeof args.nights === "number" ? args.nights : undefined, people: typeof args.people === "number" ? args.people : undefined,
          budget: typeof args.budget === "number" ? args.budget : undefined, owned: Array.isArray(args.owned) ? args.owned.map(String) : undefined,
        });
        return summarizeTrip(t, s.result && placeName(s.result.place) !== placeName(t.place) ? compareKits(s.result.kit, t.kit) : null);
      }
      case "find_products": {
        if (!s.result) return { error: "Call plan_trip first." };
        await findProducts(s.result);
        return shoppingState();
      }
      case "select_product": await chooseOffer(id, String(args.product_id)); return shoppingState(true);
      case "mark_owned": await markOwned(id, true); return shoppingState();
      case "get_shopping_state": return shoppingState();
      case "open_item": itemOf(id); setFocus(id); return shoppingState(true);
      case "compare_offers": await compareOffers(id, typeof args.left_id === "string" ? args.left_id : undefined, typeof args.right_id === "string" ? args.right_id : undefined); return shoppingState(true);
      case "set_cart_item": setCart(id, args.in_cart === true); return shoppingState();
      case "review_checkout": setReviewRequest((value) => value + 1); return { ...shoppingState(), review_open: true, payment_authorized: false };
      case "set_map_layer": {
        const layer = String(args.layer) as LayerId;
        if (!(layer in LAYER_LABEL)) return { error: "Unknown layer." };
        setLayers((l) => ({ ...l, [layer]: Boolean(args.visible) }));
        return { ok: true };
      }
      default: return { error: `Unknown tool ${name}.` };
    }
  };

  // --- conversation ---------------------------------------------------------------------------

  async function startVoice() {
    if (voice.status !== "off") { connection.current?.stop(); connection.current = null; setVoice({ status: "off", message: "Voice off. You can keep typing." }); return; }
    try { sessionStorage.setItem("orbicart.voiceCode", code); } catch { /* storage blocked */ }
    setVoice({ status: "connecting", message: "Connecting to Grok…" });
    let listening = false;
    const conn = new VoiceConnection((text, ready) => {
      if (connection.current !== conn) return;
      setVoice({ status: ready ? "on" : "off", message: text });
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
      setVoice({ status: "off", message: message(err) });
      if (/access code|authorized/i.test(String(err))) setShowCode(true);
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
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
      await findProducts(t);
    } catch (err) { report(err); }
  }

  const transcript = useRef<HTMLDivElement | null>(null);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "smooth" }); }, [log]);

  if (setup) return <Onboarding me={me || { google: {}, user: null }} googleStatus={setup.google} onFinish={(start) => {
    setSetup(null); history.replaceState(history.state, "", "/");
    if (start?.prompt) void send(start.prompt);
  }} />;

  const pastDays = Array.from({ length: 7 }, (_, i) => addDays(today, i - 8));
  const tripDays = result ? new Set(Array.from({ length: result.trip.nights + 1 }, (_, i) => addDays(result.trip.startDate, i))) : new Set<string>();
  const { allocation, funds } = cart;
  const compared = comparison ? plan?.items.find((item) => item.id === comparison.itemId) : null;

  return <div className="oc" id="main-content" data-ready={!!result}>
    <header className="oc-top">
      <div className="brand"><span className="oc-mark" aria-hidden="true" />Esper</div>
      <div className="sat mono"><span className="sat-dot" aria-hidden="true" />NASA POWER · GPM IMERG · SRTM · FIRMS · Grok Voice</div>
      <AccountChip me={me} />
      <AppLinks />
    </header>

    <section className="oc-stage" aria-label="Map">
      <div className="oc-map">
        <TripMap place={result ? { latitude: result.place.latitude, longitude: result.place.longitude, name: placeName(result.place) } : null} layers={layers} imageryDate={imageryDate} fires={fires} />
        <div className="hud mono" aria-hidden="true">
          <span>{result ? placeName(result.place).toUpperCase() : "NO DESTINATION"}</span>
          {result ? <span>{result.place.latitude.toFixed(3)}, {result.place.longitude.toFixed(3)}</span> : null}
          {layers.precipitation ? <span>GPM RAIN {imageryDate}</span> : null}
        </div>
        <div className="oc-layers" role="group" aria-label="Map layers">
          {(Object.keys(LAYER_LABEL) as LayerId[]).map((id) => <button key={id} type="button" aria-pressed={layers[id]} data-layer={id} onClick={() => setLayers((l) => ({ ...l, [id]: !l[id] }))}>{LAYER_LABEL[id]}{id === "fires" && layers.fires ? ` · ${fires.length}` : ""}</button>)}
        </div>
        {busy ? <div className="oc-busy mono" role="status"><span className="oc-spinner" aria-hidden="true" />{busy}</div> : null}
      </div>

      <div className="oc-timeline" aria-label="Rain and forecast">
        <div className="oc-tl-group">
          <span className="oc-tl-label">Satellite rain · tap a day</span>
          <div className="oc-tl-days">{pastDays.map((day) => <button key={day} type="button" aria-pressed={imageryDate === day} onClick={() => { setImageryDate(day); setLayers((l) => ({ ...l, precipitation: true })); }}>{dayLabel(day)}</button>)}</div>
        </div>
        <div className="oc-tl-group">
          <span className="oc-tl-label">Forecast{result ? ` · ${result.forecastDays.length ? "NWS" : "unavailable"}` : ""}</span>
          <div className="oc-tl-days">{(result?.forecastDays ?? []).map((day) => <div key={day.date} className="oc-fc" data-trip={tripDays.has(day.date)} title={day.summary}>
            <span>{dayLabel(day.date)}</span>
            <b className="mono">{day.high !== null ? Math.round(day.high) : "–"}°<i>{day.low !== null ? Math.round(day.low) : "–"}°</i></b>
            <span className="oc-pop mono" style={{ ["--pop" as string]: `${day.rainChance ?? 0}%` }}>{day.rainChance ?? 0}%</span>
          </div>)}{!result ? <p className="subtle">Plan a trip to see the forecast.</p> : null}</div>
        </div>
      </div>
    </section>

    <aside className="oc-panel" aria-label="Grok shopping assistant">
      <div className="oc-grok">
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
        {!contextSynced ? <p role="status" className="oc-voice-note">The shopping context is too large to share. Ask Grok to refresh the shopping state.</p> : null}
        <div className="oc-log" ref={transcript} aria-live="polite">
          {log.map((line, i) => line.text ? <p key={i} data-who={line.who}>{line.text}</p> : null)}
        </div>
        <form className="oc-ask" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <label className="sr-only" htmlFor="oc-input">Message Grok</label>
          <input id="oc-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={result ? "What if I go to Moab instead?" : "I'm camping near Seattle this weekend with $200, I own boots"} />
          <button type="submit" className="btn primary" disabled={!input.trim()}>Send</button>
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
        <h3>NASA evidence</h3>
        <ul className="oc-evidence">{HIGHLIGHTS.map((id) => result.evidence[id]).filter((e): e is Evidence => !!e).map((e) => <li key={e.id} data-kind={e.kind} title={`${e.source.name} · ${e.source.product} · ${e.source.period}`}><span>{e.label}</span><b className="mono">{display(e)}</b><em>{e.source.name}</em></li>)}</ul>
        {result.unavailable.length ? <p className="oc-missing">Not used: {result.unavailable.map((u) => u.source).join(", ")}.</p> : null}
      </div> : null}
    </aside>

    {result && plan ? <section className="oc-shelf" aria-label="Recommended products" tabIndex={0} onKeyDown={onShelfKey} data-gesture-scroll data-gesture-step>
      <div className="oc-shelf-head">
        <h2>Your kit for {placeName(result.place)}</h2>
        {allocation.budget !== null ? <div className="oc-meter" aria-label={`${money(allocation.total)} of ${money(allocation.budget)} budget`}>
          <span className="mono">{money(allocation.total)} <i>of {money(allocation.budget)}{funds.spent ? ` · ${money(funds.spent)} already spent` : ""}</i></span>
          <div className="oc-meter-bar"><span style={{ width: `${allocation.budget ? Math.min(100, (allocation.total / allocation.budget) * 100) : 100}%` }} /></div>
          {allocation.later.length ? <span className="oc-later">Rent or borrow: {allocation.later.map((p) => p.name).join(", ")} ({money(Math.round((allocation.fullKitTotal - allocation.total) * 100) / 100)} more to buy)</span> : <span className="oc-later">Whole kit fits</span>}
        </div> : funds.known ? <span className="mono subtle">Kit total {money(allocation.fullKitTotal)}</span> : <span className="mono subtle">Budget evidence unavailable</span>}
        <div className="oc-shelf-actions">
          <button type="button" className="btn" disabled={!focus} onClick={() => { if (focus) void compareOffers(focus).catch(report); }}>Compare offers</button>
          <button type="button" className="btn primary" onClick={() => setReviewRequest((v) => v + 1)}>Cart · {allocation.buy.length} · {money(allocation.total)}</button>
        </div>
      </div>
      <p className="oc-gesture-hint mono">Real store listings · Hands: swipe left or right for offers, up or down for items, fist adds to cart, two hands compare · Arrow keys work too</p>
      <ul className="oc-rail">
        {slider.map((item) => <Card key={item.id} item={item} focused={item.id === focus} index={preview[item.id] ?? chosenIndex(item)}
          kitItem={result.kit.items.find((row) => row.id === item.id)} note={notes[item.id] ?? null}
          inCart={inCart[item.id] !== false} later={allocation.later.some((row) => row.itemId === item.id)}
          onFocus={() => { setFocus(item.id); note({ type: "open_item", item_id: item.id }); }} onBrowse={(step) => browse(item.id, step)}
          onCart={() => { try { setCart(item.id, inCart[item.id] === false); } catch (err) { report(err); } }}
          onOwned={() => void markOwned(item.id, !item.owned).catch(report)} />)}
      </ul>


      <div className="esper-trip-checkout">
        <CheckoutControls plan={plan} itemIds={allocation.buy.map((row) => row.itemId)} reviewRequest={reviewRequest} onPlan={(next) => { if (state.current.plan?.id === next.id) { state.current.plan = next; setPlan(next); } }} />
        <button type="button" className="btn" onClick={() => setShowEvidence((value) => !value)} aria-expanded={showEvidence}>Review and website evidence</button>
        {showEvidence ? <EvidenceTools /> : null}
      </div>
    </section> : null}

    {comparison && compared ? <div className="oc-compare" role="region" aria-label="Offer comparison">
      <header><h3>{!comparison.result ? `Comparing ${compared.name} offers…` : comparison.result.pick ? `${comparison.result[comparison.result.pick].title} recommended` : "Offer tradeoffs"}</h3>
        <button type="button" className="btn" onClick={() => { compares.current.cancel(); setComparison(null); }}>Close</button></header>
      {comparison.result ? <>
        {comparison.result.pick ? <p>{comparison.result.reasons.join(" ")}</p> : <p>The scoring backend found no clear winner. Here is what the stores list.</p>}
        <table><thead><tr><th>Factor</th><th>{comparison.result.left.title}</th><th>{comparison.result.right.title}</th></tr></thead>
          <tbody>{factRows(comparison.result.left, comparison.result.right).map(([name, left, right]) => <tr key={name}><th>{name}</th><td>{left}</td><td>{right}</td></tr>)}
            {comparison.result.axes.filter((axis) => axis.left !== axis.right).map((axis) => <tr key={axis.name}><th>{axis.name.replace(/_/g, " ")}</th><td>{axis.left}</td><td>{axis.right}</td></tr>)}
            <tr><th />{[comparison.result.left, comparison.result.right].map((offer) => <td key={offer.id}><button type="button" className="btn" disabled={!inStock(offer)} onClick={() => void chooseOffer(comparison.itemId, offer.id).catch(report)}>Choose this</button></td>)}</tr></tbody></table>
      </> : null}
    </div> : null}
  </div>;
}

function Card({ item, kitItem, note, focused, index, inCart, later, onFocus, onBrowse, onCart, onOwned }: {
  item: PlanItem; kitItem?: Kit["items"][number]; note: string | null; focused: boolean; index: number; inCart: boolean; later: boolean;
  onFocus: () => void; onBrowse: (step: number) => void; onCart: () => void; onOwned: () => void;
}) {
  const product = item.products[index];
  const done = item.owned || item.purchased;
  return <li className="oc-card" data-card={item.id} data-focused={focused} data-in={inCart && !!product && !done} data-later={later} data-priority={kitItem?.priority}
    data-product-id={product ? `product:${item.id}:${product.id}` : undefined} onClick={onFocus}>
    <div className="oc-card-top"><span className="oc-card-item">{item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ""}</span>{kitItem?.priority === "conditions" ? <span className="oc-nasa" title={kitItem.reason}>NASA</span> : null}</div>
    {product ? <>
      <a className="oc-img" href={product.url ?? undefined} target="_blank" rel="noreferrer">{product.image ? <img src={`${product.image}${product.image.includes("?") ? "&" : "?"}width=320`} alt="" loading="lazy" /> : null}</a>
      <a className="oc-title" href={product.url ?? undefined} target="_blank" rel="noreferrer">{product.title}</a>
      <p className="oc-store">{product.store}</p>
      <p className="oc-price mono">{product.price !== null ? money(product.price) : "–"}{typeof product.compareAt === "number" ? <s>{money(product.compareAt)}</s> : null}</p>
      <p className="oc-why">{kitItem?.reason}</p>
      <div className="oc-card-actions">
        <button type="button" aria-label="Previous option" disabled={index === 0 || done} onClick={(e) => { e.stopPropagation(); onFocus(); onBrowse(-1); }}>‹</button>
        <span className="mono">{index + 1}/{item.products.length}</span>
        <button type="button" aria-label="Next option" disabled={index >= item.products.length - 1 || done} onClick={(e) => { e.stopPropagation(); onFocus(); onBrowse(1); }}>›</button>
        {done ? <span className="oc-cart" data-done>{item.purchased ? "Purchased" : "Owned"}</span>
          : <button type="button" className="oc-cart" aria-pressed={inCart} onClick={(e) => { e.stopPropagation(); onCart(); }}>{inCart ? (later ? "Rent or borrow" : "In budget") : "Add"}</button>}
      </div>
      {!item.purchased ? <button type="button" className="oc-owned" onClick={(e) => { e.stopPropagation(); onOwned(); }}>{item.owned ? "I need this" : "I own this"}</button> : null}
    </> : <p className="oc-none">{note ?? "No in-stock match at a connected store."}</p>}
  </li>;
}
