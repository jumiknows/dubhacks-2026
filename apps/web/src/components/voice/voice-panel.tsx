"use client";
import { useEffect, useRef, useState } from "react";
import type { PlaceContext } from "@emberready/domain";
import { VoiceConnection } from "./realtime";

export function VoicePanel({ context }: { context: PlaceContext | null }) {
  const [message, setMessage] = useState("Listen to the briefing or ask Grok about this snapshot.");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [question, setQuestion] = useState("");
  const [transcript, setTranscript] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const active = useRef(true);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const connection = useRef<VoiceConnection | null>(null);
  function stopResources() {
    generation.current += 1; abort.current?.abort(); audio.current?.pause(); audio.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null;
    connection.current?.stop(); connection.current = null;
  }
  useEffect(() => { active.current = true; return () => { active.current = false; stopResources(); }; }, []);
  function stop() { stopResources(); setReady(false); setBusy(false); setMessage("Voice stopped. The readable briefing remains available."); }
  async function speech() {
    if (!context) return;
    stopResources(); setReady(false); setBusy(true); setMessage("Preparing the spoken briefing.");
    const run = generation.current;
    const controller = new AbortController(); abort.current = controller;
    try {
      const response = await fetch("/api/voice/briefing", { method: "POST", headers: { "Content-Type": "application/json", ...(accessCode ? { Authorization: `Bearer ${accessCode}` } : {}) }, body: JSON.stringify({ placeId: context.placeId, snapshotId: context.snapshotId, asOf: context.asOf, mode: context.mode }), signal: controller.signal });
      if (!active.current || run !== generation.current) return;
      if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message ?? "Spoken audio is unavailable."); }
      if (response.headers.get("X-Context-Version") !== context.contextVersion) throw new Error("The audio context changed. Retry from the selected community.");
      const blob = await response.blob();
      if (!active.current || run !== generation.current) return;
      objectUrl.current = URL.createObjectURL(blob); audio.current = new Audio(objectUrl.current);
      audio.current.onended = () => { if (active.current) { setBusy(false); setMessage("Briefing finished."); } };
      await audio.current.play(); setMessage("Playing the selected briefing with Grok Voice.");
    } catch (error) { if (active.current && run === generation.current) { setBusy(false); setMessage(error instanceof Error ? error.message : "Audio is unavailable. Read the briefing."); } }
  }
  async function start() {
    if (!context) return;
    stopResources(); setBusy(true); setMessage("Connecting to Grok Voice."); setTranscript("");
    const run = generation.current;
    const voice = new VoiceConnection((text, isReady) => { if (active.current && run === generation.current) { setMessage(text); setReady(isReady); setBusy(false); } }, (text) => { if (active.current && run === generation.current) setTranscript((previous) => (previous + text).slice(-12000)); });
    connection.current = voice;
    try { await voice.start(context, accessCode); }
    catch (error) { voice.stop(); if (active.current && run === generation.current) { setBusy(false); setReady(false); setMessage(error instanceof Error ? error.message : "Voice is unavailable."); } }
  }
  const [open, setOpen] = useState(false);
  return <section className="voice" aria-label="Grok Voice">
    <div className="voice-row voice-controls">
      {busy || ready
        ? <button type="button" className="btn primary" onClick={stop}><Icon d="M5 5h10v10H5z" />Stop voice</button>
        : <button type="button" className="btn primary" disabled={!context} onClick={speech}><Icon d="M3 8v4h3l4 4V4L6 8H3zm10.5 2a3.5 3.5 0 0 0-2-3.2v6.4a3.5 3.5 0 0 0 2-3.2z" />Play spoken briefing</button>}
      <button type="button" className="btn" disabled={!context || busy || ready} onClick={start}><Icon d="M10 2a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM5 10a5 5 0 0 0 10 0h-1.5a3.5 3.5 0 0 1-7 0H5zm4.25 6.9V18h1.5v-1.1" />Talk to Grok</button>
      <button type="button" className="btn icon" aria-expanded={open} aria-label="Demo Voice access" title="Demo Voice access" onClick={() => setOpen((value) => !value)}><Icon d="M12.5 2a5.5 5.5 0 0 0-5.2 7.3L2 14.6V18h3.4v-1.8h1.8v-1.8H9l1.7-1.7A5.5 5.5 0 1 0 12.5 2zm1.5 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" /></button>
    </div>
    <p className="voice-note" role="status">{message}</p>
    {open ? <div className="voice-access voice-controls"><label>Access code<input type="password" autoComplete="off" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} /></label><p className="subtle">The private hosted app uses your signed-in access. A separate server deployment can use a demo access code.</p></div> : null}
    {ready ? <form className="ask voice-controls" onSubmit={(event) => { event.preventDefault(); connection.current?.ask(question); setQuestion(""); }}>
      <label htmlFor="voice-question" className="sr-only">Ask about this snapshot</label>
      <input id="voice-question" className="voice-question" placeholder="What changed near here, and how old is it?" maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} />
      <button type="submit" className="btn primary" disabled={!question.trim()}>Ask Grok</button>
      <button type="button" className="btn icon" aria-label="Use microphone" title="Use microphone" onClick={() => void connection.current?.microphone()}><Icon d="M10 2a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM5 10a5 5 0 0 0 10 0h-1.5a3.5 3.5 0 0 1-7 0H5z" /></button>
    </form> : null}
    {transcript ? <div className="voice-transcript" aria-label="Conversation transcript">{transcript}</div> : null}
  </section>;
}

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} /></svg>;
}
