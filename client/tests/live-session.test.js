import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveSession } from '../src/live.js';
import { createUiQueue } from '../src/assistant.js';

function install(values) {
  const originals = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
  return () => {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

function socket() { return { readyState: 1, send() {}, close() {} }; }

test('automatic voice closes a microphone granted after the session stopped', async () => {
  let grant; let stopped = 0; let contexts = 0;
  const restore = install({
    navigator: { mediaDevices: { getUserMedia: () => new Promise((resolve) => { grant = resolve; }) } },
    WebSocket: { OPEN: 1 },
    AudioContext: class { constructor() { contexts += 1; } },
  });
  try {
    const live = new LiveSession({}); live.ws = socket();
    const pending = live.startMic();
    live.stop();
    grant({ getTracks: () => [{ stop() { stopped += 1; } }] });
    await pending;
    assert.equal(stopped, 1);
    assert.equal(contexts, 0);
    assert.equal(live.mic, null);
  } finally { restore(); }
});

test('automatic voice releases captured tracks when AudioWorklet setup fails', async () => {
  let stopped = 0; let closed = 0;
  const restore = install({
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped += 1; } }] }) } },
    AudioContext: class {
      audioWorklet = { addModule: async () => { throw new Error('Worklet blocked'); } };
      close() { closed += 1; return Promise.resolve(); }
    },
  });
  try {
    const live = new LiveSession({}); live.ws = socket();
    await assert.rejects(live.startMic(), /Worklet blocked/);
    assert.equal(stopped, 1);
    assert.equal(closed, 1);
    assert.equal(live.mic, null);
  } finally { restore(); }
});

test('stopping automatic voice closes tracks while worklet loading is pending', async () => {
  let load; let stopped = 0; let closed = 0;
  const restore = install({
    WebSocket: { OPEN: 1 },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped += 1; } }] }) } },
    AudioContext: class {
      audioWorklet = { addModule: () => new Promise((resolve) => { load = resolve; }) };
      close() { closed += 1; return Promise.resolve(); }
    },
  });
  try {
    const live = new LiveSession({}); live.ws = socket();
    const pending = live.startMic();
    await Promise.resolve();
    live.stop();
    assert.equal(stopped, 1);
    assert.equal(closed, 1);
    load(); await pending;
    assert.equal(stopped, 1);
    assert.equal(live.mic, null);
  } finally { restore(); }
});

test('voice board events wait for plan hydration and recover after a failed event', async () => {
  const enqueue = createUiQueue();
  const seen = []; let loaded = false; let finish;
  const first = enqueue(async () => { await new Promise((resolve) => { finish = resolve; }); loaded = true; seen.push('plan'); });
  const second = enqueue(() => { assert.equal(loaded, true); seen.push('cart'); });
  await Promise.resolve();
  assert.deepEqual(seen, []);
  finish(); await Promise.all([first, second]);
  assert.deepEqual(seen, ['plan', 'cart']);
  await assert.rejects(enqueue(() => { throw new Error('stale plan'); }), /stale plan/);
  await enqueue(() => seen.push('next'));
  assert.deepEqual(seen, ['plan', 'cart', 'next']);
});
