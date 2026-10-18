"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  compareKits, parseTripRequest, planBudget, upcomingSaturday,
  type Evidence, type EvidenceId, type Kit, type KitChange, type Pick,
} from "@emberready/domain";
import { VoiceConnection, type ToolHandler } from "../voice/realtime";
import { TripMap, type LayerId, type Layers } from "./trip-map";
import { scrollElement, useGestureEvents } from "conjure-gestures";
import { api, type ShoppingPlan, type Listing } from "../esper/api";
import { AppLinks } from "../esper/gestures";
import { CheckoutControls, EvidenceTools, OfferDialog } from "../esper/shopping";
import { remainingTripBudget } from "../../lib/trip-budget";

interface Place { name: string; region: string | null; country: string | null; latitude: number; longitude: number }
interface ForecastDay { date: string; high: number | null; low: number | null; rainChance: number | null; summary: string }
interface Trip { destination: string; startDate: string; nights: number; people: number; budget: number | null; owned: string[]; fireWarnings: boolean }
interface TripResult { trip: Trip; place: Place; forecastDays: ForecastDay[]; evidence: Partial<Record<EvidenceId, Evidence>>; unavailable: { source: string; reason: string }[]; kit: Kit; tookMs: number }
interface Product { id: string; title: string; store: string; url: string; image: string | null; price: number; compareAt: number | null; available: boolean; why: string[] }
interface Recommendation { itemId: string; name: string; quantity: number; status: string; message: string | null; products: Product[] }

const HIGHLIGHTS: EvidenceId[] = ["typical.rainDays", "typical.siteLow", "typical.coldNight", "typical.uv", "recent.rain7d", "forecast.rainChance", "terrain.elevation", "terrain.relief", "hazard.fireKm"];
const LAYER_LABEL: Record<LayerId, string> = { precipitation: "Rain (GPM)", snow: "Snow", true_color: "Satellite", fires: "Fires" };

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

