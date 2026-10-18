import { useEffect, useRef, useState } from "react";
import { cancelCheckout, chooseListing, confirmCheckout, createPlan, getMe, getPlan, getPlans, setPurchased, startCheckout, updateItem, voiceAvailable } from "./api.js";
import { createLive } from "./live.js";
import AccountChip from "./onboarding/AccountChip.jsx";
import Onboarding from "./onboarding/Onboarding.jsx";
import PlannerUI from "./ui/PlannerUI.jsx";
import "./integration/integration.css";

const TABS = [
  { id: "groceries", label: "Groceries", prompt: "Weekly groceries for two people" },
  { id: "wedding", label: "Wedding", prompt: "I need to plan a small outdoor wedding." },
  { id: "camping", label: "Camping", prompt: "I need to prepare for camping." },
  { id: "electronics", label: "Electronics", prompt: "Keep my laptop, phone, and headphones current." },
  { id: "custom", label: "Custom", prompt: "" },
];

function readLaunch() {
  const params = new URLSearchParams(window.location.search);
  return { google: params.get("google"), replay: params.has("onboarding"), checkout: params.get("checkout"), sessionId: params.get("session_id"), planId: params.get("plan_id"), checkoutId: params.get("checkout_id") };
}
function readCart() { try { return JSON.parse(localStorage.getItem("esper.cart.v1")) || {}; } catch { return {}; } }
function readCheckout() { try { const value = JSON.parse(sessionStorage.getItem("esper.checkout.v1")); return value?.mock === true && typeof value.id === "string" && Array.isArray(value.itemIds) ? value : null; } catch { return null; } }
function stamp(plan) { return { ...plan, items: (plan.items || []).map((item) => ({ ...item, planId: plan.id })) }; }

export default function App() {
  const [launch] = useState(readLaunch);
  const [me, setMe] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [initialStart, setInitialStart] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const fallback = window.setTimeout(() => { if (!cancelled) setOnboarding(false); }, 3200);
    getMe().then((body) => { window.clearTimeout(fallback); if (cancelled) return; setMe(body); setOnboarding(!launch.checkout && (launch.replay || !body.profile?.completedAt)); }).catch(() => { window.clearTimeout(fallback); if (!cancelled) setOnboarding(false); });
    const params = new URLSearchParams(window.location.search);
    ["google", "onboarding", "checkout", "session_id", "plan_id", "checkout_id"].forEach((key) => params.delete(key));
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
    return () => { cancelled = true; window.clearTimeout(fallback); };
  }, [launch]);
  if (onboarding === null) return <main className="onb-boot" aria-busy="true"><p className="sr-only">Loading ESPER…</p></main>;
  if (onboarding) return <Onboarding me={me || { google: {}, user: null }} googleStatus={launch.google} onFinish={(start) => { setInitialStart(start); setOnboarding(false); }} />;
  return <><Planner initialStart={initialStart} launch={launch} /><AccountChip me={me} /></>;
}

