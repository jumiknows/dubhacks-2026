import { useEffect, useState } from "react";
import { compareItems, createPlan, setPurchased } from "./api.js";
import PlannerUI from "./ui/PlannerUI.jsx";

const TABS = [
  { id: "groceries", label: "Groceries", prompt: "Weekly groceries for two people" },
  { id: "wedding", label: "Wedding", prompt: "I need to plan a small outdoor wedding." },
  { id: "camping", label: "Camping", prompt: "I need to prepare for camping." },
  { id: "custom", label: "Custom", prompt: "" },
];

export default function App() {
  const [category, setCategory] = useState("camping");
  const [prompt, setPrompt] = useState(TABS[2].prompt);
  const [plan, setPlan] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [trustFloor, setTrustFloor] = useState(0.5);
  const [selected, setSelected] = useState({});
  const [compareItemId, setCompareItemId] = useState(null);
  const [compare, setCompare] = useState(null);

  function onSelectCategory(id) {
    const tab = TABS.find((item) => item.id === id);
    setCategory(id);
    setPrompt(tab ? tab.prompt : "");
    setPlan(null);
    setError("");
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

  function onConfirmPick(listing) {
    if (!plan || !compareItemId) return;
    setPlan({
      ...plan,
      items: plan.items.map((item) => {
        if (item.id !== compareItemId) return item;
        const quantity = item.quantity > 0 ? item.quantity : 1;
        const total = typeof listing.price === "number" ? Math.round(listing.price * quantity * 100) / 100 : null;
        return {
          ...item,
          synthesis: {
            ...item.synthesis,
            summary: `${listing.title} from ${listing.store}`,
            image: listing.image,
            dimensions: listing.dimensions,
            totalPrice: total,
            currency: listing.currency || "USD",
            best: listing,
          },
        };
      }),
    });
  }

  return (
    <PlannerUI
      tabs={TABS}
      category={category}
      prompt={prompt}
      plan={plan}
      status={status}
      error={error}
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
