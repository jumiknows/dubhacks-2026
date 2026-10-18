import { useEffect, useState } from "react";
import { chooseListing, compareItems, confirmCheckout, createPlan, getPlan, setPurchased, startCheckout } from "./api.js";
import PlannerUI from "./ui/PlannerUI.jsx";

const TABS = [
  { id: "groceries", label: "Groceries", prompt: "Weekly groceries for two people" },
  { id: "wedding", label: "Wedding", prompt: "I need to plan a small outdoor wedding." },
  { id: "camping", label: "Camping", prompt: "I need to prepare for camping." },
  { id: "electronics", label: "Electronics", prompt: "Keep my laptop, phone, and headphones current." },
  { id: "custom", label: "Custom", prompt: "" },
];

export default function App() {
  const [category, setCategory] = useState("groceries");
  const [prompt, setPrompt] = useState(TABS[0].prompt);
  const [plan, setPlan] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [trustFloor, setTrustFloor] = useState(0.5);
  const [selected, setSelected] = useState({});
  const [compareItemId, setCompareItemId] = useState(null);
  const [compare, setCompare] = useState(null);
  const [notice, setNotice] = useState("");
  const [mockCheckout, setMockCheckout] = useState(null);
  const [receipt, setReceipt] = useState(null);

  // Stripe sends the shopper back here. The plan lives on the server, so reload it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("checkout");
    if (!outcome) return;
    window.history.replaceState(window.history.state, "", window.location.pathname);

    const load =
      outcome === "success"
        ? confirmCheckout(params.get("session_id") || "").then((result) => {
            if (result.receipt) setReceipt(result.receipt);
            else if (result.status === "paid") setNotice("Payment received. Those items are now bought.");
            else {
              setNotice("Stripe has not confirmed this payment yet.");
            }
            return result.plan;
          })
        : getPlan(params.get("plan_id") || "").then((restored) => {
            setNotice("Checkout cancelled. Nothing was charged.");
            return restored;
          });

    load
      .then((restored) => {
        if (!restored) return;
        setCategory(TABS.some((tab) => tab.id === restored.category) ? restored.category : "custom");
        setPrompt(restored.prompt);
        setPlan(restored);
      })
      .catch((err) => setError(err.message));
  }, []);

  function onSelectCategory(id) {
    const tab = TABS.find((item) => item.id === id);
    setCategory(id);
    setPrompt(tab ? tab.prompt : "");
    setPlan(null);
    setError("");
    setNotice("");
    setMockCheckout(null);
    setReceipt(null);
    setStatus("idle");
    setSelected({});
    setCompare(null);
    setCompareItemId(null);
  }

  async function onPlan(event) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;

    setStatus("loading");
    setError("");
    try {
      setPlan(await createPlan(text, category));
      setSelected({});
      setCompare(null);
      setCompareItemId(null);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(err.message);
    }
  }

  async function onToggle(item) {
    if (!plan) return;
    setError("");
    try {
      setPlan(await setPurchased(plan.id, item.id, !item.purchased));
    } catch (err) {
      setError(err.message);
    }
  }

  function onToggleListing(item, product) {
    setSelected((current) => {
      const ids = current[item.id] || [];
      const nextIds = ids.includes(product.id)
        ? ids.filter((id) => id !== product.id)
        : [...ids, product.id].slice(-2);
      return { ...current, [item.id]: nextIds };
    });
    setCompareItemId(item.id);
  }

  useEffect(() => {
    if (!plan || !compareItemId) return;
    const item = plan.items.find((row) => row.id === compareItemId);
    const ids = selected[compareItemId] || [];
    if (!item || ids.length !== 2) {
      setCompare(null);
      return;
    }
    const left = (item.products || []).find((row) => row.id === ids[0]);
    const right = (item.products || []).find((row) => row.id === ids[1]);
    if (!left || !right) return;
    let cancelled = false;
    compareItems(toValued(left), toValued(right), trustFloor)
      .then((result) => {
        if (!cancelled) setCompare(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [plan, selected, compareItemId, trustFloor]);

  // Saved on the server so checkout charges the listing the shopper picked.
  async function onConfirmPick(listing) {
    if (!plan || !compareItemId) return;
    setError("");
    try {
      setPlan(await chooseListing(plan.id, compareItemId, listing.id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function onCheckout(itemIds) {
    if (!plan) return;
    setError("");
    setNotice("");
    setReceipt(null);
    try {
      const session = await startCheckout(plan.id, itemIds);
      // No Stripe key on the server: review and place a demo order in place.
      if (session.mock) setMockCheckout({ ...session, itemIds });
      else window.location.assign(session.url);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onPlaceMockOrder() {
    if (!mockCheckout) return;
    setError("");
    try {
      const result = await confirmCheckout(mockCheckout.id);
      setPlan(result.plan);
      setReceipt(result.receipt);
      setMockCheckout(null);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <PlannerUI
      tabs={TABS}
      category={category}
      prompt={prompt}
      plan={plan}
      status={status}
      error={error}
      notice={notice}
      trustFloor={trustFloor}
      compare={compare}
      selected={selected}
      onSelectCategory={onSelectCategory}
      onPromptChange={setPrompt}
      onPlan={onPlan}
      onToggle={onToggle}
      onTrustFloor={setTrustFloor}
      onToggleListing={onToggleListing}
      onConfirmPick={onConfirmPick}
      onCheckout={onCheckout}
      mockCheckout={mockCheckout}
      receipt={receipt}
      onPlaceMockOrder={onPlaceMockOrder}
      onCancelMockOrder={() => setMockCheckout(null)}
      onDismissReceipt={() => setReceipt(null)}
    />
  );
}

function toValued(product) {
  return {
    id: product.id,
    title: product.title,
    store: product.store,
    url: product.url,
    price: product.price,
    in_stock: product.in_stock ?? product.inStock ?? true,
    bang_per_buck: product.bang_per_buck ?? 0.5,
    relevancy: product.relevancy ?? 1,
    trust: product.trust ?? 0.5,
    flags: product.flags || [],
    brand: product.brand,
    specs: product.specs || {},
    marketplace: product.marketplace,
    history: product.history,
    condition: product.condition || "new",
    rating: product.rating,
    review_count: product.review_count ?? product.reviewCount ?? 0,
    prime: product.prime || false,
    shipping_days: product.shipping_days ?? product.shippingDays,
    image: product.image,
    currency: product.currency || "USD",
    asin: product.asin,
    walmart_id: product.walmart_id,
    dimensions: product.dimensions,
    seller: product.seller,
  };
}
