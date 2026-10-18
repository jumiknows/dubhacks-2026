import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaceContext } from "@emberready/domain";
import { VoiceConnection, type ToolHandler } from "./realtime";

class FakeSocket {
  static OPEN = 1;
  static current: FakeSocket;
  readyState = 1;
  closed = false;
  sent: Record<string, unknown>[] = [];
  onopen?: () => void;
  onerror?: () => void;
  onclose?: () => void;
  onmessage?: (event: { data: string }) => void;
  constructor() { FakeSocket.current = this; }
  send(value: string) { this.sent.push(JSON.parse(value) as Record<string, unknown>); }
  close() { this.closed = true; this.readyState = 3; }
}
class FakeSource {
  buffer: unknown;
  onended?: () => void;
  startAt = -1;
  stopped = false;
  connect() {}
  start(time: number) { this.startAt = time; }
  stop() { this.stopped = true; }
}
class FakeAudio {
  static current: FakeAudio;
  currentTime = 0;
  destination = {};
  closed = false;
  sources: FakeSource[] = [];
  constructor() { FakeAudio.current = this; }
  async resume() {}
  async close() { this.closed = true; }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
}
const context = { placeId: "test-place", snapshotId: "test-snapshot", asOf: "2026-10-17T20:49:00Z", mode: "replay", contextVersion: "test-context" } as PlaceContext;
const oneSecond = Buffer.alloc(48000).toString("base64");
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
async function connect(shop = false, toolHandler: ToolHandler = async () => ({})) {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", FakeAudio);
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ token: "test-ephemeral", ticket: "test-ticket", model: "test-model", instructions: "Test", tools: [], contextVersion: "test-context", sessionSeconds: shop ? 300 : 120 })));
  const state = vi.fn();
  const connection = new VoiceConnection(state, vi.fn());
  if (shop) await connection.startSession("/api/voice/shop-session", {}, "", { toolHandler, maxSeconds: 300 });
  else await connection.start(context, "");
  return { connection, state, socket: FakeSocket.current, audio: FakeAudio.current };
}
function receive(seconds: number) {
  for (let i = 0; i < seconds; i += 1) FakeSocket.current.onmessage?.({ data: JSON.stringify({ type: "response.output_audio.delta", delta: oneSecond }) });
}
describe("streamed Voice playback", () => {
  it("queues an 80-second answer delivered in a burst and releases it on stop", async () => {
    const { connection, state, socket, audio } = await connect();
    receive(80);
    expect(socket.closed).toBe(false);
    expect(state).not.toHaveBeenCalled();
    expect(audio.sources).toHaveLength(80);
    expect(audio.sources.map((source) => source.startAt)).toEqual(Array.from({ length: 80 }, (_, i) => i));
    connection.stop();
    expect(socket.closed).toBe(true);
    expect(audio.closed).toBe(true);
    expect(audio.sources.every((source) => source.stopped)).toBe(true);
    receive(1);
    expect(audio.sources).toHaveLength(80);
  });
  it("stops excessive queued audio and releases already scheduled sources", async () => {
    const { state, socket, audio } = await connect();
    receive(125);
    expect(socket.closed).toBe(true);
    expect(audio.closed).toBe(true);
    expect(state).toHaveBeenCalledWith("Voice output exceeded the demo buffer. Use the transcript.", false);
    expect(audio.sources.filter((source) => source.startAt >= 0)).toHaveLength(120);
    expect(audio.sources.filter((source) => source.startAt >= 0).every((source) => source.stopped)).toBe(true);
  });
  it("preserves the longer shopping session while bounding incoming audio", async () => {
    const { connection, socket, audio } = await connect(true);
    receive(150);
    expect(socket.closed).toBe(false);
    receive(31);
    expect(socket.closed).toBe(true);
    expect(audio.sources.filter((source) => source.startAt >= 0)).toHaveLength(180);
    connection.stop();
  });
  it("keeps shopping tool handlers and emits one result for repeated provider calls", async () => {
    const handler = vi.fn(async () => ({ status: "planned" }));
    const { connection, socket } = await connect(true, handler);
    const call = { type: "response.function_call_arguments.done", call_id: "call-1", name: "plan_trip", arguments: '{"destination":"Washington"}' };
    socket.onmessage?.({ data: JSON.stringify(call) });
    socket.onmessage?.({ data: JSON.stringify(call) });
    socket.onmessage?.({ data: JSON.stringify({ type: "response.done" }) });
    await vi.waitFor(() => expect(socket.sent.some((message) => message.type === "response.create")).toBe(true));
    expect(handler).toHaveBeenCalledExactlyOnceWith("plan_trip", { destination: "Washington" });
    expect(socket.sent.filter((message) => message.type === "conversation.item.create")).toEqual([
      { type: "conversation.item.create", item: { type: "function_call_output", call_id: "call-1", output: '{"status":"planned"}' } },
    ]);
    connection.stop();
  });
});
