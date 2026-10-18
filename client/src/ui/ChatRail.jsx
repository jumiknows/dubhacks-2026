import { useEffect, useRef, useState } from "react";

const VOICE_LABEL = {
  off: "Talk",
  connecting: "Connecting…",
  listening: "Listening · tap to stop",
  speaking: "Esper is speaking",
  error: "Talk",
  unavailable: "Voice off",
};

/** Conversation with Esper: history, a composer, and push-to-start voice. */
export default function ChatRail({ open, assistant, suggestions, onToggle }) {
  const { turns, busy, voice, brain, send, startVoice, stopVoice } = assistant;
  const [draft, setDraft] = useState("");
  const listRef = useRef(null);
  const voiceOn = ["connecting", "listening", "speaking"].includes(voice.status);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns, busy, open]);

  function submit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    send(text);
  }

  if (!open) {
    return (
      <button type="button" className={`chat-orb${voiceOn ? " is-live" : ""}`} onClick={onToggle} aria-label="Open the Esper assistant">
        <span className="chat-orb-core" aria-hidden="true" />
        <span>Ask Esper</span>
      </button>
    );
  }

  return (
    <aside className="chat-rail" aria-label="Esper assistant">
      <header className="chat-head">
        <div>
          <p className="shop-kicker">Esper assistant</p>
          <p className="chat-status">
            <i className={`chat-dot is-${voiceOn ? voice.status : brain || "rules"}`} aria-hidden="true" />
            {voiceOn ? `Voice · ${voice.status}` : brain === "llm" ? "Typed · AI model" : brain === "offline" ? "Assistant offline" : "Typed · offline rules"}
          </p>
        </div>
        <button type="button" className="chat-hide" onClick={onToggle} aria-label="Hide the assistant">Hide</button>
      </header>

      <ol ref={listRef} className="chat-turns" aria-live="polite">
        {turns.length === 0 ? (
          <li className="chat-turn is-assistant is-intro">
            Tell me where you're headed and I'll build the packing list. Then ask me to open an item, compare two
            listings, pick the winner, or check out. You can also just use your hands or the mouse.
          </li>
        ) : null}
        {turns.map((turn) => (
          <li key={turn.id} className={`chat-turn is-${turn.role}${turn.error ? " is-error" : ""}${turn.source === "board" ? " is-board" : ""}`}>
            {turn.source === "voice" ? <span className="chat-src" aria-label="spoken">🎙</span> : null}
            {turn.text}
          </li>
        ))}
        {busy ? <li className="chat-turn is-assistant is-thinking" aria-label="Esper is thinking"><i /><i /><i /></li> : null}
      </ol>

      {suggestions.length ? (
        <div className="chat-suggest" aria-label="Suggestions">
          {suggestions.map((text) => (
            <button key={text} type="button" disabled={busy} onClick={() => send(text)}>{text}</button>
          ))}
        </div>
      ) : null}

      <form className="chat-compose" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-input">Message Esper</label>
        <input
          id="chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={voiceOn ? "Talk, or type here too…" : "Ask Esper…"}
          maxLength={1000}
          autoComplete="off"
        />
        <button type="submit" disabled={busy || !draft.trim()}>Send</button>
      </form>
      <button
        type="button"
        className={`chat-voice${voiceOn ? " is-on" : ""} is-${voice.status}`}
        disabled={voice.available === false || voice.status === "connecting"}
        title={voice.available === false ? "Voice needs GEMINI_API_KEY in api/.env. Typing works without it." : undefined}
        onClick={() => (voiceOn ? stopVoice() : startVoice())}
      >
        <span className="chat-voice-wave" aria-hidden="true"><i /><i /><i /><i /></span>
        {voice.available === false ? "Voice needs a Gemini key" : VOICE_LABEL[voice.status] || "Talk"}
      </button>
    </aside>
  );
}
