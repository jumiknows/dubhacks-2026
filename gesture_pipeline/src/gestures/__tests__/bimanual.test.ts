import { describe, expect, it } from 'vitest';
import { BimanualCoordinator, type PairHand, type PairInput } from '../bimanual';
import { defaults } from '../config';
import type { ObjectTarget } from '../types';

const original = (id = 'a'): ObjectTarget => ({ id, groupId: id, kind: 'original' });
const child = (id: string, groupId = 'a'): ObjectTarget => ({ id, groupId, kind: 'component' });
const h = (x: number, y: number, target = original(), ratio = 0.1): PairHand => ({
  point: { x, y }, ratio, eligible: true, identified: true, target,
});
function setup(a = h(.3, .4), b = h(.7, .4)) {
  const c = new BimanualCoordinator();
  const events: ReturnType<typeof c.update>['events'] = [];
  const feed = (t: number, left: PairHand | null = a, right: PairHand | null = b) => {
    const out = c.update(t, { left, right }, defaults); events.push(...out.events); return out;
  };
  feed(0, { ...a, ratio: 1 }, { ...b, ratio: 1 });
  feed(70, { ...a, ratio: 1 }, { ...b, ratio: 1 });
  feed(100); feed(150);
  return { c, feed, events, a, b, commits: () => events.filter(e => ['expand', 'collapse', 'compare'].includes(e.type)) };
}
describe('two-hand object transactions', () => {
  it('does not reserve fists or turn their motion into paired actions', () => {
    const c = new BimanualCoordinator();
    const input = { left: h(.3, .4), right: h(.7, .4) };
    for (const t of [0, 70, 150, 300]) {
      const out = c.update(t, {
        left: { ...input.left, ratio: t < 100 ? 1 : .1, eligible: t < 100 },
        right: { ...input.right, ratio: t < 100 ? 1 : .1, eligible: t < 100 },
      }, defaults);
      expect(out.reserved.size).toBe(0);
      expect(out.events).toEqual([]);
    }
  });
  it('expands the captured original once even after leaving its bounds', () => {
    const s = setup(); s.feed(250, h(.18, .4, original('elsewhere')), h(.82, .4, original('elsewhere')));
    s.feed(400, h(.1, .4), h(.9, .4));
    expect(s.commits()).toHaveLength(1);
    expect(s.commits()[0]).toMatchObject({ type: 'expand', group_id: 'a', target_ids: ['a', 'a'], hand_ids: ['left', 'right'] });
  });
  it.each([false, true])('collapses horizontally with either hand order (%s)', reverse => {
    const a = h(reverse ? .7 : .3, .4, child('warmth')), b = h(reverse ? .3 : .7, .4, child('weight'));
    const s = setup(a, b);
    s.feed(300, h(reverse ? .54 : .46, .4, child('warmth')), h(reverse ? .46 : .54, .4, child('weight')));
    s.feed(400, h(.5, .4), h(.5, .4));
    expect(s.commits()).toHaveLength(1);
    expect(s.commits()[0]).toMatchObject({ type: 'collapse', group_id: 'a', target_ids: ['warmth', 'weight'] });
  });
  it.each([false, true])('compares separate originals with either horizontal hand order (%s)', reverse => {
    const s = setup(h(reverse ? .7 : .3, .4), h(reverse ? .3 : .7, .4, original('b')));
    s.feed(300, h(reverse ? .54 : .46, .4), h(reverse ? .46 : .54, .4, original('b')));
    expect(s.commits()[0]).toMatchObject({ type: 'compare', target_ids: ['a', 'b'] });
  });
  it('requires movement by BOTH hands', () => {
    const s = setup(); s.feed(300, h(.1, .4), s.b); expect(s.commits()).toEqual([]);
  });
  it('rejects diagonal motion', () => {
    const s = setup(); s.feed(300, h(.2, .2), h(.8, .6)); expect(s.commits()).toEqual([]);
  });
  it('requires inward hands to approach, not just move slightly closer', () => {
    const s = setup(h(.2, .4), h(.8, .4, original('b')));
    s.feed(300, h(.28, .4), h(.72, .4, original('b'))); expect(s.commits()).toEqual([]);
  });
  it('does not collapse components from different parent groups', () => {
    const s = setup(h(.3, .4, child('x')), h(.7, .4, child('y', 'b')));
    s.feed(300, h(.46, .4), h(.54, .4)); expect(s.commits()).toEqual([]);
  });
  it('does not collapse with the former vertical motion', () => {
    const s = setup(h(.5, .3, child('x')), h(.5, .7, child('y')));
    s.feed(300, h(.5, .46), h(.5, .54)); expect(s.commits()).toEqual([]);
  });
  it('requires both component grips to move inward and close the gap', () => {
    const s = setup(h(.2, .4, child('x')), h(.8, .4, child('y')));
    s.feed(250, h(.28, .4), h(.72, .4)); expect(s.commits()).toEqual([]);
    s.feed(300, h(.68, .4), h(.8, .4)); expect(s.commits()).toEqual([]);
  });
  it('does not compare children or an original with a child', () => {
    const s = setup(h(.3, .4, child('x')), h(.7, .4));
    s.feed(300, h(.46, .4), h(.54, .4)); expect(s.commits()).toEqual([]);
  });
  it('does not treat vertical movement of originals as compare', () => {
    const s = setup(h(.5, .3), h(.5, .7, original('b')));
    s.feed(300, h(.5, .46), h(.5, .54)); expect(s.commits()).toEqual([]);
  });
  it('pauses during a short hand dropout and resumes on the same captured objects', () => {
    const s = setup(); s.feed(200, null, h(.82, .4)); expect(s.commits()).toEqual([]);
    s.feed(250, h(.18, .4), h(.82, .4)); expect(s.commits()).toHaveLength(1);
  });
  it('cancels long loss and requires opening before recapture', () => {
    const s = setup(); s.feed(500, null, s.b); s.feed(550, h(.18, .4), h(.82, .4));
    expect(s.commits()).toEqual([]); expect(s.events.some(e => e.type === 'bimanual_cancel')).toBe(true);
  });
  it('cancels a persistently uncertain label instead of completing after identity changes', () => {
    const s = setup(); s.feed(180, { ...s.a, identified: false }, s.b); s.feed(500, { ...s.a, identified: false }, s.b);
    s.feed(550, h(.18, .4), h(.82, .4));
    expect(s.commits()).toEqual([]); expect(s.events.some(e => e.type === 'bimanual_cancel')).toBe(true);
  });
  it('never commits while a grip is opening; cancels after debounce', () => {
    const s = setup(); s.feed(250, h(.18, .4, original(), .9), h(.82, .4));
    expect(s.commits()).toEqual([]); s.feed(310, h(.18, .4, original(), .9), h(.82, .4));
    expect(s.events.at(-1)?.type).toBe('bimanual_cancel');
  });
  it('rejects a ineligible pose or unlabelled hand', () => {
    for (const change of [{ eligible: false }, { identified: false }]) {
      const s = setup({ ...h(.3, .4), ...change }, h(.7, .4));
      s.feed(300, { ...h(.15, .4), ...change }, h(.85, .4)); expect(s.commits()).toEqual([]);
    }
  });
  it('reserves the first object grip before the other hand arrives', () => {
    const s = setup(); const out = s.feed(200, s.a, null); expect(out.reserved.has('left')).toBe(true);
  });
  it('does not grab when tracking begins with already closed gripes', () => {
    const c = new BimanualCoordinator();
    const input: PairInput = { left: h(.3, .4), right: h(.7, .4) };
    c.update(0, input, defaults); c.update(100, input, defaults);
    expect(c.update(300, { left: h(.1, .4), right: h(.9, .4) }, defaults).events).toEqual([]);
  });
  it('ends a committed gesture on release and can perform the next after both open', () => {
    const s = setup(); s.feed(300, h(.18, .4), h(.82, .4));
    s.feed(400, h(.3, .4, original(), 1), h(.7, .4, original(), 1));
    s.feed(470, h(.3, .4, original(), 1), h(.7, .4, original(), 1));
    s.feed(500); s.feed(650, h(.18, .4), h(.82, .4));
    expect(s.commits()).toHaveLength(2); expect(s.events.some(e => e.type === 'bimanual_end')).toBe(true);
  });
});
