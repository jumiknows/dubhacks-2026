import { describe, expect, it } from 'vitest';
import { assessFixture, DISCRETE, replay, type Fixture } from '../replay';
import { fixtureHand } from './synthetic';

// Every JSON file in __fixtures__ must replay to exactly its expected discrete events (hover changes are ignored).
const files = import.meta.glob<Fixture>('../__fixtures__/*.json', { eager: true, import: 'default' });

describe('recorded fixtures', () => {
  const entries = Object.entries(files);
  if (entries.length === 0) it.skip('no fixtures yet: record some with ?gdebug=1 and R', () => {});
  for (const [path, fx] of entries) {
    it(fx.name ?? path, () => {
      expect(assessFixture(fx, replay(fx))).toEqual([]);
    });
  }
});

it('assessment rejects duplicate actions, wrong targets and unlabelled scrolling', () => {
  const fixture: Fixture = { name: 'strict', videoW: 640, videoH: 480, frames: [], expected: ['select'], expectedTargets: ['p1'] };
  const result = { events: ['select', 'select', 'scroll'], detail: [
    { t: 100, type: 'select', target: 'p2' }, { t: 200, type: 'select', target: 'p2' },
    { t: 300, type: 'scroll', target: 'catalogue', deltaY: 0.2 },
  ] };
  expect(assessFixture(fixture, result)).toHaveLength(3);
  fixture.expected = ['scroll']; delete fixture.expectedTargets;
  fixture.expectedScroll = { direction: 'backward', target: 'other' };
  expect(assessFixture(fixture, { events: ['scroll'], detail: result.detail.slice(2) })).toEqual(['wrong scroll direction', 'wrong scroll container']);
});

it('replays recorded scrolling with the original container and signed scroll distances', () => {
  const fx: Fixture = {
    name: 'vertical browsing', videoW: 640, videoH: 480, expected: [],
    frames: Array.from({ length: 38 }, (_, i) => ({
      t: i * 33,
      hands: [fixtureHand(i < 10 || i >= 31 ? 'point' : 'swipe', 0.5,
        i < 16 ? 0.6 : 0.6 - Math.min(i - 16, 14) * 0.015)],
      hit: { targetId: 'c1', draggable: false, swipeTargetId: 'c1', dropTargetId: null,
        scrollTargetId: i < 16 ? 'catalogue' : 'other-pane' },
    })),
  };
  const result = replay(fx);
  const scrolls = result.detail.filter(event => event.type === 'scroll');
  expect(scrolls.length).toBeGreaterThan(2);
  expect(scrolls.every(event => event.target === 'catalogue' && event.deltaY! > 0)).toBe(true);
  expect(scrolls.reduce((sum, event) => sum + event.deltaY!, 0)).toBeCloseTo(0.42);
  expect(result.events.filter(event => DISCRETE.has(event))).toEqual([]);
});
