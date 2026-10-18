import { Hints, useGestureStatus } from "conjure-gestures";
import { useState } from "react";
import ShopBoard from "./ShopBoard.jsx";
import ItemHistory from "./ItemHistory.jsx";
import WeeklyList from "./WeeklyList.jsx";
import ElectronicsPlan from "./ElectronicsPlan.jsx";
import OfferInspector from "../integration/OfferInspector.jsx";
import IntegratedCart from "../integration/IntegratedCart.jsx";
import AssistantPanel from "../integration/AssistantPanel.jsx";
import EvidencePanel from "../integration/EvidencePanel.jsx";

export default function PlannerUI(props) {
  const { tabs, category, prompt, plans, marks, status, error, notice, focusId, onPromptChange, onPlan, onCategory, onToggle, onOwn, onAdd, onInspect, trustFloor, onTrustFloor, voiceCompare, voice, liveStatus, caption, onTalk, onPlanProduct } = props;
  const [view, setView] = useState("plans");
  const [sample, setSample] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const latest = plans.at(-1);
  const loading = status === "loading";
  return <main className="shell esper-app" data-hue={category === "custom" ? latest?.category || "home" : category}>
    <div className="glow" aria-hidden="true"><span className="glow-core" /><span className="glow-ring" /><span className="glow-ring" /><span className="glow-ring" /></div>
    <section className="home">
      <header className="esper-intro"><p className="eyebrow">ESPER</p><h1>Be ready for what’s next.</h1><p className="lede">Turn a plan into a shopping list. Compare the evidence, choose your offers, and check out when you’re ready.</p></header>
      <div className="esper-category" aria-label="Plan categories">{tabs.map((tab) => <button key={tab.id} type="button" aria-pressed={category === tab.id} onClick={() => { onCategory(tab.id); setView("plans"); }}>{tab.label}</button>)}</div>
      <form className="prompt" onSubmit={(event) => { setView("plans"); onPlan(event); }}><label className="sr-only" htmlFor="plan-prompt">Plan prompt</label><input id="plan-prompt" value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="Camping trip, weekly groceries, a new laptop…" /><button type="submit" disabled={loading || !prompt.trim()}>{loading ? "Planning…" : "Build list"}</button></form>
      <div className="esper-input-tools"><HandToggle onStart={() => setShowHints(true)} />{voice ? <button type="button" className={`esper-voice is-${liveStatus}`} onClick={onTalk} aria-pressed={!["idle", "error"].includes(liveStatus)}>{liveStatus === "idle" || liveStatus === "error" ? "Talk to ESPER" : liveStatus === "connecting" ? "Connecting… · Stop" : `${liveStatus[0].toUpperCase()}${liveStatus.slice(1)} · Stop voice`}</button> : <span className="esper-note">Voice is available when a Gemini Live key is configured.</span>}</div>
      {caption ? <p className="esper-caption" aria-live="polite">{caption}</p> : null}
      {error ? <p className="banner" role="alert">{error}</p> : null}
      {notice ? <p className="esper-notice" role="status">{notice}</p> : null}
      <nav className="esper-nav" aria-label="Workspace"><button type="button" aria-current={view === "plans" ? "page" : undefined} onClick={() => setView("plans")}>My plans <span>{plans.length}</span></button><button type="button" aria-current={view === "assistant" ? "page" : undefined} onClick={() => setView("assistant")}>Shopping assistant</button><button type="button" aria-current={view === "evidence" ? "page" : undefined} onClick={() => setView("evidence")}>Reviews & website safety</button></nav>
      <div className="esper-workspace">
        <div className="esper-main-column">
          <div hidden={view !== "plans"} inert={view !== "plans" ? "" : undefined}>
            <header className="esper-section-head"><div><h2>Your plans</h2><p className="esper-note">Every query stays in your list. Open a plan to browse its items.</p></div><button type="button" className="esper-quiet-button" onClick={() => setHistoryOpen((value) => !value)} aria-expanded={historyOpen}>Item history</button></header>
            {!plans.length ? <div className="esper-empty esper-welcome"><p>Your next plan starts here.</p><p>Describe an occasion above, or choose a category to get started.</p></div> : null}
            <ShopBoard plans={plans} marks={marks} focusId={focusId} onToggle={onToggle} onInspect={onInspect} onAddListing={onAdd} renderInspector={(details) => <OfferInspector key={details.item.id} {...details} onOwn={() => onOwn(details.item)} onBought={() => onToggle(details.item)} onAdd={onAdd} trustFloor={trustFloor} onTrustFloor={onTrustFloor} voiceCompare={voiceCompare} />} />
            {historyOpen ? <div className="esper-history">{plans.length ? plans.map((plan) => <ItemHistory key={plan.id} plan={plan} selectedId={focusId} onSelect={onInspect} />) : <ItemHistory />}</div> : null}
            {category === "groceries" || category === "electronics" ? <section className="esper-sample"><button type="button" className="esper-quiet-button" onClick={() => setSample((value) => !value)} aria-expanded={sample}>{sample ? "Hide" : "Explore"} {category === "groceries" ? "meal & nutrition" : "device health"} sample</button>{sample ? <><p className="esper-note">Illustrative sample data for exploring planning tools.</p><div className="esper-sample-stage">{category === "groceries" ? <WeeklyList onBack={() => setSample(false)} /> : <ElectronicsPlan onBack={() => setSample(false)} />}</div></> : null}</section> : null}
            <p className="esper-note esper-gesture-help">Hands: spread both hands to open a group, bring them together to close it, or hold an offer for two seconds to add it to your cart. Every action also works with a mouse or keyboard.</p>
          </div>
          <div hidden={view !== "assistant"} inert={view !== "assistant" ? "" : undefined}><AssistantPanel onPlanProduct={(product) => { onPlanProduct(product); setView("plans"); }} /></div>
          <div hidden={view !== "evidence"} inert={view !== "evidence" ? "" : undefined}><EvidencePanel /></div>
        </div>
        <IntegratedCart {...props} />
      </div>
      <footer className="esper-footer"><a href="/?onboarding">Preferences & setup</a><a href="/gesture-lab">Gesture lab & assessment ↗</a></footer>
    </section>{showHints ? <Hints onDone={() => setShowHints(false)} /> : null}
  </main>;
}
function HandToggle({ onStart }) {
  const { camera, start, stop, error } = useGestureStatus();
  const on = camera === "on";
  return <button type="button" className="hand-toggle" data-gesture-ignore disabled={camera === "starting"} title={error || undefined} onClick={() => { if (on) stop(); else { onStart(); start(); } }}>{on ? "Hands on · Stop camera" : camera === "starting" ? "Starting camera…" : "Use hands"}</button>;
}
