import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request, streamEvents, toValued } from '../src/integration/transport.js';
import { money } from '../src/ui/format.js';
import { createLive } from '../src/live.js';

const originalFetch = globalThis.fetch;
test('POST SSE preserves fragmented UTF-8, CRLF, comments and ordered events', async () => {
  const encoded = new TextEncoder().encode(': heartbeat\r\nevent: say\r\ndata: {"text":"café 🏕"}\r\n\r\nevent: done\ndata: {"grounded":true}\n\n');
  const chunks = [encoded.slice(0, 44), encoded.slice(44, 53), encoded.slice(53, 58), encoded.slice(58)];
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  try {
    const events = []; await streamEvents('/chat', { text: 'hello' }, (kind, value) => events.push([kind, value]));
    assert.deepEqual(events, [['say', { text: 'café 🏕' }], ['done', { grounded: true }]]);
  } finally { globalThis.fetch = originalFetch; }
});
test('API errors preserve FastAPI validation details and reject unreadable success bodies', async () => {
  try {
    globalThis.fetch = async () => Response.json({ detail: [{ msg: 'Budget must be positive' }] }, { status: 422 });
    await assert.rejects(request('/bad'), /Budget must be positive/);
    globalThis.fetch = async () => new Response('<html>proxy failure</html>', { status: 200 });
    await assert.rejects(request('/bad'), /unreadable response/);
  } finally { globalThis.fetch = originalFetch; }
});
test('comparison and display preserve unknown stock and currency', () => {
  const valued = toValued({ id: 'unknown', price: 12 });
  assert.equal(valued.in_stock, false);
  assert.equal(valued.currency, null);
  assert.equal(money(12, null), '12.00 (currency unknown)');
  assert.equal(money(NaN), '—');
});
test('stopping voice while microphone permission is pending closes late microphone tracks', async () => {
  const originals = Object.fromEntries(['navigator', 'WebSocket', 'AudioContext', 'location'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let grant; let stopped = 0; let loaded = 0;
  class FakeSocket { static OPEN = 1; readyState = 1; close() {} send() {} }
  class FakeAudio { audioWorklet = { addModule: async () => { loaded += 1; } }; resume() { return Promise.resolve(); } close() { return Promise.resolve(); } }
  for (const [key, value] of Object.entries({ navigator: { mediaDevices: { getUserMedia: () => new Promise((resolve) => { grant = resolve; }) } }, WebSocket: FakeSocket, AudioContext: FakeAudio, location: { protocol: 'http:', host: 'localhost' } })) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const live = createLive({}); await live.start(); live.stop();
    grant({ getTracks: () => [{ stop() { stopped += 1; } }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(stopped, 1); assert.equal(loaded, 0); assert.equal(live.status, 'idle');
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
