import { describe, expect, it } from 'vitest';
import { PoseDetector, allCurled, fingerCurl, getPoseView } from '../pose';
import { hand } from './synthetic';

const frame = (pose: Parameters<typeof hand>[0], cx = 0.5, cy = 0.5) =>
  hand(pose, cx, cy).map(([x, y, z]) => ({ x, y, z }));

describe('fist and swipes', () => {
  it('does not navigate when a captured draggable owns the motion', () => {
    const poses = new PoseDetector();
    const names = [0, .1, .2].map((dx, i) => poses.update(frame('pinch', .5 + dx), i * 70, false, { width: 640, height: 480 }, false));
    expect(names).toEqual([null, null, null]);
  });
  it('sees an open hand as extended and a fist as curled', () => {
    expect(fingerCurl(frame('open'))).toBeGreaterThan(1.5);
    expect(allCurled(frame('fist'))).toBe(true);
    expect(allCurled(frame('open'))).toBe(false);
  });

  it('does not grab when one finger stays extended', () => {
    const poses = new PoseDetector();
    const almost = frame('fist');
    almost[8] = { x: 0.5 - 0.45 * 0.12, y: 0.5 - 0.12, z: 0 };
    poses.update(frame('open'), 0, true);
    poses.update(frame('open'), 70, true);
    poses.update(almost, 90, true);
    expect(poses.update(almost, 160, true)).toBeNull();
  });

  it('keeps the close gesture armed while the index travels inward', () => {
    const poses = new PoseDetector();
    const moving = frame('fist');
    moving[8] = { ...moving[8], y: moving[8].y - 0.08 };
    poses.update(frame('open'), 0, true);
    poses.update(frame('open'), 70, true);
    poses.update(moving, 90, true);
    poses.update(moving, 130, true);
    expect(poses.update(frame('fist'), 160, true)).toBe('grab');
  });

  it('does not turn a stopped, partly curled index into a fist', () => {
    const poses = new PoseDetector();
    const moving = frame('fist');
    moving[8] = { ...moving[8], y: moving[8].y - 0.08 };
    poses.update(frame('open'), 0, true);
    poses.update(frame('open'), 70, true);
    poses.update(moving, 90, true);
    poses.update(moving, 130, true);
    expect(poses.update(moving, 230, true)).toBeNull();
  });

  it('asks for a wrist turn when every finger points at the camera', () => {
    const poses = new PoseDetector();
    const toward = frame('fist').map((point, index) => (
      [4, 8, 12, 16, 20].includes(index) ? { ...point, z: -0.12 } : point
    ));
    poses.update(frame('open'), 0, true);
    poses.update(frame('open'), 70, true);
    poses.update(toward, 90, true);
    expect(poses.update(toward, 160, true)).toBeNull();
    expect(getPoseView().hint).toBe('Rotate your wrist');
  });

  it('reports grab when the fist closes and release when it opens', () => {
    const poses = new PoseDetector();
    expect(poses.update(frame('open'), 0, true)).toBeNull();
    expect(poses.update(frame('open'), 70, true)).toBeNull();
    expect(poses.update(frame('fist'), 90, true)).toBeNull();
    expect(poses.update(frame('fist'), 160, true)).toBe('grab');
    expect(poses.update(frame('open'), 200, true)).toBeNull();
    expect(poses.update(frame('open'), 270, true)).toBe('release');
  });

  it('names a pinched-hand move by its direction', () => {
    const cases = [
      { name: 'swipe-left', x: -0.2, y: 0 },
      { name: 'swipe-right', x: 0.2, y: 0 },
      { name: 'swipe-up', x: 0, y: -0.2 },
      { name: 'swipe-down', x: 0, y: 0.2 },
    ] as const;
    for (const motion of cases) {
      const poses = new PoseDetector();
      poses.update(frame('pinch', 0.5, 0.5), 0, false);
      poses.update(frame('pinch', 0.5 + motion.x / 2, 0.5 + motion.y / 2), 80, false);
      expect(poses.update(frame('pinch', 0.5 + motion.x, 0.5 + motion.y), 160, false)).toBe(motion.name);
    }
  });

  it('ignores a swipe if the hand is not pinched', () => {
    const poses = new PoseDetector();
    poses.update(frame('open', 0.5, 0.5), 0, false);
    poses.update(frame('open', 0.4, 0.5), 80, false);
    expect(poses.update(frame('open', 0.3, 0.5), 160, false)).toBeNull();
  });

  it('ignores the hand traveling back after a swipe', () => {
    const poses = new PoseDetector();
    poses.update(frame('pinch', 0.5, 0.5), 0, false);
    poses.update(frame('pinch', 0.4, 0.5), 80, false);
    expect(poses.update(frame('pinch', 0.3, 0.5), 160, false)).toBe('swipe-left');
    poses.update(frame('pinch', 0.3, 0.5), 700, false);
    poses.update(frame('pinch', 0.4, 0.5), 780, false);
    expect(poses.update(frame('pinch', 0.5, 0.5), 860, false)).toBeNull();
    poses.update(frame('pinch', 0.5, 0.5), 1400, false);
    poses.update(frame('pinch', 0.4, 0.5), 1480, false);
    expect(poses.update(frame('pinch', 0.3, 0.5), 1560, false)).toBe('swipe-left');
  });

  it('reads a wrist turn from the index fingertip while the palm stays put', () => {
    const poses = new PoseDetector();
    const start = frame('pinch');
    const wrist = start[0];
    const vx = start[8].x - wrist.x;
    const vy = start[8].y - wrist.y;
    const turn = (degrees: number) => {
      const radians = degrees * Math.PI / 180;
      const points = start.map((point) => ({ ...point }));
      points[8] = {
        x: wrist.x + vx * Math.cos(radians) - vy * Math.sin(radians),
        y: wrist.y + vx * Math.sin(radians) + vy * Math.cos(radians),
        z: 0,
      };
      points[4] = { x: points[8].x + 0.005, y: points[8].y + 0.005, z: 0 };
      return points;
    };
    const seen = [start, start, turn(40), turn(80)]
      .map((points, index) => poses.update(points, index * 60, false))
      .find((gesture) => gesture);
    expect(seen).toBe('swipe-right');
    expect(getPoseView().source).toBe('wrist');
  });
});