function Planner({ initialStart, launch }) {
  const [category, setCategory] = useState(initialStart?.category || "custom");
  const [prompt, setPrompt] = useState(initialStart?.prompt || "");
  const [plans, setPlans] = useState([]);
  const [marks, setMarks] = useState(readCart);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [focusId, setFocusId] = useState(null);
  const [trustFloor, setTrustFloor] = useState(0.5);
  const [checkout, setCheckout] = useState(readCheckout);
  const [receipt, setReceipt] = useState(null);
  const [voice, setVoice] = useState(false);
  const [liveStatus, setLiveStatus] = useState("idle");
  const [caption, setCaption] = useState("");
  const [voiceCompare, setVoiceCompare] = useState(null);
  const live = useRef(null);
  const initialStarted = useRef(false);
  const plansRef = useRef(plans); plansRef.current = plans;

  function updatePlan(plan) {
    if (!plan?.id) return;
    setPlans((current) => current.some((row) => row.id === plan.id) ? current.map((row) => row.id === plan.id ? stamp(plan) : row) : [...current, stamp(plan)]);
  }
  useEffect(() => {
    getPlans().then((body) => setPlans((current) => [...new Map([...(body.plans || []).slice().reverse().map(stamp), ...current].map((plan) => [plan.id, plan])).values()])).catch((err) => setError(`Could not restore your lists: ${err.message}`));
    voiceAvailable().then(setVoice);
  }, []);
  useEffect(() => { try { localStorage.setItem("esper.cart.v1", JSON.stringify(marks)); } catch { /* Storage may be disabled. */ } }, [marks]);
  useEffect(() => { try { if (checkout) sessionStorage.setItem("esper.checkout.v1", JSON.stringify(checkout)); else sessionStorage.removeItem("esper.checkout.v1"); } catch { /* Keep the active checkout usable when storage is disabled. */ } }, [checkout]);
  useEffect(() => {
    if (!initialStart || initialStarted.current) return;
    initialStarted.current = true; buildPlan(initialStart.prompt, initialStart.category);
  }, [initialStart]);
  useEffect(() => {
    if (!launch.checkout) return;
    const promise = launch.checkout === "success" ? confirmCheckout(launch.sessionId || "").then((result) => { setReceipt(result.receipt || null); setNotice(result.status === "paid" ? "Payment confirmed. Your list is updated." : "Payment is awaiting confirmation."); return result.plan; }) : (launch.checkoutId ? cancelCheckout(launch.checkoutId) : getPlan(launch.planId || "").then((plan) => ({ plan, status: "cancelled" }))).then((result) => { setNotice(result.status === "paid" ? "Payment was already confirmed. Your list is updated." : "Checkout cancelled. Your items are still in the cart."); if (result.receipt) setReceipt(result.receipt); return result.plan; });
    promise.then(updatePlan).catch((err) => setError(err.message));
  }, [launch]);
  const pricingIds = plans.filter((plan) => plan.status === "pricing").map((plan) => plan.id).join(",");
  useEffect(() => {
    if (!pricingIds) return;
    let cancelled = false;
    const timer = setInterval(() => { Promise.all(pricingIds.split(",").map(getPlan)).then((rows) => { if (!cancelled) rows.forEach(updatePlan); }).catch((err) => { if (!cancelled) setError(`Could not refresh store prices: ${err.message}`); }); }, 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pricingIds]);

  if (!live.current) live.current = createLive({ onStatus: setLiveStatus, onCaption: setCaption, onError: setCaption, onUi: applyVoice });
  useEffect(() => () => live.current?.stop(), []);
  useEffect(() => { live.current?.setPlanId(plans.at(-1)?.id || null); }, [plans.at(-1)?.id]);
  useEffect(() => { live.current?.setTrustFloor(trustFloor); }, [trustFloor]);
  async function applyVoice({ action, payload, item_id: itemId }) {
    try {
      if (action === "PLAN" && payload?.id) { updatePlan(await getPlan(payload.id)); setStatus("idle"); }
      if (action === "COMPARE" && payload) { setVoiceCompare({ itemId, result: payload }); setFocusId(itemId); }
      if (action === "TRUST_FLOOR" && typeof payload?.trust_floor === "number") setTrustFloor(payload.trust_floor);
      if (action === "SHORTLIST" && itemId) setFocusId(itemId);
    } catch (err) { setError(err.message); }
  }
  async function buildPlan(text, planCategory = category) {
    if (!text?.trim()) return;
    setStatus("loading"); setError("");
    try { updatePlan(await createPlan(text.trim(), planCategory)); setPrompt(""); }
    catch (err) { setError(err.message); }
    finally { setStatus("idle"); }
  }
  function find(item) { return plansRef.current.find((plan) => plan.id === item.planId || plan.items.some((row) => row.id === item.id)); }
  async function onToggle(item) {
    const plan = find(item); if (!plan) return;
    try { updatePlan(await setPurchased(plan.id, item.id, !item.purchased)); clearCart(item.id); }
    catch (err) { setError(err.message); }
  }
  async function onOwn(item) {
    const plan = find(item); if (!plan) return;
    try { updatePlan(await updateItem(plan.id, item.id, { owned: !item.owned })); clearCart(item.id); }
    catch (err) { setError(err.message); }
  }
  function clearCart(itemId) { setMarks((current) => { const next = { ...current }; delete next[itemId]; return next; }); }
  async function onAdd(item, product) {
    const plan = find(item); if (!plan) return;
    try {
      updatePlan(await chooseListing(plan.id, item.id, product.id));
      setMarks((current) => ({ ...current, [item.id]: "cart" }));
      setNotice(`${item.name} added to your cart.`);
    } catch (err) { setError(err.message); throw err; }
  }
  async function onCheckout(planId, itemIds) {
    setError(""); setReceipt(null);
    const session = await startCheckout(planId, itemIds);
    if (session.mock) setCheckout({ ...session, itemIds });
    else if (session.url) window.location.assign(session.url);
    else throw new Error("Checkout did not return a payment destination.");
  }
  async function onCancelOrder() {
    if (!checkout) return;
    try { const result = await cancelCheckout(checkout.id); updatePlan(result.plan); if (result.receipt) setReceipt(result.receipt); setCheckout(null); setNotice(result.status === "paid" ? "This order was already confirmed." : "Checkout cancelled. Your cart is ready to edit."); }
    catch (err) { setError(err.message); }
  }
  async function onPlaceOrder() {
    if (!checkout) return;
    try {
      const result = await confirmCheckout(checkout.id); updatePlan(result.plan);
      if (result.status !== "paid") { setNotice(result.status === "cancelled" ? "Checkout was cancelled. Your cart is ready to edit." : "Payment has not been confirmed yet."); if (result.status === "cancelled") setCheckout(null); return; }
      setReceipt(result.receipt || null); checkout.itemIds.forEach(clearCart); setCheckout(null); setNotice("Mock order recorded. No card was charged.");
    } catch (err) { setError(err.message); }
  }
  return <PlannerUI tabs={TABS} category={category} prompt={prompt} plans={plans} marks={marks} status={status} error={error} notice={notice} focusId={focusId}
    onPromptChange={setPrompt} onPlan={(event) => { event.preventDefault(); buildPlan(prompt); }}
    onCategory={(id) => { const tab = TABS.find((row) => row.id === id); setCategory(id); setPrompt(tab?.prompt || ""); }}
    onToggle={onToggle} onOwn={onOwn} onAdd={onAdd} onInspect={setFocusId} onRemove={clearCart}
    trustFloor={trustFloor} onTrustFloor={setTrustFloor} voiceCompare={voiceCompare}
    onCheckout={onCheckout} checkout={checkout} receipt={receipt} onPlaceOrder={onPlaceOrder} onCancelOrder={onCancelOrder} onDismissReceipt={() => setReceipt(null)}
    voice={voice} liveStatus={liveStatus} caption={caption} onTalk={() => { if (["idle", "error"].includes(live.current.status)) live.current.start().catch((err) => setCaption(err.message)); else live.current.stop(); }}
    onPlanProduct={(product) => { setCategory("custom"); setPrompt(`Find ${product.title} from ${product.brand}`); setNotice("The product is ready in your plan prompt. Build the list to find matching offers."); window.scrollTo({ top: 0, behavior: "smooth" }); }} />;
}
