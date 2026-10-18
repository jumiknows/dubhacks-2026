import { useState } from "react";
import { createPlan, setPurchased } from "./api.js";
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

  function onSelectCategory(id) {
    const tab = TABS.find((item) => item.id === id);
    setCategory(id);
    setPrompt(tab ? tab.prompt : "");
    setPlan(null);
    setError("");
    setStatus("idle");
  }

  async function onPlan(event) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;

    setStatus("loading");
    setError("");
    try {
      setPlan(await createPlan(text, category));
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
      tabs={TABS}
      category={category}
      prompt={prompt}
      plan={plan}
      status={status}
      error={error}
      onSelectCategory={onSelectCategory}
      onPromptChange={setPrompt}
      onPlan={onPlan}
      onToggle={onToggle}
    />
  );
}
