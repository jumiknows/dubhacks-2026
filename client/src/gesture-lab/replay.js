import { config, gestures } from 'conjure-gestures';

// Replays enter the same landmark, mapping, targeting and recognition path as a camera result.
export function landmarkHand(point, closed, handedness) {
  const m = config.mapping;
  const sx = m.boxLeft + point.x * (m.boxRight - m.boxLeft);
  const px = m.mirror ? 1 - sx : sx;
  const py = m.boxTop + point.y * (m.boxBottom - m.boxTop);
  const fist = closed === 'fist', pinched = closed === true;
  const size = .08, cx = px + .45 * size, cy = py + (fist ? -.25 : 1) * size;
  const at = (dx, dy) => ({ x: cx + dx * size, y: cy + dy * size, z: 0 });
  const landmarks = Array.from({ length: 21 }, () => at(0, 0));
  landmarks[0] = at(0, 1);
  [-.45, -.15, .15, .45].forEach((x, i) => {
    const base = 5 + i * 4;
    landmarks[base] = at(x, 0); landmarks[base + 1] = at(x, -.45);
    landmarks[base + 2] = at(x, fist ? -.2 : -.75); landmarks[base + 3] = at(x, fist ? .25 : -1);
  });
  landmarks[1] = at(-.6, .7); landmarks[2] = at(-.85, .4); landmarks[3] = at(-1, .1);
  landmarks[4] = fist ? at(-.15, .7) : pinched ? { ...landmarks[8], x: landmarks[8].x + .004 } : at(-1.1, -.2);
  // Label calibration applies to camera and synthetic input alike.
  const label = config.hands.swapHandedness ? handedness === 'Left' ? 'Right' : 'Left' : handedness;
  return { landmarks, handedness: label, handednessScore: 1 };
}
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export function pointOn(element, x = .5, y = .5) {
  if (!element) throw new Error('Replay target is missing. Reset the lab and retry.');
  const r = element.getBoundingClientRect();
  const point = { x: (r.left + r.width * x) / innerWidth, y: (r.top + r.height * y) / innerHeight };
  if (point.x < .02 || point.x > .98 || point.y < .02 || point.y > .98) throw new Error('Keep both objects visible. Enlarge the window or zoom out.');
  return point;
}
export async function replayMotion(from, to, signal, pose = true) {
  const wait = () => new Promise(resolve => setTimeout(resolve, 33));
  let clock = performance.now();
  const frame = async (points, closed) => {
    if (signal.aborted) throw new DOMException('Replay cancelled', 'AbortError');
    clock += 33;
    gestures.processFrame({ t: clock, videoW: 640, videoH: 480,
      hands: [landmarkHand(points[0], closed, 'Left'), landmarkHand(points[1], closed, 'Right')] }, 0, 0, 'replay');
    await wait();
  };
  for (let i = 0; i < 10; i++) await frame(from, false);
  for (let i = 0; i < 5; i++) await frame(from, pose);
  for (let i = 1; i <= 18; i++) await frame(from.map((p, h) => mix(p, to[h], i / 18)), pose);
  for (let i = 0; i < 6; i++) await frame(to, pose);
  for (let i = 0; i < 5; i++) await frame(to, false);
  if (signal.aborted) throw new DOMException('Replay cancelled', 'AbortError');
  gestures.processFrame({ t: clock + 300, videoW: 640, videoH: 480, hands: [] }, 0, 0, 'replay');
}
