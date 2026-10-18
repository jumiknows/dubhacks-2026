import type { PlaceContext } from "@emberready/domain";

interface Session {
  token: string; ticket?: string; model: string; instructions: string; tools: unknown[];
  contextVersion?: string; sessionSeconds: number;
}
/** Runs a Grok tool call in the page and returns the JSON result Grok will read. */
export type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<unknown>;
interface SessionOptions { toolHandler?: ToolHandler; readyMessage?: string; maxSeconds?: number }
const CHUNK_SAMPLES = 960; // 40 ms at 24 kHz
const BARGE_IN_RMS = 0.08; // speech over Grok must be clearly louder than speaker echo
const BARGE_IN_CHUNKS = 4; // and last about 160 ms
const ECHO_TAIL_SECONDS = 0.35; // room echo after playback ends
const MAX_QUEUED_SECONDS = 180;

export class VoiceConnection {
  private ws: WebSocket | null = null;
  private audio: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private capture: AudioWorkletNode | null = null;
  private controller = new AbortController();
  private stopped = false;
  private ready = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAudio = 0;
  private maxQueuedSeconds = MAX_QUEUED_SECONDS;
  // Microphone audio is batched into 40 ms chunks before sending.
  private chunk = new Int16Array(CHUNK_SAMPLES);
  private chunkFill = 0;
  // While Grok is talking, mic chunks are held back so its own voice from the speakers cannot
  // interrupt it. Sustained loud speech over it still counts as an interruption.
  private held: Int16Array[] = [];
  private echoTailUntil = 0;
  // True from response.created to response.done: audio arrives in bursts, so an empty
  // playback queue alone does not mean Grok has finished.
  private responding = false;
  // After the user talks over Grok, send everything they say until xAI hears them stop.
  private interrupting = false;
  private sources = new Set<AudioBufferSourceNode>();
  private toolResults: Promise<void>[] = [];
  private toolCalls = new Set<string>();
  private toolCount = 0;
  private options: SessionOptions = {};
  constructor(private readonly onState: (message: string, ready: boolean) => void, private readonly onTranscript: (text: string) => void) {}

  async start(context: PlaceContext, accessCode: string): Promise<void> {
    await this.startSession("/api/voice/session", { placeId: context.placeId, snapshotId: context.snapshotId, asOf: context.asOf, mode: context.mode }, accessCode, {}, (session) => session.contextVersion === context.contextVersion);
  }

