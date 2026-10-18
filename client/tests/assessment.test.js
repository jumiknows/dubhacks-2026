import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrialRecorder, trialSpec, percentile } from '../src/gesture-lab/assessment.js';

const frame = (t, source = 'hand', present = true) => ({ t, receivedAt: t, source, inferenceMs: 12, processingMs: 18,
  hands: Object.fromEntries(['left', 'right'].map(id => [id, { present, identified: present, pointer: present ? { x: .5, y: .5 } : null }])) });
const event = (over = {}) => ({ type: 'select', source: 'hand', event_id: 'one', hand_id: 'right', target_id: 'lab-click', ts: 100, ...over });
function recorder(feature = 'click', source = 'hand') {
  const r = new TrialRecorder(); r.begin(trialSpec(feature), source, 0); r.observeFrame(frame(50, source)); return r;
}
test('a functional pass requires a matching event AND the resulting UI frame', () => {
  const r = recorder(); r.observeEvent(event()); r.markPaint('one', 120, true);
  const result = r.finish(1000); assert.equal(result.outcome, 'pass'); assert.equal(result.metrics.eventToPaintP95Ms, 20);
  const bad = recorder(); bad.observeEvent(event()); assert.equal(bad.finish(1000).outcome, 'fail');
});
test('replays and mouse clicks cannot inflate live camera accuracy', () => {
  const r = recorder(); r.observeEvent(event({ source: 'mouse' })); r.observeEvent(event({ source: 'replay' }));
  assert.equal(r.finish(1000).missed, 1);
});
test('duplicates and wrong targets fail a trial', () => {
  const r = recorder(); r.observeEvent(event()); r.markPaint('one', 120, true);
  r.observeEvent(event({ event_id: 'two' })); r.markPaint('two', 120, true);
  const result = r.finish(1000); assert.equal(result.outcome, 'fail'); assert.equal(result.duplicates, 1);
  const wrong = recorder(); wrong.observeEvent(event({ target_id: 'wrong' })); assert.equal(wrong.finish(1000).unexpectedCount, 1);
});
test('preparatory presses on a wrong target or wrong hand are not silently allowed', () => {
  const r = recorder(); r.observeEvent(event({ type: 'pointer_down', target_id: 'wrong' }));
  r.observeEvent(event({ type: 'pointer_down', event_id: 'other', hand_id: 'left' }));
  assert.equal(r.finish(1000).unexpectedCount, 2);
});
test('result-gap metrics include a camera that stops delivering before the trial ends', () => {
  const r = recorder(); const result = r.finish(1000);
  assert.equal(result.metrics.maxResultGapMs, 950);
});
test('a visible UI change without its intended gesture does not pass', () => {
  const r = recorder(); r.markPaint('one', 120, true); assert.equal(r.finish(1000).outcome, 'fail');
});
test('interrupted or frameless runs are incomplete rather than pass', () => {
  const r = recorder(); assert.equal(r.finish(1000, { reason: 'page hidden' }).outcome, 'incomplete');
  r.begin(trialSpec('click'), 'hand', 0); assert.equal(r.finish(1000).outcome, 'incomplete');
});
test('no-action needs a meaningful duration and visible hands, not an empty camera', () => {
  const r = recorder('idle'); assert.equal(r.finish(1000).outcome, 'fail');
  const empty = new TrialRecorder(); empty.begin(trialSpec('idle'), 'hand', 0);
  for (let i = 0; i < 100; i++) empty.observeFrame(frame(i * 60, 'hand', false));
  assert.equal(empty.finish(6000).outcome, 'fail');
  const valid = recorder('idle'); for (let i = 1; i < 100; i++) valid.observeFrame(frame(i * 60));
  assert.equal(valid.finish(6000).outcome, 'pass');
});
test('pointing requires a continuous hold and reports target error in pixels', () => {
  const r = recorder('point');
  for (let i = 0; i < 40; i++) r.observeFrame(frame(100 + i * 33), { x: .5, y: .5, width: 1280, height: 720, radius: 32 });
  const result = r.finish(2000); assert.equal(result.outcome, 'pass'); assert.equal(result.metrics.pointErrorP95Px, 0);
  const short = recorder('point'); for (let i = 0; i < 20; i++) short.observeFrame(frame(100 + i * 33), { x: .5, y: .5, width: 1280, height: 720, radius: 32 });
  assert.equal(short.finish(2000).outcome, 'fail');
});
test('pointing does not bridge a tracking gap into a continuous hold', () => {
  const r = recorder('point');
  for (let i = 0; i < 40; i++) r.observeFrame(frame(i * 33, 'hand', i !== 19), { x: .5, y: .5, width: 1280, height: 720, radius: 32 });
  assert.equal(r.finish(2000).outcome, 'fail');
});
test('parallel drags require both correct hands and drop zones', () => {
  const r = recorder('parallel');
  r.observeEvent(event({ type: 'drop', target_id: 'lab-drag-left', hand_id: 'left', drop_target_id: 'lab-tray' })); r.markPaint('one', 120, true);
  assert.equal(r.finish(1000).missed, 1);
});
test('export retains evidence and config, and never claims physical latency', () => {
  const r = recorder(); r.finish(1000); const report = r.export({ device: 'test' });
  assert.equal(report.limits.physicalLatencyMeasured, false); assert.equal(report.results[0].frames.length, 1); assert.equal(report.context.device, 'test');
});
test('a late frame from the previous trial cannot validate a new trial', () => {
  const r = recorder(); r.observeEvent(event()); r.finish(1000); r.begin(trialSpec('click'), 'hand', 1001);
  r.markPaint('one', 1100, true); assert.deepEqual(r.current.paints, {});
});
test('percentiles use observed values, leaving missing metrics unknown', () => {
  assert.equal(percentile([]), null); assert.equal(percentile([40, 10, 20, 30], .95), 40);
});
