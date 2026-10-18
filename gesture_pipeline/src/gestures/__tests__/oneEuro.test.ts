import { describe, expect, it } from 'vitest';
import { OneEuro } from '../oneEuro';

describe('OneEuro', () => {
  it('keeps a constant signal constant', () => {
    const f = new OneEuro(1, 0.007, 1);
    let y = 0;
    for (let i = 0; i < 60; i++) y = f.filter(100, i / 30);
    expect(y).toBeCloseTo(100);
  });

  it('converges to a step input', () => {
    const f = new OneEuro(1, 0.007, 1);
    f.filter(0, 0);
    let y = 0;
    for (let i = 1; i < 120; i++) y = f.filter(500, i / 30);
    expect(y).toBeGreaterThan(495);
  });

  it('higher beta converges faster on fast motion', () => {
    const slow = new OneEuro(1, 0, 1);
    const fast = new OneEuro(1, 0.05, 1);
    slow.filter(0, 0);
    fast.filter(0, 0);
    let ys = 0;
    let yf = 0;
    for (let i = 1; i <= 5; i++) {
      ys = slow.filter(800, i / 30);
      yf = fast.filter(800, i / 30);
    }
    expect(yf).toBeGreaterThan(ys);
  });
});
