// Camera-frame coordinates to screen coordinates. Mirror exactly once, here.

import type { Config } from './config';
import type { Vec2 } from './types';
import type { Features } from './types';
import { pointerFor } from './features';
import { OneEuro } from './oneEuro';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Normalized camera point to viewport pixels (pass vw = vh = 1 for normalized output). */
export function toScreen(p: Vec2, vw: number, vh: number, m: Config['mapping']): Vec2 {
  // The box is expressed in what the user sees (after mirroring).
  const mx = m.mirror ? 1 - p.x : p.x;
  const nx = clamp((mx - m.boxLeft) / Math.max(1e-6, m.boxRight - m.boxLeft), 0, 1);
  const ny = clamp((p.y - m.boxTop) / Math.max(1e-6, m.boxBottom - m.boxTop), 0, 1);
  return { x: nx * vw, y: ny * vh };
}

/** Shared by the camera loop and fixture replay so cursor behavior is identical. */
export class PointerMapper {
  private fx = new OneEuro();
  private fy = new OneEuro();
  private previous: Vec2 | null = null;
  private offset: Vec2 = { x: 0, y: 0 };
  private closed = false;
  private lastT: number | null = null;
  private screen: Vec2 | null = null;

  reset() {
    this.fx.reset(); this.fy.reset();
    this.previous = this.screen = null;
    this.offset = { x: 0, y: 0 };
    this.closed = false;
    this.lastT = null;
  }

  update(hand: Features, t: number, width: number, height: number, cfg: Config, freeze = false): Vec2 {
    if (freeze && this.screen) return this.screen;
    const raw = pointerFor(hand);
    const closed = hand.pinchRatio < cfg.pinch.off;
    if (closed !== this.closed && this.previous) {
      this.offset = { x: this.previous.x - raw.x, y: this.previous.y - raw.y };
    }
    if (!closed && this.lastT !== null) {
      const decay = Math.exp(-(t - this.lastT) / cfg.smoothing.releaseBlendMs);
      this.offset = { x: this.offset.x * decay, y: this.offset.y * decay };
    }
    this.closed = closed;
    this.lastT = t;
    this.previous = { x: raw.x + this.offset.x, y: raw.y + this.offset.y };
    const point = toScreen(this.previous, width, height, cfg.mapping);
    for (const filter of [this.fx, this.fy]) {
      filter.minCutoff = cfg.smoothing.minCutoff;
      filter.beta = cfg.smoothing.beta;
      filter.dCutoff = cfg.smoothing.dCutoff;
    }
    this.screen = { x: this.fx.filter(point.x, t / 1000), y: this.fy.filter(point.y, t / 1000) };
    return this.screen;
  }
}
