// Gemini Live voice session through the /ws-live relay (the API key never reaches the browser).
// Mic: 16 kHz PCM16 mono, sent as binary frames. Speaker: Gemini's 24 kHz PCM16 chunks.
// The mic is paused while Esper speaks so speakers can't feed back into it.

const MIC_RATE = 16000;
const SPEAKER_RATE = 24000;
const SEND_EVERY_MS = 100;

// Collects mic samples off the audio thread and hands them to the page.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("esper-mic-tap", Tap);
`;

export function liveSocketUrl() {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/ws-live`;
}

export class LiveSession {
  constructor({ onStatus, onUi, onCaption, onTurnEnd, onError }) {
    this.handlers = { onStatus, onUi, onCaption, onTurnEnd, onError };
    this.ws = null;
    this.mic = null;
    this.playing = new Set();
    this.playhead = 0;
    this.status = "off";
  }

  setStatus(status, detail) {
    this.status = status;
    this.handlers.onStatus?.(status, detail);
  }

  async start(context) {
    if (this.ws) return;
    this.setStatus("connecting");
    let ws;
    try {
      this.speaker = new AudioContext({ sampleRate: SPEAKER_RATE });
      ws = new WebSocket(liveSocketUrl());
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onmessage = (event) => { if (this.ws === ws) this.receive(event.data); };
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Voice relay did not respond.")), 10000);
        const finish = (error) => { clearTimeout(timer); if (error) reject(error); else resolve(); };
        ws.onopen = () => finish();
        ws.onerror = () => finish(new Error("Voice relay is unreachable."));
        ws.onclose = () => finish(new Error("Voice relay closed before connecting."));
      });
      if (this.ws !== ws) return;
      ws.onclose = () => { if (this.ws === ws) this.stop("off"); };
      this.sendContext(context);
      await this.speaker.resume();
      if (this.ws !== ws) return;
      await this.startMic(ws);
      if (this.ws === ws) this.setStatus("listening");
    } catch (err) {
      // An old permission prompt or connection must not stop a replacement session.
      if (ws && this.ws !== ws) return;
      this.stop("error", err.message);
      throw err;
    }
  }

  releaseMic() {
    const mic = this.mic;
    this.mic = null;
    if (!mic) return;
    mic.closed = true;
    mic.stream.getTracks().forEach((track) => track.stop());
    for (const node of [mic.source, mic.tap, mic.sink]) {
      try { node?.disconnect(); } catch { /* already disconnected */ }
    }
    if (mic.ctx) void mic.ctx.close().catch(() => {});
  }

  async startMic(ws = this.ws) {
    if (!ws || this.ws !== ws) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot use the microphone.");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    let ctx; let source; let tap; let sink;
    const mic = { stream, closed: false };
    const cleanup = () => {
      if (mic.closed) return;
      mic.closed = true;
      if (this.mic === mic) this.mic = null;
      stream.getTracks().forEach((track) => track.stop());
      for (const node of [source, tap, sink]) { try { node?.disconnect(); } catch { /* already disconnected */ } }
      if (ctx) void ctx.close().catch(() => {});
    };
    // stop() may run while the browser permission dialog is still open.
    if (!ws || this.ws !== ws) { cleanup(); return; }
    this.mic = mic;
    try {
      ctx = mic.ctx = new AudioContext();
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      if (this.ws !== ws) { cleanup(); return; }
      await ctx.resume();
      if (this.ws !== ws) { cleanup(); return; }
      source = mic.source = ctx.createMediaStreamSource(stream);
      tap = mic.tap = new AudioWorkletNode(ctx, "esper-mic-tap");
      sink = mic.sink = ctx.createGain();
      sink.gain.value = 0;
      const pending = [];
      let pendingLength = 0;
      const flushAt = Math.round((ctx.sampleRate * SEND_EVERY_MS) / 1000);
      tap.port.onmessage = ({ data }) => {
        pending.push(data);
        pendingLength += data.length;
        if (pendingLength < flushAt) return;
        const joined = new Float32Array(pendingLength);
        let offset = 0;
        for (const chunk of pending) { joined.set(chunk, offset); offset += chunk.length; }
        pending.length = 0;
        pendingLength = 0;
        // Half duplex: drop mic audio while Esper is talking.
        if (this.playing.size || this.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(toPcm16(downsample(joined, ctx.sampleRate, MIC_RATE)));
      };
      source.connect(tap);
      // Keep the worklet in the rendered audio graph without monitoring the microphone.
      tap.connect(sink).connect(ctx.destination);
      this.mic = mic;
    } catch (error) { cleanup(); throw error; }
  }

  receive(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    if (message.type === "error") {
      this.handlers.onError?.(message.error || "Voice is unavailable.");
      this.stop("unavailable", message.error);
      return;
    }
    if (message.type === "UI_UPDATE") {
      this.handlers.onUi?.(message);
      return;
    }
    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) this.flushSpeaker();
    for (const part of content.modelTurn?.parts || []) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) this.play(part.inlineData.data);
    }
    if (content.inputTranscription?.text) this.handlers.onCaption?.("user", content.inputTranscription.text);
    if (content.outputTranscription?.text) this.handlers.onCaption?.("assistant", content.outputTranscription.text);
    if (content.turnComplete) this.handlers.onTurnEnd?.();
  }

  play(base64) {
    if (!this.speaker) return;
    let bytes;
    try { bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)); } catch { return; }
    if (bytes.length < 2 || bytes.length % 2) return;
    const samples = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
    const buffer = this.speaker.createBuffer(1, samples.length, SPEAKER_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;
    const node = this.speaker.createBufferSource();
    node.buffer = buffer;
    node.connect(this.speaker.destination);
    this.playhead = Math.max(this.playhead, this.speaker.currentTime + 0.03);
    node.start(this.playhead);
    this.playhead += buffer.duration;
    this.playing.add(node);
    if (this.status !== "speaking") this.setStatus("speaking");
    node.onended = () => {
      this.playing.delete(node);
      if (!this.playing.size && this.ws) this.setStatus("listening");
    };
  }

  flushSpeaker() {
    for (const node of this.playing) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    }
    this.playing.clear();
    this.playhead = 0;
  }

  sendContext(context) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "session", ...context }));
  }

  sendText(text) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "text", text }));
    return true;
  }

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  stop(status = "off", detail) {
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "audio_end" }));
      } catch {
        /* closing anyway */
      }
      ws.close();
    }
    this.releaseMic();
    this.flushSpeaker();
    if (this.speaker) void this.speaker.close().catch(() => {});
    this.speaker = null;
    this.setStatus(status, detail);
  }
}

function downsample(input, from, to) {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function toPcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

export { createLive } from "./live-manual.js";
