import { useEffect, useState } from "react";
import { getCalendarSuggestions, GOOGLE_SIGN_IN_URL, saveProfile } from "../legacy-api.js";
import { useNav } from "./navInput.js";
import "./onboarding.css";

/*
 * First-run setup: connect Google Calendar, answer three questions, then
 * optionally start a plan for something already on the calendar.
 * Each question also teaches one hand gesture (see gesture_plan.md).
 */

const QUESTIONS = [
  {
    key: "focus",
    title: "What do you plan for most?",
    lesson: { action: "move", name: "Move", hand: "Point your index finger and turn your wrist up or down. Each turn moves one choice.", keys: "↑ ↓" },
    options: [
      { value: "groceries", label: "Groceries", detail: "Weekly food runs" },
      { value: "outdoors", label: "Outdoors", detail: "Camping, hikes, trips" },
      { value: "events", label: "Events", detail: "Weddings, parties, holidays" },
      { value: "tech", label: "Tech", detail: "Devices and upgrades" },
    ],
  },
  {
    key: "priority",
    title: "When you buy, what matters most?",
    lesson: { action: "select", name: "Choose", hand: "Close your whole fist to grab a choice. Open your hand to confirm it.", keys: "Enter" },
    options: [
      { value: "price", label: "Lowest price", detail: "Cheapest listing in stock" },
      { value: "speed", label: "Fast shipping", detail: "Whatever arrives first" },
      { value: "trusted", label: "Trusted stores", detail: "Major retailers over marketplace sellers" },
    ],
  },
  {
    key: "budget",
    title: "What does a typical plan cost you?",
    lesson: { action: "page", name: "Continue and go back", hand: "Turn your wrist left to continue. Turn it right to go back a step.", keys: "→ ←" },
    options: [
      { value: "under-100", label: "Under $100" },
      { value: "100-300", label: "$100 to $300" },
      { value: "300-plus", label: "$300 or more" },
      { value: null, label: "Not sure" },
    ],
  },
];

const LESSON_FOR = { up: "move", down: "move", select: "select", next: "page", back: "page" };

