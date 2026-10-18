import { useState } from "react";
import { createPlan, setPurchased } from "./api.js";
import PlannerUI from "./ui/PlannerUI.jsx";

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  async function onPlan(event) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;

    setStatus("loading");
    setError("");
    try {
      setPlan(await createPlan(text));
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

  return (
    <PlannerUI
      prompt={prompt}
      plan={plan}
      status={status}
      error={error}
      onPromptChange={setPrompt}
      onPlan={onPlan}
      onToggle={onToggle}
    />
  );
}