export function OrbiCart({ today }: { today: string }) {
  const [backendPlan, setBackendPlan] = useState<ShoppingPlan | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const restored = useRef(false);
  const generation = useRef(0);
  const productGeneration = useRef(0);
  const tripGenerations = useRef(new WeakMap<TripResult, number>());
  const rail = useRef<HTMLUListElement | null>(null);
  const [result, setResult] = useState<TripResult | null>(null);
  const [changes, setChanges] = useState<{ from: string; list: KitChange[] } | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [choice, setChoice] = useState<Record<string, number>>({});
  const [inCart, setInCart] = useState<Record<string, boolean>>({});
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
  const connection = useRef<VoiceConnection | null>(null);
  const state = useRef({ result, recs, choice, inCart, backendPlan });
  state.current = { result, recs, choice, inCart, backendPlan };

  useEffect(() => {
    try { const saved = JSON.parse(sessionStorage.getItem("orbicart.trip") || "null"); if (saved?.result?.trip && Array.isArray(saved.recs)) { tripGenerations.current.set(saved.result, generation.current); setResult(saved.result); setRecs(saved.recs); setChoice(saved.choice || {}); setInCart(saved.inCart || {}); if (saved.backendPlan?.id) { setBackendPlan(saved.backendPlan); const token = generation.current; void api<ShoppingPlan>(`/api/plans/${encodeURIComponent(saved.backendPlan.id)}`).then((next) => { if (generation.current === token && (!state.current.backendPlan || state.current.backendPlan.id === saved.backendPlan.id)) setBackendPlan(next); }).catch(() => undefined); } } } catch { /* Start a new trip if storage is unavailable. */ }
    restored.current = true;
  }, []);
  useEffect(() => { if (!restored.current || !result) return; try { sessionStorage.setItem("orbicart.trip", JSON.stringify({ result, recs, choice, inCart, backendPlan })); } catch { /* The trip remains usable without storage. */ } }, [result, recs, choice, inCart, backendPlan]);
  useGestureEvents("expand", (event) => { const match = state.current.recs?.find((rec) => event.group_id === `kit:${rec.itemId}`); if (match) setInspect(match.itemId); });
  useGestureEvents("scroll", (event) => { if (!inspect && scrollElement(event.target_id) === rail.current) rail.current?.scrollBy({ left: (event.delta_y || 0) * rail.current.clientWidth, behavior: "smooth" }); });

  const selectProduct = async (itemId: string, index: number) => {
    const current = state.current; const token = generation.current;
    if (current.result && (tripGenerations.current.get(current.result) ?? token) !== token) throw new DOMException("A newer trip replaced this selection.", "AbortError");
    const product = current.recs?.find((rec) => rec.itemId === itemId)?.products[index];
    if (!current.backendPlan || !product) throw new Error("Refresh product offers before choosing a listing.");
    const next = await api<ShoppingPlan>(`/api/plans/${encodeURIComponent(current.backendPlan.id)}/items/${encodeURIComponent(itemId)}/listing`, "PUT", { listingId: product.id });
    if (generation.current !== token || state.current.backendPlan?.id !== current.backendPlan.id) throw new DOMException("A newer trip replaced this selection.", "AbortError");
    setBackendPlan(next); setChoice((value) => ({ ...value, [itemId]: index })); setInCart((value) => ({ ...value, [itemId]: true }));
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
      setResult(next); setRecs(null); setChoice({}); setInCart({}); setBackendPlan(null); setInspect(null);
      state.current = { ...state.current, result: next, recs: null, choice: {}, inCart: {}, backendPlan: null };
      fetch(`/api/fires?lat=${next.place.latitude}&lon=${next.place.longitude}&km=250`).then((r) => r.ok ? r.json() : { fires: [] }).then((f) => { if (generation.current === token) setFires(f.fires ?? []); }).catch(() => { if (generation.current === token) setFires([]); });
      return next;
    } catch (error) { if (generation.current !== token) throw new DOMException("A newer trip replaced this request.", "AbortError"); throw error; } finally { if (generation.current === token) setBusy(null); }
  }, [today]);

  const findProducts = useCallback(async (kit: Kit, tripContext = state.current.result) => {
    const token = tripContext ? tripGenerations.current.get(tripContext) ?? generation.current : generation.current;
    if (token !== generation.current) throw new DOMException("A newer trip replaced these offers.", "AbortError");
    const requestId = ++productGeneration.current;
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
      return list;
    } catch (error) { if (generation.current !== token || productGeneration.current !== requestId) throw new DOMException("A newer request replaced these offers.", "AbortError"); throw error; } finally { if (generation.current === token && productGeneration.current === requestId) setBusy(null); }
  }, []);

  const picks = useMemo<Pick[]>(() => {
    if (!result || !recs) return [];
    return recs.flatMap((rec) => {
      const product = rec.products[choice[rec.itemId] ?? 0];
      const item = result.kit.items.find((i) => i.id === rec.itemId);
      const saved = backendPlan?.items.find((row) => row.id === rec.itemId);
      return product && item && !saved?.owned && !saved?.purchased && inCart[rec.itemId] !== false ? [{ itemId: rec.itemId, name: rec.name, unitPrice: product.price, quantity: rec.quantity, priority: item.priority }] : [];
    });
  }, [result, recs, choice, inCart, backendPlan]);
  const budget = useMemo(() => remainingTripBudget(result?.trip.budget ?? null, (backendPlan?.items || []).flatMap((item) => item.order ? [item.order] : [])), [backendPlan, result]);
  const plan = useMemo(() => planBudget(picks, budget.available), [picks, budget.available]);
  // Slider order: what the budget buys (in plan order), then what to rent or borrow, then items without products.
  const cardRank = (rec: Recommendation) => {
    const bought = plan.buy.findIndex((p) => p.itemId === rec.itemId);
    if (bought >= 0) return bought;
    const later = plan.later.findIndex((p) => p.itemId === rec.itemId);
    return later >= 0 ? 100 + later : 200;
  };

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
    const s = state.current; const requestAtStart = generation.current;
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
      const first = Object.fromEntries(list.map((r) => [r.itemId, 0]));
      const p = planBudget(list.flatMap((rec) => { const prod = rec.products[0]; const item = s.result!.kit.items.find((i) => i.id === rec.itemId); return prod && item ? [{ itemId: rec.itemId, name: rec.name, unitPrice: prod.price, quantity: rec.quantity, priority: item.priority }] : []; }), s.result.trip.budget);
      return { items: summarizeProducts(list, first), budget_plan: { budget: p.budget, buy_now: p.buy.map((b) => b.name), rent_or_borrow: p.later.map((b) => b.name), total: p.total, full_kit_total: p.fullKitTotal, remaining: p.remaining } };
    }
    if (name === "select_product") {
      const rec = s.recs?.find((r) => r.itemId === args.item_id);
      const index = rec?.products.findIndex((p) => p.id === args.product_id) ?? -1;
      if (!rec || index < 0) return { error: "That product is not in the current options." };
      await selectProduct(rec.itemId, index);
      return { ok: true, selected: rec.products[index].title, price: rec.products[index].price };
    }
    if (name === "mark_owned") {
      if (!s.result) return { error: "No trip yet." };
      const item = s.result.kit.items.find((i) => i.id === args.item_id);
      if (!item) return { error: "Unknown kit item." };
      if (s.backendPlan && !s.backendPlan.items.find((row) => row.id === item.id)?.order) setBackendPlan(await api<ShoppingPlan>(`/api/plans/${encodeURIComponent(s.backendPlan.id)}/items/${encodeURIComponent(item.id)}`, "PATCH", { owned: true }));
      if (generation.current !== requestAtStart) throw new DOMException("A newer trip replaced this ownership request.", "AbortError");
      const t = await planTrip({ ...s.result.trip, owned: [...s.result.trip.owned, item.name.toLowerCase()] });
      await findProducts(t.kit, t);
      return summarizeTrip(t, null);
    }
    if (name === "set_map_layer") {
      const layer = String(args.layer) as LayerId;
      if (!(layer in LAYER_LABEL)) return { error: "Unknown layer." };
      setLayers((l) => ({ ...l, [layer]: Boolean(args.visible) }));
      return { ok: true };
    }
    return { error: `Unknown tool ${name}.` };
  };

  // --- conversation ---------------------------------------------------------------------------

  async function startVoice() {
    if (voice.status !== "off") { connection.current?.stop(); connection.current = null; setVoice({ status: "off", message: "Voice off. You can keep typing." }); return; }
    try { sessionStorage.setItem("orbicart.voiceCode", code); } catch { /* storage blocked */ }
    setVoice({ status: "connecting", message: "Connecting to Grok…" });
    let listening = false;
    const conn = new VoiceConnection((message, ready) => {
      setVoice({ status: ready ? "on" : "off", message });
      if (ready && !listening) { listening = true; void conn.microphone(); }
    }, (text) => setLog((l) => {
      const next = [...l];
      for (const part of text.split(/(\nYou: |\nGrok: )/)) {
        if (part === "\nYou: ") next.push({ who: "you", text: "" });
        else if (part === "\nGrok: ") next.push({ who: "grok", text: "" });
        else if (part) { const last = next.at(-1); if (last && last.who !== "system") next[next.length - 1] = { ...last, text: last.text + part }; else next.push({ who: "grok", text: part }); }
      }
      return next.slice(-40);
    }));
    connection.current = conn;
    try {
      await conn.startSession("/api/voice/shop-session", {}, code, { toolHandler, readyMessage: "Grok is listening.", maxSeconds: 300 });
    } catch (err) {
      conn.stop(); connection.current = null;
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

  const pastDays = Array.from({ length: 7 }, (_, i) => addDays(today, i - 8));
  const tripDays = result ? new Set(Array.from({ length: result.trip.nights + 1 }, (_, i) => addDays(result.trip.startDate, i))) : new Set<string>();

  return <div className="oc" id="main-content" data-ready={!!result}>
    <header className="oc-top">
      <div className="brand"><span className="oc-mark" aria-hidden="true" />OrbiCart</div>
      <div className="sat mono"><span className="sat-dot" aria-hidden="true" />NASA POWER · GPM IMERG · SRTM · FIRMS · Grok Voice</div>
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
        <h3>NASA evidence</h3>
        <ul className="oc-evidence">{HIGHLIGHTS.map((id) => result.evidence[id]).filter((e): e is Evidence => !!e).map((e) => <li key={e.id} data-kind={e.kind} title={`${e.source.name} · ${e.source.product} · ${e.source.period}`}><span>{e.label}</span><b className="mono">{display(e)}</b><em>{e.source.name}</em></li>)}</ul>
        {result.unavailable.length ? <p className="oc-missing">Not used: {result.unavailable.map((u) => u.source).join(", ")}.</p> : null}
      </div> : null}
    </aside>

    {result && recs ? <section className="oc-shelf" aria-label="Recommended products">
      <div className="oc-shelf-head">
        <h2>Your kit for {placeName(result.place)}</h2>
        {plan.budget !== null ? <div className="oc-meter" aria-label={`${money(budget.spent ?? 0)} spent, ${money(plan.total)} selected, ${money(plan.budget)} available from ${money(budget.original ?? 0)} budget`}>
          <span className="mono">{budget.known ? <>{money(budget.spent ?? 0)} spent · {money(plan.total)} selected <i>of {money(budget.original ?? 0)} total</i> · {money(plan.budget)} available</> : "Budget evidence unavailable"}</span>
          <div className="oc-meter-bar"><span style={{ width: `${budget.original ? Math.min(100, ((plan.total + (budget.spent ?? 0)) / budget.original) * 100) : 0}%` }} /></div>
          {plan.later.length ? <span className="oc-later">Rent or borrow: {plan.later.map((p) => p.name).join(", ")} ({money(Math.round((plan.fullKitTotal - plan.total) * 100) / 100)} more to buy)</span> : <span className="oc-later">Whole kit fits</span>}
        </div> : <span className="mono subtle">Kit total {money(plan.fullKitTotal)}</span>}
      </div>
      <ul className="oc-rail" ref={rail} data-gesture-step data-gesture-scroll="kit-rail" data-gesture-id="kit-rail">
        {[...recs].sort((a, b) => cardRank(a) - cardRank(b)).map((rec) => {
          const item = result.kit.items.find((i) => i.id === rec.itemId);
          const index = choice[rec.itemId] ?? 0;
          const product = rec.products[index];
          const later = plan.later.some((p) => p.itemId === rec.itemId);
          const saved = backendPlan?.items.find((row) => row.id === rec.itemId);
          return <li key={rec.itemId} className="oc-card" data-gesture-object={`kit:${rec.itemId}`} data-gesture-group={`kit:${rec.itemId}`} data-gesture-kind="original" data-in={inCart[rec.itemId] !== false && !!product} data-later={later} data-priority={item?.priority}>
            <div className="oc-card-top"><span className="oc-card-item">{rec.name}{rec.quantity > 1 ? ` ×${rec.quantity}` : ""}</span>{item?.priority === "conditions" ? <span className="oc-nasa" title={item.reason}>NASA</span> : null}</div>
            {product ? <>
              <button type="button" className="oc-img" aria-label={`Inspect ${rec.name} offers`} onClick={() => setInspect(rec.itemId)}>{product.image ? <img src={`${product.image}${product.image.includes("?") ? "&" : "?"}width=320`} alt="" loading="lazy" /> : null}</button>
              <button type="button" className="oc-title" onClick={() => setInspect(rec.itemId)}>{product.title}</button>
              <p className="oc-store">{product.store}</p>
              <p className="oc-price mono">{money(product.price)}{product.compareAt ? <s>{money(product.compareAt)}</s> : null}</p>
              <p className="oc-why">{item?.reason}</p>
              <div className="oc-card-actions">
                <button type="button" aria-label="Previous option" disabled={index === 0 || saved?.purchased || saved?.owned} onClick={() => { void selectProduct(rec.itemId, index - 1).catch((err) => setError(err.message)); }}>‹</button>
                <span className="mono">{index + 1}/{rec.products.length}</span>
                <button type="button" aria-label="Next option" disabled={index >= rec.products.length - 1 || saved?.purchased || saved?.owned} onClick={() => { void selectProduct(rec.itemId, index + 1).catch((err) => setError(err.message)); }}>›</button>
                <button type="button" className="oc-cart" disabled={saved?.purchased || saved?.owned} aria-pressed={inCart[rec.itemId] !== false} onClick={() => setInCart((c) => ({ ...c, [rec.itemId]: c[rec.itemId] === false }))}>{saved?.purchased ? "Purchased" : saved?.owned ? "Owned" : inCart[rec.itemId] !== false ? (later ? "Rent or borrow" : "In budget") : "Add"}</button>
              </div>
            </> : <p className="oc-none">{rec.message}</p>}
          </li>;
        })}
      </ul>
      <p className="oc-shelf-note">Listings retrieved from connected outdoor stores. Stock and prices are checked when retrieved. Merchant trust and delivered totals may be unknown.</p>
    </section> : null}
    <div className="esper-trip-checkout"><CheckoutControls plan={backendPlan} itemIds={plan.buy.map((item) => item.itemId)} onPlan={setBackendPlan} /><button type="button" className="btn" onClick={() => setShowEvidence((value) => !value)} aria-expanded={showEvidence}>Review and website evidence</button>{showEvidence ? <EvidenceTools /> : null}</div>
    {inspect && backendPlan?.items.find((item) => item.id === inspect) ? <OfferDialog plan={backendPlan} item={backendPlan.items.find((item) => item.id === inspect)!} onClose={() => setInspect(null)} onSelect={async (listing: Listing) => { const rec = state.current.recs?.find((row) => row.itemId === inspect); const index = rec?.products.findIndex((row) => row.id === listing.id) ?? -1; if (index >= 0) await selectProduct(inspect, index); }} onOwn={async () => { const token = generation.current; const current = state.current; if (!current.backendPlan || !current.result) return; const item = current.backendPlan.items.find((row) => row.id === inspect)!; const updated = await api<ShoppingPlan>(`/api/plans/${encodeURIComponent(current.backendPlan.id)}/items/${encodeURIComponent(item.id)}`, "PATCH", { owned: !item.owned }); if (generation.current !== token || state.current.backendPlan?.id !== current.backendPlan.id) throw new DOMException("A newer trip replaced this ownership request.", "AbortError"); setBackendPlan(updated); setInCart((value) => ({ ...value, [item.id]: false })); setResult((value) => { if (!value) return value; const next = { ...value, trip: { ...value.trip, owned: item.owned ? value.trip.owned.filter((name) => name !== item.name.toLowerCase()) : [...new Set([...value.trip.owned, item.name.toLowerCase()])] } }; tripGenerations.current.set(next, generation.current); return next; }); setInspect(null); }} /> : null}
  </div>;
}