export default function Onboarding({ me, googleStatus, onFinish }) {
  const connected = Boolean(me.user);
  const [step, setStep] = useState(connected ? 1 : 0); // 0 welcome, 1..3 questions, 4 calendar
  const [answers, setAnswers] = useState({ focus: null, priority: null, budget: null });
  const [answered, setAnswered] = useState({});
  const [highlight, setHighlight] = useState(0);
  const [learned, setLearned] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const question = step >= 1 && step <= 3 ? QUESTIONS[step - 1] : null;

  useEffect(() => {
    if (!question) return;
    const chosen = question.options.findIndex((option) => option.value === answers[question.key]);
    setHighlight(answered[question.key] && chosen >= 0 ? chosen : 0);
    // Reset the highlight only when the question changes.
  }, [step]);

  async function finishQuestions(finalAnswers) {
    setSaving(true);
    setError("");
    try {
      await saveProfile(finalAnswers);
      if (connected && me.google.calendar) setStep(4);
      else onFinish(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function choose(index) {
    if (!question || saving) return;
    const option = question.options[index];
    const next = { ...answers, [question.key]: option.value };
    setHighlight(index);
    setAnswers(next);
    setAnswered((value) => ({ ...value, [question.key]: true }));
    window.setTimeout(() => {
      if (step === 3) finishQuestions(next);
      else setStep(step + 1);
    }, 280);
  }

  function skipSetup() {
    finishQuestions(answers);
  }

  useNav((action, source) => {
    if (source === "hand" && LESSON_FOR[action]) setLearned((value) => ({ ...value, [LESSON_FOR[action]]: true }));
    if (step === 0) {
      if (action === "next" || action === "select") start();
      return;
    }
    if (!question) return;
    if (action === "up") setHighlight((index) => Math.max(0, index - 1));
    if (action === "down") setHighlight((index) => Math.min(question.options.length - 1, index + 1));
    if (action === "select") choose(highlight);
    if (action === "next") {
      if (answered[question.key]) {
        if (step === 3) finishQuestions(answers);
        else setStep(step + 1);
      } else choose(highlight);
    }
    if (action === "back") setStep((value) => Math.max(connected ? 1 : 0, value - 1));
  });

  function start() {
    setStep(1);
  }

  return (
    <main className="onb">
      <div className="onb-glow" aria-hidden="true" />
      <header className="onb-top">
        <p className="eyebrow">ESPER</p>
        {step >= 1 && step <= 3 ? (
          <button type="button" className="onb-link" onClick={skipSetup} disabled={saving}>Skip setup</button>
        ) : null}
      </header>

      {step === 0 ? (
        <Welcome me={me} googleStatus={googleStatus} onStart={start} />
      ) : null}

      {question ? (
        <section className="onb-card" key={question.key} aria-labelledby="onb-question">
          <Progress step={step} />
          {connected && step === 1 ? (
            <p className="onb-note">Connected as {me.user.name || me.user.email}. Calendar suggestions are on.</p>
          ) : null}
          <h1 id="onb-question">{question.title}</h1>
          <div className="onb-options" role="radiogroup" aria-labelledby="onb-question">
            {question.options.map((option, index) => {
              const chosen = answered[question.key] && answers[question.key] === option.value;
              return (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  data-nav-option
                  className={`onb-option${index === highlight ? " is-highlight" : ""}${chosen ? " is-chosen" : ""}`}
                  onMouseEnter={() => setHighlight(index)}
                  onFocus={() => setHighlight(index)}
                  onClick={() => choose(index)}
                >
                  <span className="onb-option-label">{option.label}</span>
                  {option.detail ? <span className="onb-option-detail">{option.detail}</span> : null}
                  <span className="onb-check" aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <Lesson lesson={question.lesson} learned={learned[question.lesson.action]} />
          {error ? <p className="onb-error" role="alert">{error}</p> : null}
        </section>
      ) : null}

      {step === 4 ? <Upcoming onFinish={onFinish} /> : null}
    </main>
  );
}

function Welcome({ me, googleStatus, onStart }) {
  const message = {
    denied: "Google access was not granted. You can try again or continue without it.",
    expired: "That sign-in took too long. Try again.",
    error: "Google sign-in did not finish. Try again or continue without it.",
  }[googleStatus];

  return (
    <section className="onb-card onb-welcome" aria-labelledby="onb-welcome">
      <h1 id="onb-welcome">Let's get you set up</h1>
      <p className="onb-lede">
        Connect your calendar and we will have lists ready before your plans. Then three quick questions, answered with
        your hands.
      </p>
      {message ? <p className="onb-error" role="alert">{message}</p> : null}
      {me.google.available ? (
        <>
          <a className="onb-google" href={GOOGLE_SIGN_IN_URL}>
            <GoogleMark />
            Continue with Google
          </a>
          <p className="onb-fine">
            We read only the titles and dates of upcoming events to suggest lists. We never read your email, and you can
            disconnect any time.
          </p>
          <button type="button" className="onb-link" onClick={onStart}>Skip, just the questions</button>
        </>
      ) : (
        <button type="button" className="onb-primary" onClick={onStart}>Get started</button>
      )}
    </section>
  );
}

function Progress({ step }) {
  return (
    <ol className="onb-progress" aria-label={`Question ${step} of 3`}>
      {[1, 2, 3].map((index) => (
        <li key={index} className={index < step ? "is-done" : index === step ? "is-current" : ""} />
      ))}
    </ol>
  );
}

function Lesson({ lesson, learned }) {
  return (
    <aside className={`onb-lesson${learned ? " is-learned" : ""}`} aria-label={`Gesture: ${lesson.name}`}>
      <HandIcon action={lesson.action} />
      <div>
        <p className="onb-lesson-name">
          {lesson.name}
          {learned ? <span className="onb-lesson-done">Got it</span> : null}
        </p>
        <p className="onb-lesson-text">{lesson.hand}</p>
        <p className="onb-lesson-keys">No camera? Use {lesson.keys} or tap.</p>
      </div>
    </aside>
  );
}

function Upcoming({ onFinish }) {
  const [state, setState] = useState({ status: "loading", suggestions: [] });
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    getCalendarSuggestions()
      .then((body) => setState({ status: "ready", suggestions: body.suggestions || [] }))
      .catch((err) => setState({ status: "error", suggestions: [], message: err.message }));
  }, []);

  const list = state.suggestions;
  useNav((action) => {
    if (action === "up") setHighlight((index) => Math.max(0, index - 1));
    if (action === "down") setHighlight((index) => Math.min(list.length, index + 1));
    if (action === "select" || action === "next") {
      const pick = list[highlight];
      onFinish(pick ? { prompt: pick.prompt, category: pick.category } : null);
    }
    if (action === "back") onFinish(null);
  });

  return (
    <section className="onb-card" aria-labelledby="onb-upcoming">
      <p className="onb-step-label">Your calendar</p>
      <h1 id="onb-upcoming">{list.length ? "Coming up" : "You're all set"}</h1>
      {state.status === "loading" ? <p className="onb-lede">Checking your calendar…</p> : null}
      {state.status === "error" ? <p className="onb-error" role="alert">{state.message}</p> : null}
      {state.status === "ready" && list.length === 0 ? (
        <p className="onb-lede">Nothing on your calendar needs a list yet. We will suggest one when something comes up.</p>
      ) : null}
      {list.length ? (
        <div className="onb-options">
          {list.map((item, index) => (
            <button
              key={item.id}
              type="button"
              data-nav-option
              className={`onb-option onb-event${index === highlight ? " is-highlight" : ""}`}
              onMouseEnter={() => setHighlight(index)}
              onFocus={() => setHighlight(index)}
              onClick={() => onFinish({ prompt: item.prompt, category: item.category })}
            >
              <span className="onb-date" aria-hidden="true">
                <span>{monthOf(item.date)}</span>
                <strong>{dayOf(item.date)}</strong>
              </span>
              <span className="onb-option-label">{item.title}</span>
              <span className="onb-option-detail">
                {item.daysAway === 0 ? "Today" : item.daysAway === 1 ? "Tomorrow" : `In ${item.daysAway} days`} · Build a list
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <button type="button" className={list.length ? "onb-link" : "onb-primary"} onClick={() => onFinish(null)}>
        {list.length ? "Not now" : "Start planning"}
      </button>
    </section>
  );
}

function monthOf(date) {
  return new Date(`${date}T12:00:00`).toLocaleString("en-US", { month: "short" });
}

function dayOf(date) {
  return Number(date.slice(8, 10));
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" width="18" height="18">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.4 0 24 0 14.6 0 6.6 5.4 2.6 13.2l8 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.7 7.1-17z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-8-6.2C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8l8-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2.2 1.5-5.1 2.4-8.7 2.4-6.2 0-11.5-4.1-13.4-9.9l-8 6.2C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function HandIcon({ action }) {
  const pen = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <svg className="onb-hand" viewBox="0 0 48 48" aria-hidden="true" data-action={action}>
      {action === "select" ? (
        <path {...pen} d="M15 22v-3a3 3 0 0 1 6 0v1-3a3 3 0 0 1 6 0v3-2a3 3 0 0 1 6 0v3a3 3 0 0 1 6 0v6c0 7-5 12-12 12h-1c-5 0-8-2-11-6l-3-5a3 3 0 0 1 5-3l2 2v-5" />
      ) : (
        <>
          <path {...pen} d="M20 40V14a3 3 0 0 1 6 0v12m0-4a3 3 0 0 1 6 0v4m0-2a3 3 0 0 1 6 0v6c0 6-4 10-10 10h-2c-4 0-6-2-8-5l-4-6a3 3 0 0 1 5-3l1 2" />
          {action === "move" ? <path {...pen} className="onb-hand-arrows" d="M10 8l-3 4h6zM10 26l-3-4h6z" /> : null}
          {action === "page" ? <path {...pen} className="onb-hand-arrows" d="M6 8h10m-3-3 3 3-3 3M36 8H26m3-3-3 3 3 3" /> : null}
        </>
      )}
    </svg>
  );
}