  /** Open a Grok Voice session from any session endpoint. With a toolHandler, Grok's tool calls run in the page. */
  async startSession(url: string, body: unknown, accessCode: string, options: SessionOptions = {}, accept: (session: Session) => boolean = () => true): Promise<void> {
    this.options = options;
    this.audio = new AudioContext({ sampleRate: 24000 });
    await this.audio.resume();
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", ...(accessCode ? { Authorization: `Bearer ${accessCode}` } : {}) },
      body: JSON.stringify(body), signal: this.controller.signal,
    });
    const session = await response.json() as Session & { error?: { message: string } };
    if (this.stopped) return;
    if (!response.ok || !accept(session)) throw new Error(session.error?.message ?? "Voice context did not match. Retry from the selected community.");
    const seconds = Math.min(session.sessionSeconds, options.maxSeconds ?? 120);
    this.maxQueuedSeconds = Math.min(MAX_QUEUED_SECONDS, seconds);
    this.ws = new WebSocket(`wss://api.x.ai/v1/realtime?model=${encodeURIComponent(session.model)}`, [`xai-client-secret.${session.token}`]);
    this.timer = setTimeout(() => { this.stop(); this.onState(`The ${Math.round(seconds / 60)}-minute session ended. Start a new session to continue.`, false); }, seconds * 1000);
    this.ws.onopen = () => this.send({ type: "session.update", session: {
      voice: "eve", instructions: session.instructions, tools: session.tools,
      turn_detection: { type: "server_vad" }, audio: { input: { format: { type: "audio/pcm", rate: 24000 } }, output: { format: { type: "audio/pcm", rate: 24000 } } },
    } });
    this.ws.onerror = () => this.fail("Grok Voice could not connect. The token may have expired. Start a new session or read the briefing.");
    this.ws.onclose = () => { if (!this.stopped) this.fail("The Voice connection closed. Start a new session to retry."); };
    this.ws.onmessage = (event) => {
      if (this.stopped) return;
      try { void this.event(JSON.parse(event.data), session).catch(() => this.fail("The Voice response could not be processed. Use the readable briefing.")); }
      catch { this.fail("The Voice response was not valid."); }
    };
  }
  private send(value: unknown) { if (!this.stopped && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(value)); }
  private fail(message: string) { this.stop(); this.onState(message, false); }
  private async event(event: Record<string, unknown>, session: Session) {
    if (event.type === "session.updated") { this.ready = true; this.onState(this.options.readyMessage ?? "Voice is ready. Ask about the selected observations.", true); }
    if (event.type === "error") this.fail("Grok rejected the Voice request. Retry or use the readable briefing.");
    if (event.type === "response.created") { this.responding = true; this.interrupting = false; }
    if (event.type === "input_audio_buffer.speech_stopped") this.interrupting = false;
    if (event.type === "response.done") this.responding = false;
    // Only forwarded audio reaches xAI, so a detected start of speech is the user, not echo.
    if (event.type === "input_audio_buffer.speech_started") this.clearAudio();
    if (event.type === "response.output_audio.delta" || event.type === "response.audio.delta") this.play(String(event.delta));
    if (event.type === "response.output_audio_transcript.delta" || event.type === "response.audio_transcript.delta" || event.type === "response.text.delta") this.onTranscript(String(event.delta ?? ""));
    if (event.type === "conversation.item.input_audio_transcription.completed") this.onTranscript(`\nYou: ${String(event.transcript ?? "")}\nGrok: `);
    if (event.type === "response.function_call_arguments.done") {
      const callId = String(event.call_id);
      if (this.toolCalls.has(callId)) return;
      this.toolCalls.add(callId);
      this.toolCount += 1;
      if (this.toolCount > (this.options.toolHandler ? 40 : 12)) { this.fail("The demo tool-call limit was reached. Start a new session."); return; }
      const operation = (async () => {
        let output: unknown = { error: "Only get_place_context is allowed." };
        if (this.options.toolHandler) {
          try { output = await this.options.toolHandler(String(event.name), JSON.parse(String(event.arguments || "{}"))); }
          catch (error) { output = { error: error instanceof Error ? error.message : "Tool failed. Do not guess the result." }; }
        } else if (event.name === "get_place_context") {
          try {
            const response = await fetch("/api/voice/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket: session.ticket, arguments: JSON.parse(String(event.arguments)) }), signal: this.controller.signal });
            output = await response.json();
          } catch { output = { error: "Context unavailable. Do not infer current facts." }; }
        }
        this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } });
      })();
      this.toolResults.push(operation);
    }
    if (event.type === "response.done") {
      const results = this.toolResults.splice(0);
      if (results.length) { await Promise.all(results); this.send({ type: "response.create" }); }
      else this.onTranscript("\n");
    }
  }
  ask(text: string) {
    if (!this.ready || !text.trim() || text.length > 1000) return;
    this.clearAudio();
    this.onTranscript(`\nYou: ${text.trim()}\nGrok: `);
    this.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: text.trim() }] } });
    this.send({ type: "response.create" });
  }
  async microphone(): Promise<void> {
    if (!this.ready || !this.audio || this.stopped) return;
    if (this.stream) { this.stopMicrophone(); this.onState("Microphone stopped. You can still type a question.", true); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (this.stopped) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      await this.audio.audioWorklet.addModule("/pcm-capture.js");
      if (this.stopped) return;
      this.capture = new AudioWorkletNode(this.audio, "pcm-capture");
      this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => this.capture128(new Int16Array(event.data));
      this.audio.createMediaStreamSource(stream).connect(this.capture);
      this.capture.connect(this.audio.destination);
      this.onState("Listening. Speak now, or type below. Audio goes to xAI for this session and is not stored by this app. Use the microphone button to mute.", true);
    } catch {
      this.stopMicrophone();
      if (!this.stopped) this.onState("Microphone permission was denied or capture is unavailable. Type a question instead.", true);
    }
  }
  private capture128(samples: Int16Array) {
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(samples.length - offset, CHUNK_SAMPLES - this.chunkFill);
      this.chunk.set(samples.subarray(offset, offset + take), this.chunkFill);
      this.chunkFill += take; offset += take;
      if (this.chunkFill === CHUNK_SAMPLES) { this.onChunk(this.chunk); this.chunk = new Int16Array(CHUNK_SAMPLES); this.chunkFill = 0; }
    }
  }
  private onChunk(chunk: Int16Array) {
    const talking = !!this.audio && (this.responding || this.sources.size > 0 || this.audio.currentTime < this.echoTailUntil);
    if (!talking || this.interrupting) { this.held = []; this.sendAudio(chunk); return; }
    let energy = 0; for (const value of chunk) energy += (value / 32768) ** 2;
    const loud = Math.sqrt(energy / chunk.length) > BARGE_IN_RMS;
    if (!loud) { this.held = []; return; }
    this.held.push(chunk);
    if (this.held.length < BARGE_IN_CHUNKS) return;
    // The user is talking over Grok: stop playback and send what they said, including the start.
    this.clearAudio();
    this.interrupting = true;
    for (const part of this.held) this.sendAudio(part);
    this.held = [];
  }
  private sendAudio(chunk: Int16Array) {
    const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
    this.send({ type: "input_audio_buffer.append", audio: btoa(binary) });
  }
  private play(base64: string) {
    if (!this.audio || this.stopped) return;
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    if (bytes.length % 2) return;
    const samples = new DataView(bytes.buffer);
    const buffer = this.audio.createBuffer(1, bytes.length / 2, 24000);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = samples.getInt16(i * 2, true) / 32768;
    const source = this.audio.createBufferSource(); source.buffer = buffer; source.connect(this.audio.destination);
    const start = Math.max(this.nextAudio, this.audio.currentTime);
    // Grok can deliver a complete answer much faster than real-time playback.
    // Include each incoming chunk, bounded by this session and the playback cap.
    if (start - this.audio.currentTime + buffer.duration > this.maxQueuedSeconds) { this.fail("Voice output exceeded the demo buffer. Use the transcript."); return; }
    this.sources.add(source); source.onended = () => this.sources.delete(source);
    source.start(start); this.nextAudio = start + buffer.duration;
    this.echoTailUntil = this.nextAudio + ECHO_TAIL_SECONDS;
  }
  private clearAudio() { for (const source of this.sources) { try { source.stop(); } catch { /* Already stopped. */ } } this.sources.clear(); this.nextAudio = 0; this.echoTailUntil = 0; }
  private stopMicrophone() { this.capture?.disconnect(); this.capture = null; this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null; }
  stop() {
    this.stopped = true; this.ready = false; this.controller.abort();
    if (this.timer) clearTimeout(this.timer);
    this.stopMicrophone(); this.clearAudio(); this.ws?.close(); this.ws = null;
    void this.audio?.close(); this.audio = null;
  }
}
