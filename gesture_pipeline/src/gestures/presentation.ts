import type { Vec2 } from './types';

/** Follow measured positions at display refresh rate. Never extrapolate past the latest measurement. */
export class CursorPresentation {
  private position: Vec2 | null = null;
  private target: Vec2 | null = null;
  private lastT: number | null = null;

  reset() { this.position = this.target = null; this.lastT = null; }
  update(target: Vec2, t: number, responseMs: number) {
    this.sample(t, responseMs);
    this.target = { ...target };
    if (!this.position) { this.position = { ...target }; this.lastT = t; }
  }
  sample(t: number, responseMs: number): Vec2 | null {
    if (!this.position || !this.target || this.lastT === null) return null;
    const dt = Math.max(0, t - this.lastT);
    this.lastT = Math.max(this.lastT, t);
    const alpha = responseMs <= 0 ? 1 : 1 - Math.exp(-dt / responseMs);
    this.position = {
      x: this.position.x + (this.target.x - this.position.x) * alpha,
      y: this.position.y + (this.target.y - this.position.y) * alpha,
    };
    return { ...this.position };
  }
}
