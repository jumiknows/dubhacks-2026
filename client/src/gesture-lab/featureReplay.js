import { gestures } from 'conjure-gestures';
import { landmarkHand, pointOn, replayMotion } from './replay';

const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export async function replayFeature(feature, root, signal, hand = 'right') {
  const node = id => root.querySelector(`[data-gesture-object="${id}"]`);
  const at = selector => pointOn(root.querySelector(selector));
  if (['expand', 'collapse', 'compare', 'parallel'].includes(feature)) {
    let from, to;
    if (feature === 'expand') {
      from = [pointOn(node('alpine'), .22, .58), pointOn(node('alpine'), .78, .58)];
      to = [{ x: from[0].x - .1, y: from[0].y }, { x: from[1].x + .1, y: from[1].y }];
    } else if (feature === 'collapse') {
      from = [pointOn(node('alpine:warmth'), .2), pointOn(node('alpine:carry'), .8)];
      const mid = (from[0].x + from[1].x) / 2;
      to = [{ x: mid - .02, y: from[0].y }, { x: mid + .02, y: from[1].y }];
    } else if (feature === 'compare') {
      from = [pointOn(node('alpine')), pointOn(node('camp'))];
      const mid = (from[0].x + from[1].x) / 2;
      to = [{ x: mid - .025, y: from[0].y }, { x: mid + .025, y: from[1].y }];
    } else {
      from = [at('[data-gesture-id="lab-drag-left"]'), at('[data-gesture-id="lab-drag-right"]')];
      to = [pointOn(root.querySelector('[data-drop-zone]'), .5, .35), pointOn(root.querySelector('[data-drop-zone]'), .5, .65)];
    }
    await replayMotion(from, to, signal);
    return;
  }
  let t = performance.now();
  const frame = async (points, pose = false) => {
    if (signal.aborted) throw new DOMException('Replay cancelled', 'AbortError');
    t += 33;
    const hands = Object.entries(points).filter(([, p]) => p).map(([id, p]) => landmarkHand(p, pose, id === 'left' ? 'Left' : 'Right'));
    gestures.processFrame({ t, videoW: 640, videoH: 480, hands }, 0, 0, 'replay');
    await new Promise(resolve => setTimeout(resolve, 33));
  };
  const hold = async (points, pose, count) => { for (let i = 0; i < count; i++) await frame(points, pose); };
  if (feature === 'recovery') {
    const start = { left: at('[data-gesture-id="lab-drag-left"]'), right: at('[data-gesture-id="lab-drag-right"]') };
    const end = at('[data-drop-zone]');
    await hold(start, false, 10); await hold(start, true, 5);
    for (let i = 1; i <= 6; i++) await frame({ left: { x: start.left.x + i * .01, y: start.left.y }, right: { x: start.right.x + i * .01, y: start.right.y } }, true);
    const right = { x: start.right.x + .06, y: start.right.y };
    for (let i = 1; i <= 18; i++) await frame({ right: mix(right, end, i / 18) }, true);
    await hold({ right: end }, true, 6); await hold({ right: end }, false, 5);
  } else {
    const selector = feature === 'point' ? '[data-point-target]' : ['click', 'fist'].includes(feature) ? '[data-gesture-id="lab-click"]'
      : feature === 'drag' ? '[data-gesture-id="lab-drag-left"]' : feature.startsWith('scroll') ? '[data-gesture-scroll]' : '[data-navigation-surface]';
    const start = at(selector);
    await hold({ [hand]: start }, false, 10);
    if (feature === 'point') await hold({ [hand]: start }, false, 40);
    else if (feature === 'idle') {
      for (let i = 0; i < 155; i++) await frame({ [hand]: { x: start.x + Math.sin(i / 8) * .04, y: start.y + Math.cos(i / 9) * .02 } });
    } else if (feature === 'click' || feature === 'fist') {
      await hold({ [hand]: start }, feature === 'fist' ? 'fist' : true, 6);
      await hold({ [hand]: start }, false, 6);
    } else {
      const end = feature === 'drag' ? at('[data-drop-zone]') : {
        x: start.x + (feature === 'reveal' ? -.28 : feature === 'dismiss' ? .28 : 0),
        y: start.y + (feature === 'scroll-up' ? -.32 : feature === 'scroll-down' ? .32 : 0),
      };
      if (end.x < .02 || end.x > .98 || end.y < .02 || end.y > .98) throw new Error('The motion would leave the viewport. Enlarge the test area.');
      await hold({ [hand]: start }, true, 5);
      const frames = feature === 'drag' ? 18 : 6;
      for (let i = 1; i <= frames; i++) await frame({ [hand]: mix(start, end, i / frames) }, true);
      await hold({ [hand]: end }, true, 6); await hold({ [hand]: end }, false, 5);
    }
  }
  if (signal.aborted) throw new DOMException('Replay cancelled', 'AbortError');
  gestures.processFrame({ t: t + 300, videoW: 640, videoH: 480, hands: [] }, 0, 0, 'replay');
}
