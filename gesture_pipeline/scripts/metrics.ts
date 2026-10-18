// Exact replay assessment. --require-real checks recorded-data coverage; synthetic success is not a release certificate.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defaults, normalizeConfig } from '../src/gestures/config';
import { assessFixture, DISCRETE, replay, type Fixture } from '../src/gestures/replay';

const args = process.argv.slice(2);
const configIndex = args.indexOf('--config');
const config = configIndex >= 0 ? normalizeConfig(JSON.parse(readFileSync(args[configIndex + 1], 'utf8'))) : defaults;
const rows = new Map<string, { trials: number; passed: number; unexpected: number }>();
const sources = { camera: 0, synthetic: 0, unknown: 0 };
const realTrials = new Map<string, number>();
const failures: string[] = [];
const modelTimes: number[] = [], processingTimes: number[] = [];
let idleMs = 0, idleFires = 0, realIdleMs = 0;

for (const file of readdirSync('src/gestures/__fixtures__').filter(name => name.endsWith('.json')).sort()) {
  const fixture = JSON.parse(readFileSync(join('src/gestures/__fixtures__', file), 'utf8')) as Fixture;
  const cfg = args.includes('--recorded-config') && fixture.recordingConfig ? normalizeConfig(fixture.recordingConfig) : config;
  const result = replay(fixture, cfg);
  const errors = assessFixture(fixture, result);
  if (errors.length) failures.push(`${fixture.name}: ${errors.join('; ')}`);
  const source = fixture.source ?? (fixture.notes?.includes('synthetic') ? 'synthetic' : 'unknown');
  sources[source]++;
  const expected = fixture.expected.filter(type => DISCRETE.has(type));
  const scrollExpected = !!fixture.expectedScroll || fixture.expected.includes('scroll');
  const actions = result.events.filter(type => DISCRETE.has(type));
  const scrollCount = result.events.includes('scroll') ? 1 : 0;
  const duration = fixture.frames.length ? fixture.frames.at(-1)!.t - fixture.frames[0].t : 0;
  for (const frame of fixture.frames) if (frame.timing) {
    modelTimes.push(frame.timing.inferenceMs); processingTimes.push(frame.timing.processingMs);
  }
  if (!expected.length && !scrollExpected) {
    idleMs += duration; idleFires += actions.length + scrollCount;
    if (source === 'camera') realIdleMs += duration;
    continue;
  }
  const key = expected[0] ?? 'scroll';
  const row = rows.get(key) ?? { trials: 0, passed: 0, unexpected: 0 };
  row.trials++; if (!errors.length) row.passed++;
  row.unexpected += Math.max(0, actions.length - expected.length) + (!scrollExpected ? scrollCount : 0);
  rows.set(key, row);
  if (source === 'camera') {
    for (const type of new Set(expected)) realTrials.set(type, (realTrials.get(type) ?? 0) + 1);
    if (fixture.expectedScroll && fixture.expectedScroll.direction !== 'either') {
      const label = `scroll_${fixture.expectedScroll.direction}`;
      realTrials.set(label, (realTrials.get(label) ?? 0) + 1);
    }
  }
}
console.table([...rows].map(([gesture, row]) => ({ gesture, ...row, exactPassRate: (row.passed / row.trials).toFixed(2) })));
console.log(`Idle: ${(idleMs / 1000).toFixed(1)}s, ${idleFires} unintended action(s).`);
console.log(`Evidence: ${sources.camera} camera, ${sources.synthetic} synthetic, ${sources.unknown} unlabelled recording(s).`);
const p95 = (values: number[]) => {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  return valid[Math.max(0, Math.ceil(valid.length * 0.95) - 1)];
};
if (modelTimes.length) console.log(`Recorded model p95: ${p95(modelTimes)?.toFixed(1)}ms; processing round trip p95: ${p95(processingTimes)?.toFixed(1)}ms. Not physical motion-to-screen latency.`);
if (args.includes('--require-real')) {
  for (const type of ['select', 'drag_start', 'reveal', 'dismiss', 'scroll_forward', 'scroll_backward']) {
    const count = realTrials.get(type) ?? 0;
    if (count < 20) failures.push(`recorded-data gate: ${type} has ${count}/20 camera trials`);
  }
  if (realIdleMs < 120000) failures.push(`recorded-data gate: idle camera coverage ${(realIdleMs / 1000).toFixed(1)}/120s`);
}
if (failures.length) {
  failures.forEach(failure => console.error(failure)); process.exitCode = 1;
} else console.log('All assessed expectations passed.');
console.log('Release readiness still needs physical latency, diverse users/conditions and target-device validation.');
