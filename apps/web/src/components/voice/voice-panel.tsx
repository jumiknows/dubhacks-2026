"use client";
import { useEffect, useRef, useState } from "react";
import type { PlaceContext } from "@emberready/domain";
import { VoiceConnection } from "./realtime";

export function VoicePanel({ context }: { context: PlaceContext | null }) {
  const [message, setMessage] = useState("Read the briefing or listen with Grok Voice.");
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
  return <section aria-label="Grok Voice">
    <div className="actions voice-controls"><button type="button" disabled={!context || busy} onClick={speech}>Play spoken briefing</button><button type="button" disabled={!context || busy || ready} onClick={start}>Start conversation</button><button type="button" onClick={stop}>Stop voice</button></div>
    <p className="voice-note" role="status">{message}</p>
    <details className="voice-controls"><summary>Demo Voice access</summary><label>Access code<input type="password" autoComplete="off" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} /></label><p>The private hosted app uses your signed-in access. A separate server deployment can use a demo access code.</p></details>
    {ready ? <form className="voice-controls" onSubmit={(event) => { event.preventDefault(); connection.current?.ask(question); setQuestion(""); }}><label htmlFor="voice-question">Ask about this snapshot</label><input id="voice-question" className="voice-question" maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} /><div className="actions"><button type="submit" disabled={!question.trim()}>Ask Grok</button><button type="button" onClick={() => void connection.current?.microphone()}>Use microphone</button></div></form> : null}
    {transcript ? <div className="voice-transcript" aria-label="Conversation transcript">{transcript}</div> : null}
  </section>;
}
