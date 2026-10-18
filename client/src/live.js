/**
 * Gemini Live voice session over /ws-live (see plan.md).
 *
 * Cost and latency choices:
 * - Audio is sent only while someone is talking. A small voice detector here
 *   marks activityStart / activityEnd, so silence is never billed and Gemini
 *   answers the moment the user stops (no server-side silence timeout).
 * - The session closes after IDLE_MS without speech; the next tap reopens it
 *   and the plan id carries the context over.
 * - Microphone permission and the socket open in parallel.
 *
 * createLive({ onStatus, onUi, onCaption, onError }) →
 *   { start(), stop(), say(text), setPlanId(id), setTrustFloor(n) }
 * status: "idle" | "connecting" | "listening" | "hearing" | "thinking" | "speaking"
 */

const IDLE_MS = 45_000;
const FRAME_MS = 64; // 1024 samples at 16 kHz, set by public/live-capture.js
const START_FRAMES = 2; // ~130 ms above threshold starts a turn
const END_MS = 650; // this much quiet ends a turn
const PREROLL_FRAMES = 4; // keep the first syllable
const MAX_TURN_MS = 30_000;

export function createLive({ onStatus, onUi, onCaption, onError }) {
  let ws = null;
  let status = "idle";
  let session = { plan_id: null, trust_floor: 0.5 };
  let pendingText = [];

  // capture
  let micContext = null;
  let stream = null;
  let node = null;
  let noiseFloor = 0.01;
  let loudFrames = 0;
  let quietMs = 0;
  let turnMs = 0;
  let inTurn = false;
  let preroll = [];

  // playback
  let playContext = null;
  let playhead = 0;
  const sources = new Set();
  let turnComplete = false;

  let idleTimer = null;

  function setStatus(next) {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  }

  function send(value) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(typeof value === "string" || value instanceof ArrayBuffer ? value : JSON.stringify(value));
  }

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!inTurn && status !== "speaking" && status !== "thinking") stop("Paused to save. Tap to keep talking.");
      else touch();
    }, IDLE_MS);
  }

  async function start() {
    if (ws) return;
    setStatus("connecting");
    onCaption?.("");
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws-live`);
    socket.binaryType = "arraybuffer";
    ws = socket;
    // Both audio contexts are created inside the tap so the browser lets them run.
    playContext = new AudioContext({ sampleRate: 24000 });
    micContext = new AudioContext();
    micContext.resume().catch(() => undefined);
    const mic = startMic(socket, micContext).catch((err) => {
      if (ws !== socket) return null;
      fail(err?.name === "NotAllowedError" ? "Microphone access was blocked." : "No microphone is available.");
      return null;
    });
    socket.onopen = () => send({ type: "session", ...session });
    socket.onmessage = async (event) => {
      if (typeof event.data !== "string") return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "error") return fail(message.error === "session_limit" ? "Voice session time limit reached. Tap to start again." : message.error);
      if (message.type === "UI_UPDATE") return onUi?.(message);
      if (message.setupComplete) {
        if (!(await mic) || ws !== socket) return;
        setStatus("listening");
        touch();
        for (const text of pendingText.splice(0)) say(text);
        return;
      }
      if (message.serverContent) handleServer(message.serverContent);
      if (message.goAway) stop("Voice session ended. Tap to start again.");
    };
    socket.onclose = () => {
      if (ws === socket) stop(status === "connecting" ? "Voice is off right now." : null);
    };
  }

  async function startMic(socket, context) {
    const captured = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (ws !== socket || micContext !== context) { captured.getTracks().forEach((track) => track.stop()); return null; }
    stream = captured;
    await context.audioWorklet.addModule("/live-capture.js");
    if (ws !== socket || micContext !== context) { captured.getTracks().forEach((track) => track.stop()); return null; }
    node = new AudioWorkletNode(context, "live-capture");
    node.port.onmessage = (event) => onFrame(event.data);
    micContext.createMediaStreamSource(stream).connect(node);
    // A silent path to the speakers keeps the capture node running in every browser.
    const mute = micContext.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(micContext.destination);
    return true;
  }

  // Voice activity: an adaptive threshold over the frame loudness.
  function onFrame({ pcm, rms }) {
    if (!ws || status === "connecting") return;
    const speaking = status === "speaking";
    if (!inTurn) noiseFloor = noiseFloor * 0.95 + Math.min(rms, 0.05) * 0.05;
    const on = Math.max(0.012, noiseFloor * 3) * (speaking ? 2 : 1); // echo margin while Gemini talks
    const off = on * 0.6;

    if (!inTurn) {
      preroll.push(pcm);
      if (preroll.length > PREROLL_FRAMES) preroll.shift();
      loudFrames = rms > on ? loudFrames + 1 : 0;
      if (loudFrames < START_FRAMES) return;
      inTurn = true;
      quietMs = 0;
      turnMs = 0;
      if (speaking || status === "thinking") clearPlayback(); // barge-in
      send({ realtimeInput: { activityStart: {} } });
      for (const frame of preroll.splice(0)) send(frame);
      setStatus("hearing");
      onCaption?.("");
      touch();
      return;
    }

    send(pcm);
    turnMs += FRAME_MS;
    quietMs = rms < off ? quietMs + FRAME_MS : 0;
    if (quietMs >= END_MS || turnMs >= MAX_TURN_MS) {
      inTurn = false;
      loudFrames = 0;
      send({ realtimeInput: { activityEnd: {} } });
      setStatus("thinking");
      touch();
    }
  }

  function handleServer(content) {
    if (content.interrupted) clearPlayback();
    for (const part of content.modelTurn?.parts || []) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) play(part.inlineData.data);
    }
    if (content.outputTranscription?.text) onCaption?.((current) => `${current}${content.outputTranscription.text}`);
    if (content.turnComplete) {
      turnComplete = true;
      settle();
    }
  }

  function play(base64) {
    if (!playContext) return;
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const samples = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
    const buffer = playContext.createBuffer(1, samples.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) channel[i] = samples[i] / 32768;
    const source = playContext.createBufferSource();
    source.buffer = buffer;
    source.connect(playContext.destination);
    playhead = Math.max(playhead, playContext.currentTime + 0.02);
    source.start(playhead);
    playhead += buffer.duration;
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      settle();
    };
    turnComplete = false;
    if (!inTurn) setStatus("speaking");
    touch();
  }

  function settle() {
    if (turnComplete && sources.size === 0 && !inTurn && ws) setStatus("listening");
  }

  function clearPlayback() {
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    sources.clear();
    playhead = 0;
  }

  /** A typed or tapped turn ("I need to prepare for camping"). Starts a session if needed. */
  function say(text) {
    if (!text) return;
    if (status === "idle" || status === "connecting" || !ws) {
      pendingText.push(text);
      start();
      return;
    }
    clearPlayback();
    send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } });
    setStatus("thinking");
    touch();
  }

  function setPlanId(id) {
    session = { ...session, plan_id: id };
    send({ type: "session", ...session });
  }

  function setTrustFloor(value) {
    session = { ...session, trust_floor: value };
    send({ type: "session", ...session });
  }

  function fail(message) {
    onError?.(message || "Voice is off right now.");
    stop(null, true);
  }

  function stop(note = null, failed = false) {
    clearTimeout(idleTimer);
    const socket = ws;
    ws = null;
    socket?.close();
    clearPlayback();
    node?.port.close();
    node?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    micContext?.close().catch(() => undefined);
    playContext?.close().catch(() => undefined);
    node = stream = micContext = playContext = null;
    inTurn = false;
    preroll = [];
    pendingText = [];
    setStatus(failed ? "error" : "idle");
    if (note) onCaption?.(note);
  }

  return { start, stop: () => stop(), say, setPlanId, setTrustFloor, get status() { return status; } };
}
