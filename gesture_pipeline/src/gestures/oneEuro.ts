// One Euro filter (Casiez, Roussel, Vogel 2012): heavy smoothing when still, light smoothing when fast.
// Tuning: set beta = 0, lower minCutoff until jitter at rest disappears; then raise beta until lag at speed disappears.

const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export class OneEuro {
  private xHat: number | undefined;
  private dxHat = 0;
  private tPrev: number | undefined;

  constructor(public minCutoff = 1.0, public beta = 0.007, public dCutoff = 1.0) {}

  reset() {
    this.xHat = undefined;
    this.tPrev = undefined;
    this.dxHat = 0;
  }

  /** @param tSec time in seconds */
  filter(x: number, tSec: number): number {
    if (this.xHat === undefined || this.tPrev === undefined) {
      this.xHat = x;
      this.tPrev = tSec;
      return x;
    }
    const dt = Math.max(1e-3, tSec - this.tPrev);
    this.tPrev = tSec;
    const dx = (x - this.xHat) / dt;
    this.dxHat = this.dxHat + alpha(this.dCutoff, dt) * (dx - this.dxHat);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxHat);
    this.xHat = this.xHat + alpha(cutoff, dt) * (x - this.xHat);
    return this.xHat;
  }
}
