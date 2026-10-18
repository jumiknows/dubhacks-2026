// Writes a few synthetic fixtures so the replay tests and metrics script have something to run
// before you record real ones. Real recordings (press R with ?gdebug=1) are far more valuable.
// Run: npx tsx scripts/make-synthetic-fixtures.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { fixtureHand } from '../src/gestures/__tests__/synthetic';
import type { Fixture, FixtureFrame } from '../src/gestures/replay';

const DT = 33;
const dir = 'src/gestures/__fixtures__';
mkdirSync(dir, { recursive: true });

function frames(seq: Array<{ n: number; pose: 'open' | 'fist' | 'pinch' | 'swipe' | 'point'; x: number | ((i: number) => number); y?: number }>): FixtureFrame[] {
  const out: FixtureFrame[] = [];
  let t = 0;
  for (const s of seq) {
    for (let i = 0; i < s.n; i++) {
      t += DT;
      const x = typeof s.x === 'function' ? s.x(i) : s.x;
      out.push({ t, hands: [fixtureHand(s.pose, x, s.y ?? 0.45)] });
    }
  }
  return out;
}

const base = { videoW: 640, videoH: 480, recordedAt: '2026-10-17', notes: 'synthetic' };

const fixtures: Fixture[] = [
  {
    ...base,
    name: 'synthetic_pinch_tap',
    frames: frames([{ n: 10, pose: 'point', x: 0.5 }, { n: 4, pose: 'pinch', x: 0.5 }, { n: 10, pose: 'point', x: 0.5 }]),
    hitTest: { default: 'p1' },
    expected: ['select'],
  },
  {
    ...base,
    name: 'synthetic_swipe_left_reveal',
    frames: frames([{ n: 10, pose: 'point', x: 0.3 }, { n: 5, pose: 'swipe', x: 0.3 }, { n: 5, pose: 'swipe', x: i => 0.35 + i * 0.07 }, { n: 6, pose: 'point', x: 0.63 }]),
    hitTest: { default: null },
    expected: ['reveal'],
  },
  {
    ...base,
    name: 'synthetic_swipe_right_dismiss',
    frames: frames([{ n: 10, pose: 'point', x: 0.7 }, { n: 5, pose: 'swipe', x: 0.7 }, { n: 5, pose: 'swipe', x: i => 0.65 - i * 0.07 }, { n: 6, pose: 'point', x: 0.37 }]),
    hitTest: { default: 'p1' },
    expected: ['dismiss'],
  },
  {
    ...base,
    name: 'synthetic_pinch_drag_drop',
    frames: frames([{ n: 10, pose: 'point', x: 0.62 }, { n: 5, pose: 'pinch', x: 0.62 },
      { n: 12, pose: 'pinch', x: i => 0.62 - i * 0.022 }, { n: 6, pose: 'point', x: 0.378 }]),
    hitTest: { default: 'p1' },
    dropZones: [{ x0: 0.55, x1: 1, id: 'tray' }],
    expected: ['drag_start', 'drop'], expectedTargets: ['p1', 'p1'], expectedDropTargets: [null, 'tray'],
  },
  {
    ...base,
    name: 'synthetic_swipe_tracking_blip',
    frames: frames([{ n: 10, pose: 'point', x: 0.3 }, { n: 5, pose: 'swipe', x: 0.3 },
      { n: 2, pose: 'point', x: 0.3 }, { n: 6, pose: 'swipe', x: i => 0.34 + i * 0.05 }, { n: 6, pose: 'point', x: 0.59 }]),
    hitTest: { default: null }, expected: ['reveal'],
  },
  {
    ...base,
    name: 'synthetic_idle_slow_pointing',
    frames: frames([{ n: 120, pose: 'point', x: i => 0.3 + 0.4 * Math.abs(Math.sin(i / 30)) }]),
    hitTest: { default: null },
    expected: [],
  },
];

for (const f of fixtures) writeFileSync(`${dir}/${f.name}.json`, JSON.stringify(f));
console.log(`wrote ${fixtures.length} fixtures to ${dir}`);
