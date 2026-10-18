import { useCallback, useEffect, useRef, useState } from "react";
import { assistantHealth, plannerChat } from "./api.js";
import { LiveSession } from "./live.js";

let nextTurn = 0;

/**
 * The conversation with ESPER. Typed messages go to /planner/chat, or into the voice session when
 * one is open, so both drive the same tools. `onUi` applies each UI_UPDATE as it arrives;
 * `getContext` returns what the screen shows ({ plan_id, trust_floor, focus_item_id, compare }).
 */
export function useAssistant({ getContext, onUi }) {
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState({ status: "off", available: null, detail: "" });
  const [brain, setBrain] = useState(null);
  const session = useRef(null);
  const live = useRef({ user: null, assistant: null });
  const latest = useRef({ getContext, onUi, turns });
  latest.current = { getContext, onUi, turns };

  useEffect(() => {
    let cancelled = false;
    assistantHealth().then((health) => {
      if (cancelled) return;
      const integrations = health?.integrations || {};
      setVoice((current) => ({ ...current, available: String(integrations.gemini_live || "").startsWith("configured") }));
      setBrain(!health ? "offline" : String(integrations.llm || "").startsWith("configured") ? "llm" : "rules");
    });
    return () => {
      cancelled = true;
      session.current?.stop();
    };
  }, []);

  const addTurn = useCallback((role, text, meta = {}) => {
    const id = `turn-${++nextTurn}`;
    setTurns((current) => [...current.slice(-60), { id, role, text, ...meta }]);
    return id;
  }, []);

  const extendTurn = useCallback((id, text) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, text: turn.text + text } : turn)));
  }, []);

  const send = useCallback(async (raw) => {
    const text = raw.trim();
    if (!text) return;
    if (session.current?.open) {
      live.current = { user: null, assistant: null };
      addTurn("user", text, { source: "typed" });
      session.current.sendText(text);
      return;
    }
    const history = latest.current.turns
      .filter((turn) => turn.role === "user" || turn.role === "assistant")
      .slice(-8)
      .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 2000) }));
    addTurn("user", text, { source: "typed" });
    setBusy(true);
    try {
      const reply = await plannerChat({ text: text.slice(0, 1000), history, ...latest.current.getContext() });
      for (const event of reply.events || []) await latest.current.onUi(event);
      addTurn("assistant", reply.reply, { source: reply.source });
    } catch (err) {
      addTurn("assistant", `I couldn't reach the assistant (${err.message}). The board still works by hand.`, { error: true });
    } finally {
      setBusy(false);
    }
  }, [addTurn]);

  const startVoice = useCallback(async () => {
    if (session.current) return;
    const live_ = new LiveSession({
      onStatus: (status, detail) => {
        // A session that ended (by either side) must not block starting a new one.
        if (["off", "error", "unavailable"].includes(status) && session.current === live_) session.current = null;
        setVoice((current) => ({ ...current, status, detail: detail || "" }));
      },
      onUi: (event) => latest.current.onUi(event),
      onCaption: (role, text) => {
        const key = role === "user" ? "user" : "assistant";
        if (role === "assistant") live.current.user = null;
        if (live.current[key]) extendTurn(live.current[key], text);
        else live.current[key] = addTurn(role, text, { source: "voice" });
      },
      onTurnEnd: () => {
        live.current = { user: null, assistant: null };
      },
      onError: (message) => addTurn("assistant", `Voice is off: ${message}`, { error: true }),
    });
    session.current = live_;
    try {
      await live_.start(latest.current.getContext());
    } catch (err) {
      addTurn("assistant", `Voice didn't start: ${err.message}`, { error: true });
    }
    if (!live_.open) session.current = null;
  }, [addTurn, extendTurn]);

  const stopVoice = useCallback(() => {
    session.current?.stop();
    session.current = null;
  }, []);

  const syncContext = useCallback((context) => {
    session.current?.sendContext(context);
  }, []);

  /** Something the user did on the board, recorded so the conversation keeps up. */
  const note = useCallback((role, text) => addTurn(role, text, { source: "board" }), [addTurn]);

  return { turns, busy, voice, brain, send, startVoice, stopVoice, syncContext, note };
}
