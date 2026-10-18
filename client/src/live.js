// Gemini Live voice session through the /ws-live relay (the API key never reaches the browser).
// Mic: 16 kHz PCM16 mono, sent as binary frames. Speaker: Gemini's 24 kHz PCM16 chunks.
// The mic is paused while ESPER speaks so speakers can't feed back into it.

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
    this.speaker = new AudioContext({ sampleRate: SPEAKER_RATE });
    const ws = new WebSocket(liveSocketUrl());
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    try {
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error("Voice relay is unreachable."));
      });
    } catch (err) {
      this.stop("error", err.message);
      throw err;
    }
    ws.onmessage = (event) => this.receive(event.data);
    ws.onclose = () => {
      if (this.ws === ws) this.stop("off");
    };
    this.sendContext(context);
    try {
      await this.startMic();
    } catch (err) {
      this.stop("error", err.message);
      throw err;
    }
    // The relay may have ended the session while the permission prompt was open.
    if (this.ws !== ws) {
      this.releaseMic();
      return;
    }
    this.setStatus("listening");
  }

  releaseMic() {
    if (!this.mic) return;
    this.mic.stream.getTracks().forEach((track) => track.stop());
    this.mic.source.disconnect();
    this.mic.tap.disconnect();
    this.mic.ctx.close();
    this.mic = null;
  }

  async startMic() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot use the microphone.");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = ctx.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(ctx, "esper-mic-tap");
    const pending = [];
    let pendingLength = 0;
    const flushAt = Math.round((ctx.sampleRate * SEND_EVERY_MS) / 1000);
    tap.port.onmessage = ({ data }) => {
      pending.push(data);
      pendingLength += data.length;
      if (pendingLength < flushAt) return;
      const joined = new Float32Array(pendingLength);
      let offset = 0;
      for (const chunk of pending) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      pending.length = 0;
      pendingLength = 0;
      // Half duplex: drop mic audio while ESPER is talking.
      if (this.playing.size || this.ws?.readyState !== WebSocket.OPEN) return;
      this.ws.send(toPcm16(downsample(joined, ctx.sampleRate, MIC_RATE)));
    };
    source.connect(tap);
    this.mic = { stream, ctx, source, tap };
  }

  receive(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
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
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
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
    this.speaker?.close();
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
