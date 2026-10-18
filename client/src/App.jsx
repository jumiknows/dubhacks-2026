import { useEffect, useState } from "react";
import { createPlan, getMe, setPurchased } from "./api.js";
import AccountChip from "./onboarding/AccountChip.jsx";
import Onboarding from "./onboarding/Onboarding.jsx";
import PlannerUI from "./ui/PlannerUI.jsx";

const TABS = [
  { id: "groceries", label: "Groceries", prompt: "Weekly groceries for two people" },
  { id: "wedding", label: "Wedding", prompt: "I need to plan a small outdoor wedding." },
  { id: "camping", label: "Camping", prompt: "I need to prepare for camping." },
  { id: "electronics", label: "Electronics", prompt: "Keep my laptop, phone, and headphones current." },
  { id: "custom", label: "Custom", prompt: "" },
];

/** ?google=connected|denied|expired|error after the Google redirect; ?onboarding replays setup. */
function readLaunchParams() {
  const params = new URLSearchParams(window.location.search);
  const google = params.get("google");
  const replay = params.has("onboarding");
  if (google || replay) window.history.replaceState(null, "", window.location.pathname);
  return { google, replay };
}

export default function App() {
  const [launch] = useState(readLaunchParams);
  const [me, setMe] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [initialStart, setInitialStart] = useState(null);

  useEffect(() => {
    // If the server is down or slow, open the planner rather than a blank screen.
    let settled = false;
    const fallback = window.setTimeout(() => {
      if (!settled) setOnboarding(false);
    }, 3000);
    getMe()
      .then((body) => {
        setMe(body);
        setOnboarding((current) => (current === false && !launch.replay ? false : launch.replay || !body.profile?.completedAt));
      })
      .catch(() => setOnboarding(false))
      .finally(() => {
        settled = true;
        window.clearTimeout(fallback);
      });
    return () => window.clearTimeout(fallback);
  }, [launch]);

  if (onboarding === null) return <main className="onb-boot" aria-busy="true" />;
  if (onboarding) {
    return (
      <Onboarding
        me={me}
        googleStatus={launch.google}
        onFinish={(start) => {
          setInitialStart(start);
          setOnboarding(false);
        }}
      />
    );
  }
  return (
    <>
      <Planner initialStart={initialStart} />
      <AccountChip me={me} />
    </>
  );
}

function Planner({ initialStart }) {
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

  // A calendar suggestion picked during onboarding starts that plan right away.
  useEffect(() => {
    if (!initialStart) return;
    setCategory(initialStart.category);
    setPrompt(initialStart.prompt);
    buildPlan(initialStart.prompt, initialStart.category);
    // Run once, for the suggestion the planner opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onPlan(event) {
    event.preventDefault();
    buildPlan(prompt.trim(), category);
  }

  async function buildPlan(text, planCategory) {
    if (!text) return;

    setStatus("loading");
    setError("");
    try {
      setPlan(await createPlan(text, planCategory));
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
