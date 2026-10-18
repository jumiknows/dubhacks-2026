import { useState } from "react";
import { createPlan, setPurchased } from "./api.js";
import PlannerUI from "./ui/PlannerUI.jsx";
import { TONES } from "./ui/shopState.js";

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [plans, setPlans] = useState([]);
  const [marks, setMarks] = useState({});
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [focusId, setFocusId] = useState(null);

  async function onPlan(event) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;

    setStatus("loading");
    setError("");
    try {
      const next = await createPlan(text);
      const stamped = {
        ...next,
        items: (next.items || []).map((item) => ({ ...item, planId: next.id })),
      };
      setPlans((current) => [...current, stamped]);
      setPrompt("");
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(err.message);
    }
  }

  function onMark(itemId, tone) {
    setMarks((current) => ({ ...current, [itemId]: tone }));
    if (tone === TONES.purchased) {
      const found = findItem(plans, itemId);
      if (found && !found.item.purchased) patchPurchased(found.plan, found.item, true);
    }
  }

  async function onToggle(item) {
    const found = findItem(plans, item.id);
    if (!found) return;
    setError("");
    try {
      await patchPurchased(found.plan, item, !item.purchased);
      setMarks((current) => ({
        ...current,
        [item.id]: item.purchased ? TONES.needed : TONES.purchased,
      }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function patchPurchased(plan, item, purchased) {
    const updated = await setPurchased(plan.id, item.id, purchased);
    setPlans((current) => current.map((row) => (row.id === updated.id ? stamp(updated) : row)));
  }

  return (
    <PlannerUI
      prompt={prompt}
      plans={plans}
      marks={marks}
      status={status}
      error={error}
      focusId={focusId}
      onPromptChange={setPrompt}
      onPlan={onPlan}
      onToggle={onToggle}
      onMark={onMark}
      onInspect={setFocusId}
    />
  );
}

function stamp(plan) {
  return {
    ...plan,
    items: (plan.items || []).map((item) => ({ ...item, planId: plan.id })),
  };
}

function findItem(plans, itemId) {
  for (const plan of plans) {
    const item = plan.items.find((row) => row.id === itemId);
    if (item) return { plan, item };
  }
  return null;
}
